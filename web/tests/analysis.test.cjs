const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  ts = require('typescript')
require.extensions['.ts'] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    f
  )
const axis = (min, max, count) => ({ min, max, count, step: (max - min) / count })
const volume = () => ({
  metadata: {
    longitude: axis(-180, 180, 4),
    latitude: axis(-60, 60, 2),
    altitude: axis(100, 500, 4),
    noDataValue: -999,
  },
  values: Float32Array.from({ length: 32 }, (_, i) => i),
})
const api = () => {
  assert.ok(fs.existsSync('src/utils/ionosphere/analysis.ts'), 'analysis core must exist')
  return require('../src/utils/ionosphere/analysis.ts')
}
test('analysis reports exact grid statistics, maximum position and per-height means', () => {
  const s = api().analyzeGrid(volume(), null, [100, 500])
  assert.equal(s.count, 32)
  assert.equal(s.eligible, 32)
  assert.equal(s.minimum, 0)
  assert.equal(s.maximum, 31)
  assert.equal(s.mean, 15.5)
  assert.deepEqual(s.peak, { longitude: 135, latitude: 30, altitude: 450, value: 31 })
  assert.deepEqual(
    s.layers.map((l) => l.mean),
    [3.5, 11.5, 19.5, 27.5]
  )
})
test('regional statistics crop center samples and honor valid domain and missing data', () => {
  const v = volume()
  v.values[24] = -999
  v.values[25] = NaN
  v.values[26] = -2
  const s = api().analyzeGrid(v, { west: -180, east: 0, south: -60, north: 0 }, [300, 500])
  assert.equal(s.count, 2)
  assert.equal(s.eligible, 4)
  assert.equal(s.mean, 16.5)
  assert.equal(s.layers[1].mean, null)
  v.metadata.validDomain = { latitudeMin: 0, latitudeMax: 60, altitudeMin: 100, altitudeMax: 400 }
  assert.equal(api().analyzeGrid(v, null, [100, 500]).count, 12)
})
test('antimeridian and empty small regions never broaden to global or invent zeros', () => {
  const s = api().analyzeGrid(
    volume(),
    { west: 120, east: -120, south: -60, north: 60 },
    [100, 500]
  )
  assert.equal(s.count, 16)
  const empty = api().analyzeGrid(volume(), { west: 0, east: 1, south: 0, north: 1 }, [100, 500])
  assert.equal(empty.mean, null)
  assert.equal(empty.peak, null)
  assert.equal(empty.count, 0)
  assert.throws(() =>
    api().analyzeGrid(volume(), { west: 0, east: 0, south: 0, north: 1 }, [100, 500])
  )
  assert.throws(() => api().analyzeGrid(volume(), null, [NaN, 500]))
})
test('point profiles use shared interpolation at real heights and preserve gaps', () => {
  const v = volume(),
    p = api().pointProfile(v, 0, 0, null, [200, 400])
  assert.deepEqual(p.altitudes, [200, 250, 350, 400])
  assert.deepEqual(p.values, [7.5, 11.5, 19.5, 23.5])
  v.values[9] = -999
  assert.equal(api().pointProfile(v, 0, 0, null, [200, 400]).values[1], null)
  assert.equal(api().pointProfile(v, 0, 85, null, [200, 400]), null)
  assert.equal(
    api().pointProfile(v, 0, 0, { west: 10, east: 20, south: -20, north: 20 }, [200, 400]),
    null
  )
})
