const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript')
const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc')
test('removing an invalid task from the URL clears its stale error', async () => {
  const vue = require('vue'),
    Module = require('node:module')
  const filename = path.resolve(__dirname, '../src/views/analysis/index.vue')
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
  const route = vue.reactive({ path: '/analysis', query: { importId: 'invalid' } })
  const store = vue.reactive({
    catalog: { loading: false },
    heights: [0, 1],
    region: null,
    point: null,
    importId: undefined,
    error: '',
    async initialize() {
      this.error = 'invalid task'
    },
    async selectImport() {
      this.error = ''
    },
    dispose() {},
  })
  const m = new Module(filename, module)
  m.require = (id) =>
    id === 'vue'
      ? { ...vue, onBeforeUnmount() {} }
      : id === 'vue-router'
      ? { useRoute: () => route, useRouter: () => ({ replace: async () => {} }) }
      : id.endsWith('/analysis')
      ? { useAnalysisStore: () => store }
      : {}
  m._compile(
    ts.transpileModule(compileScript(descriptor, { id: 'analysis-route' }).content, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    filename
  )
  const scope = vue.effectScope()
  scope.run(() => m.exports.default.setup({}, { expose() {} }))
  await vue.nextTick()
  assert.equal(store.error, 'invalid task')
  route.query = {}
  await vue.nextTick()
  await vue.nextTick()
  assert.equal(store.error, '')
  scope.stop()
})
test('map requests a final frame after asynchronous region geometry is ready and removes listener', () => {
  const vue = require('vue'),
    Module = require('node:module')
  const filename = path.resolve(__dirname, '../src/components/ionosphere/AnalysisMap.vue')
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
  let postUpdate,
    requests = 0,
    removed = false,
    cleanup,
    geometryReady = false
  const viewer = {
    entities: { add: (x) => x, remove() {} },
    isDestroyed: () => false,
    clock: { currentTime: {} },
    dataSourceDisplay: { ready: true, update: () => geometryReady },
    scene: {
      requestRender() {
        requests++
      },
      postUpdate: {
        addEventListener(fn) {
          postUpdate = fn
          return () => {
            removed = true
          }
        },
      },
    },
  }
  const C = {
    Rectangle: { fromDegrees: (...args) => args },
    Color: { CYAN: { withAlpha: () => ({}) } },
  }
  const m = new Module(filename, module)
  m.require = (id) =>
    id === 'vue'
      ? {
          ...vue,
          onBeforeUnmount: (fn) => {
            cleanup = fn
          },
        }
      : id.endsWith('/RegionDrawing')
      ? {
          RegionDrawing: class {
            destroy() {}
          },
        }
      : {}
  m._compile(
    ts.transpileModule(compileScript(descriptor, { id: 'analysis-map' }).content, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    filename
  )
  const scope = vue.effectScope()
  const state = scope.run(() =>
    m.exports.default.setup(
      { enabled: true, region: { west: 100, east: 130, south: 20, north: 50 }, point: null },
      { expose() {}, emit() {} }
    )
  )
  state.ready({ Cesium: C, viewer })
  assert.equal(typeof postUpdate, 'function', 'must observe deferred geometry readiness')
  const initial = requests
  postUpdate()
  assert.ok(requests > initial)
  const next = requests
  postUpdate()
  assert.ok(requests > next, 'sticky ready flag must not stop deferred rendering')
  geometryReady = true
  postUpdate()
  const final = requests
  postUpdate()
  assert.equal(requests, final)
  cleanup()
  assert.equal(removed, true)
  scope.stop()
})
test('3D page links its exact managed import into analysis', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/views/ionosphere/volume/index.vue'),
    'utf8'
  )
  assert.match(source, /path: '\/analysis', query: \{ importId: store.importId \}/)
})
require.extensions['.ts'] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    f
  )
test('analysis route points to a real managed-data workbench with map, numeric forms and table', () => {
  const route = fs.readFileSync(path.resolve(__dirname, '../src/router/routes/index.js'), 'utf8')
  assert.match(route, /views\/analysis\/index.vue/)
  for (const name of [
    'views/analysis/index.vue',
    'components/ionosphere/AnalysisProfile.vue',
    'components/ionosphere/AnalysisMap.vue',
  ]) {
    const f = path.resolve(__dirname, '../src', name),
      source = fs.readFileSync(f, 'utf8'),
      { descriptor, errors } = parse(source, { filename: f })
    assert.deepEqual(errors, [])
    assert.ok(compileScript(descriptor, { id: name }))
    assert.deepEqual(
      compileTemplate({ id: name, source: descriptor.template.content, filename: f }).errors,
      []
    )
    assert.doesNotMatch(source, /山东|shandong|deterministic-mock/)
  }
  const source = fs.readFileSync(path.resolve(__dirname, '../src/views/analysis/index.vue'), 'utf8')
  for (const text of [
    'useAnalysisStore',
    'AnalysisMap',
    'AnalysisProfile',
    '<table',
    'applyBounds',
    'dispose',
    'importId',
    '算术均值',
  ])
    assert.ok(source.includes(text), text)
})
test('profile plot shares axes, breaks missing or log-zero segments and handles constant fields', () => {
  const f = path.resolve(__dirname, '../src/utils/ionosphere/profilePlot.ts')
  assert.ok(fs.existsSync(f), 'profile plot helper must exist')
  const { profilePlot } = require(f)
  const p = profilePlot(
    [{ altitudes: [100, 200, 300, 400, 500], values: [1, 10, null, 0, 100] }],
    'log'
  )
  assert.equal((p.paths[0].match(/M/g) || []).length, 2)
  assert.equal(p.points[0].length, 3)
  assert.equal(p.low, 100)
  assert.equal(p.high, 500)
  assert.equal(profilePlot([{ altitudes: [100, 200], values: [0, 0] }], 'log'), null)
  const c = profilePlot([{ altitudes: [100, 200], values: [0, 0] }], 'linear')
  assert.ok(!/NaN|Infinity/.test(c.paths[0]))
  const shared = profilePlot(
    [
      { altitudes: [100, 200], values: [1, 2] },
      { altitudes: [100, 200], values: [10, 20] },
    ],
    'linear'
  )
  assert.equal(shared.paths.length, 2)
  assert.ok(shared.points[1][0].x > shared.points[0][1].x)
  const small = profilePlot([{ altitudes: [100, 200], values: [0.01, 0.01] }], 'log')
  assert.ok(
    small.points[0].every((p) => p.x >= 72 && p.x <= 568),
    'sub-unit constant log values must stay inside the plot'
  )
  const single = profilePlot([{ altitudes: [150], values: [10] }], 'log')
  assert.ok(single.high > single.low, 'single-layer profile needs a nondegenerate altitude axis')
  assert.equal(single.points[0][0].y, 144)
})
