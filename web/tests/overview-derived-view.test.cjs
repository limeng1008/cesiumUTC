const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module')
const ts = require('typescript')
const { createSSRApp } = require('vue')
const { renderToString } = require('vue/server-renderer')
const { parse, compileTemplate } = require('vue/compiler-sfc')
const filename = path.resolve(__dirname, '../src/components/ionosphere/OverviewCharts.vue')
const descriptor = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor
const compiled = compileTemplate({
  source: descriptor.template.content,
  filename,
  id: 'overview-derived',
})
assert.deepEqual(compiled.errors, [])
const m = new Module(filename, module)
m.paths = Module._nodeModulePaths(path.dirname(filename))
m._compile(
  ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
    .outputText,
  filename
)
const render = (profile) =>
  renderToString(
    createSSRApp({
      render: m.exports.render,
      setup: () => ({
        kind: 'profile',
        titles: { profile: ['垂直剖面', 'PROFILE'] },
        store: { point: { longitude: 1, latitude: 2 } },
        profileChart: null,
        profile,
        number: (v) => (Number.isFinite(v) ? v.toFixed(1) : '—'),
        DERIVED_QUALITY_LABELS: {
          valid: '有效',
          'no-positive-peak': '无正电子密度峰',
          'missing-data': '区间内存在缺测',
        },
      }),
    })
  )
test('zero-density profiles retain valid zero content and F2 quality without a log chart', async () => {
  const html = await render({
    longitude: 1,
    latitude: 2,
    tec: 0,
    peak: null,
    f2Quality: 'no-positive-peak',
    contentQuality: 'valid',
  })
  assert.match(html, /区间电子含量 0.0 TECU/)
  assert.match(html, /无正电子密度峰/)
  assert.match(html, /foF2 — MHz/)
  assert.doesNotMatch(html, /<svg/)
})
test('missing profiles retain their quality explanation without fabricated values', async () => {
  const html = await render({
    longitude: 1,
    latitude: 2,
    tec: null,
    peak: null,
    f2Quality: 'missing-data',
    contentQuality: 'missing-data',
  })
  assert.match(html, /区间电子含量 — TECU/)
  assert.match(html, /区间内存在缺测/)
})
