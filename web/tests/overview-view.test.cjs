const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path')
const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc')
test('overview page wires real frames, profile and playback without Shandong entry points', () => {
  const file = path.resolve(__dirname, '../src/views/cesium/index.vue'),
    source = fs.readFileSync(file, 'utf8')
  assert.match(source, /useOverviewStore/)
  assert.match(source, /OverviewCharts/)
  assert.match(source, /TecLayer/)
  assert.doesNotMatch(source, /山东|PendingPanel|暂未开发/)
  assert.match(source, /togglePlay/)
  assert.match(source, /scene-ready/)
  assert.match(source, /dispose/)
  assert.match(source, /to="\/data-management"/)
  assert.doesNotMatch(source, /to="\/datasets"/)
  assert.match(source, /colorLUT/)
  assert.match(source, /:style="\{ background: legendBackground \}"/)
  for (const f of [
    file,
    path.resolve(__dirname, '../src/components/ionosphere/OverviewCharts.vue'),
  ]) {
    const text = fs.readFileSync(f, 'utf8'),
      { descriptor, errors } = parse(text, { filename: f })
    assert.deepEqual(errors, [])
    assert.ok(compileScript(descriptor, { id: 'overview' }))
    assert.deepEqual(
      compileTemplate({ id: 'overview', source: descriptor.template.content, filename: f }).errors,
      []
    )
  }
})
