const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module'),
  ts = require('typescript')
const { createPinia, setActivePinia } = require('pinia')
const axis = (min, max, count) => ({ min, max, count, step: (max - min) / count })
const stamp = '2019-04-25T22:50:00Z'
const frame = (top = 700) => ({
  metadata: {
    id: 'derived-fixture',
    parameter: 'Ne',
    unit: 'm^-3',
    timestamp: stamp,
    longitude: axis(-180, 180, 2),
    latitude: axis(-60, 60, 2),
    altitude: axis(100, top, 6),
  },
  values: Float32Array.from(
    { length: 24 },
    (_, i) => [1e11, 2e11, 1e12, 3e11, 2e11, 1e11][Math.floor(i / 4)]
  ),
})
function setup(fetchVolume = async () => frame(), extraDatasets = []) {
  setActivePinia(createPinia())
  const dataset = {
    id: 'file',
    imports: [{ id: 'ready', status: 'ready', parameter: 'Ne', timestamp: stamp, timeIndex: 0 }],
  }
  const api = {
    fetchVolume,
    fetchDatasets: async () => ({
      items: [dataset, ...extraDatasets],
      total: 1 + extraDatasets.length,
    }),
    fetchDataset: async () => dataset,
  }
  const cache = new Map()
  function load(file) {
    const f = path.resolve(file)
    if (cache.has(f)) return cache.get(f).exports
    const m = new Module(f, module)
    cache.set(f, m)
    m.paths = Module._nodeModulePaths(path.dirname(f))
    const original = m.require.bind(m)
    m.require = (id) =>
      /\/(datasetApi|ionosphereApi)$/.test(id)
        ? api
        : id.startsWith('.')
        ? load(path.resolve(path.dirname(f), id + '.ts'))
        : original(id)
    m._compile(
      ts.transpileModule(fs.readFileSync(f, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText,
      f
    )
    return m.exports
  }
  return load(path.join(__dirname, '../src/store/ionosphere/analysis.ts')).useAnalysisStore()
}
test('derived store computes real column fields and independent point F2 while clipping only the integral', async () => {
  const s = setup()
  await s.initialize('ready')
  assert.deepEqual(s.f2Window, [200, 600])
  assert.equal(s.derived.eligibleColumns, 4)
  assert.equal(s.derived.validF2Columns, 4)
  assert.equal(s.pick(0, 0), true)
  assert.equal(s.applyBounds(null, [100, 200]), true)
  assert.equal(s.derivedPoint.f2.quality, 'valid')
  assert.equal(s.derivedPoint.f2.peak.hmF2, 350)
  assert.ok(Math.abs(s.derivedPoint.f2.peak.foF2 - 8.98) < 1e-6)
  assert.deepEqual(s.derived.integrationRange, [100, 200])
  assert.equal(s.applyF2Window([400, 600]), true)
  assert.equal(s.derivedPoint.f2.quality, 'boundary-peak')
  assert.equal(s.derivedPoint.f2.peak, null)
  assert.equal(s.profile.altitudes.at(-1), 200)
  assert.equal(s.derivedPoint.altitudes.at(-1), 700)
  s.dispose()
})
test('new file resets the independent F2 window before its load completes; same file retains it', async () => {
  let pending = false,
    finish
  const second = {
    id: 'second-file',
    imports: [
      { id: 'second-ready', status: 'ready', parameter: 'Ne', timestamp: stamp, timeIndex: 0 },
    ],
  }
  const s = setup(
    () =>
      pending
        ? new Promise((resolve) => {
            finish = resolve
          })
        : Promise.resolve(frame()),
    [second]
  )
  await s.initialize('ready')
  s.applyF2Window([250, 550])
  s.pick(0, 0)
  await s.selectImport('ready')
  assert.deepEqual(s.f2Window, [250, 550])
  assert.ok(s.derivedPoint)
  pending = true
  const request = s.selectDataset('second-file')
  assert.deepEqual(s.f2Window, [200, 600])
  assert.equal(s.point, null)
  assert.equal(s.derived, null)
  finish(frame())
  await request
  assert.deepEqual(s.derived.f2Window, [200, 600])
  s.dispose()
})
test('invalid F2 requests do not clip silently or replace the committed window', async () => {
  const s = setup()
  await s.initialize('ready')
  for (const range of [
    [600, 200],
    [50, 500],
    [200, 800],
    [NaN, 600],
    [300, 300],
  ]) {
    assert.equal(s.applyF2Window(range), false)
    assert.deepEqual(s.f2Window, [200, 600])
    assert.ok(s.inputError)
  }
  s.dispose()
})
test('narrow source retains explicit default-window coverage failure, not a silent F2 window shrink', async () => {
  const s = setup(async () => frame(500))
  await s.initialize('ready')
  assert.deepEqual(s.f2Window, [200, 600])
  assert.equal(s.derived.validF2Columns, 0)
  assert.equal(s.derived.qualityCounts.f2['outside-coverage'], 4)
  assert.equal(s.derived.validContentColumns, 4)
  s.dispose()
})
test('pending load and disposal immediately remove derived grids and scalar point results', async () => {
  let pending = false,
    finish
  const s = setup(() =>
    pending
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve(frame())
  )
  await s.initialize('ready')
  s.pick(0, 0)
  assert.ok(s.derivedPoint)
  pending = true
  const request = s.selectImport('ready')
  assert.equal(s.derived, null)
  assert.equal(s.derivedPoint, null)
  s.dispose()
  finish(frame())
  await request
  assert.equal(s.derived, null)
  assert.equal(s.derivedPoint, null)
  assert.deepEqual(s.f2Window, [200, 600])
})
