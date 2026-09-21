const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module')
const ts = require('typescript')
const { createSSRApp, h } = require('vue')
const { renderToString } = require('vue/server-renderer')
const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc')
function load(filename, inlineTemplate = true) {
  const m = new Module(filename, module)
  m.paths = Module._nodeModulePaths(path.dirname(filename))
  const original = m.require.bind(m)
  m.require = (id) =>
    id.startsWith('.') ? load(path.resolve(path.dirname(filename), id + '.ts')) : original(id)
  let source = fs.readFileSync(filename, 'utf8')
  if (filename.endsWith('.vue')) {
    const { descriptor } = parse(source, { filename })
    source = compileScript(descriptor, { id: 'derived-ui', inlineTemplate }).content
  }
  m._compile(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    filename
  )
  return m.exports
}
const axis = (min, max, count) => ({ min, max, count, step: (max - min) / count })
const metadata = {
  id: 'frame',
  parameter: 'Ne',
  source: 'sami3',
  sourceName: 'SAMI3 model',
  sourceFile: 'science.nc',
  timestamp: '2019-04-25T22:50:00Z',
  longitude: axis(-180, 180, 2),
  latitude: axis(-60, 60, 2),
  altitude: axis(100, 700, 6),
}
const d = load(path.resolve(__dirname, '../src/utils/ionosphere/derived.ts'))
function fixture(constant = false) {
  const v = {
    metadata,
    values: Float32Array.from({ length: 24 }, (_, i) =>
      constant ? 1e11 : [1e11, 2e11, 1e12, 3e11, 2e11, 1e11][Math.floor(i / 4)]
    ),
  }
  return {
    grid: d.deriveGrid(v, null, [100, 700], [200, 600]),
    point: d.sampleDerivedProfile(v, 0, 0, [100, 700], [200, 600]),
    metadata,
    importId: 'complete-import-identifier',
  }
}
async function render(props) {
  const file = path.resolve(__dirname, '../src/components/ionosphere/DerivedAnalysis.vue')
  assert.ok(fs.existsSync(file), 'derived presentation component must exist')
  return renderToString(createSSRApp({ render: () => h(load(file).default, props) }))
}
test('real derived panel renders four metric choices, regional/point units, quality and full provenance', async () => {
  const html = await render(fixture())
  for (const label of [
    '区间电子含量',
    'TECU',
    'NmF2',
    'm⁻³',
    'hmF2',
    'km',
    'foF2',
    'MHz',
    '派生专题量',
    '线性色标',
    '面积加权',
    '有效 4 / 4',
    '采样位置派生量',
    '8.98',
    'complete-import-identifier',
    'science.nc',
    'SAMI3 model',
    '2019-04-25 22:50:00 UTC',
    '100–700 km',
    '200–600 km',
    'ne-derived-v1',
    '不是测高仪观测',
    '网格中心',
    '最近中心延拓',
  ])
    assert.ok(html.includes(label), label)
  assert.equal((html.match(/<option /g) || []).length, 4)
  assert.match(html, /<canvas[^>]*aria-label=/)
})
test('flat profile renders invalid F2 placeholders and reason without diagnostic peak values', async () => {
  const props = fixture(true)
  props.point.f2.candidate = { nmF2: 999123456789, hmF2: 567.89 }
  const html = await render(props)
  assert.ok(html.includes('无可靠 F2 峰'))
  assert.ok(html.includes('并列最大值或平顶，无法区分唯一峰'))
  assert.ok(html.includes('无效 4'))
  assert.ok(html.includes('透明'))
  assert.ok((html.match(/—/g) || []).length >= 6)
  assert.ok(!html.includes('567.89'))
  assert.ok(!html.includes('999123456789'))
})
test('absent grid renders waiting state with no stale map, point result or provenance', async () => {
  const html = await render({ ...fixture(), grid: null })
  assert.ok(html.includes('暂无派生结果'))
  assert.ok(!html.includes('<canvas'))
  assert.ok(!html.includes('complete-import-identifier'))
  assert.ok(!html.includes('8.98'))
})
test('analysis template exposes independently labeled F2 window controls alongside existing Ne analysis', async () => {
  const filename = path.resolve(__dirname, '../src/views/analysis/index.vue')
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename,
    id: 'derived-parent',
  })
  assert.deepEqual(compiled.errors, [])
  const m = new Module(filename, module)
  m.paths = Module._nodeModulePaths(path.dirname(filename))
  m._compile(
    ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
      .outputText,
    filename
  )
  const vue = require('vue')
  const app = createSSRApp({
    setup: () => ({
      store: {
        loading: false,
        volume: null,
        heights: [100, 700],
        inputError: '',
        applyF2Window() {},
      },
      catalog: { loading: false, readyImports: [], items: [] },
      regional: false,
      limits: [100, 700],
      draftHeights: [100, 700],
      draftF2Window: [200, 600],
      lon: 0,
      lat: 0,
      metrics: [],
      rows: [],
      utc: String,
      scientific: String,
      setRegion() {},
    }),
    render: m.exports.render,
  })
  for (const name of ['router-link', 'AnalysisMap', 'AnalysisProfile', 'DerivedAnalysis'])
    app.component(name, { render: () => vue.h('div') })
  const html = await renderToString(app)
  assert.ok(html.includes('aria-label="F2 搜索窗下限"'))
  assert.ok(html.includes('aria-label="F2 搜索窗上限"'))
  assert.ok(html.includes('应用 F2 搜索窗'))
  assert.ok(html.includes('分析最低高度'))
})
test('real panel metric changes repaint valid masks and canvas clicks emit actual grid-center coordinates', async () => {
  const vue = require('vue')
  const file = path.resolve(__dirname, '../src/components/ionosphere/DerivedAnalysis.vue')
  const props = vue.reactive(fixture(true))
  const events = [],
    images = []
  const scope = vue.effectScope()
  const state = scope.run(() =>
    load(file, false).default.setup(props, { expose() {}, emit: (...args) => events.push(args) })
  )
  state.canvas.value = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 200 }),
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image) => images.push(image.data),
    }),
  }
  await vue.nextTick()
  await vue.nextTick()
  assert.ok(
    images.at(-1).some((v, i) => i % 4 === 3 && v === 255),
    'valid constant content is colored'
  )
  state.metric.value = 'foF2'
  await vue.nextTick()
  await vue.nextTick()
  assert.equal(state.definition.value.unit, 'MHz')
  assert.equal(state.range.value, null)
  assert.ok(
    images.at(-1).every((v) => v === 0),
    'invalid F2 grid repaints transparent'
  )
  state.pickCell({ clientX: 15, clientY: 25 })
  assert.deepEqual(events.at(-1), ['point', { longitude: -90, latitude: 30 }])
  state.pickCell({ clientX: 410, clientY: 220 })
  assert.deepEqual(events.at(-1), ['point', { longitude: 90, latitude: -30 }])
  props.grid = { ...props.grid, longitude: axis(-1, 1, 73) }
  state.pickCell({ clientX: 10 + (400 * 1.5) / 73, clientY: 25 })
  assert.equal(
    events.at(-1)[1].longitude,
    -1 + 1.5 * (2 / 73),
    'regional click retains exact center precision'
  )
  props.grid = null
  await vue.nextTick()
  await vue.nextTick()
  state.pickCell({ clientX: 15, clientY: 25 })
  assert.equal(events.length, 3, 'no grid cannot emit stale picks')
  scope.stop()
})
