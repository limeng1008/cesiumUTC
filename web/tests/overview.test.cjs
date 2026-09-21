const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  ts = require('typescript')
require.extensions['.ts'] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    f
  )
const axis = (min, max, count) => ({ min, max, count, step: (max - min) / count })
const metadata = {
  id: 'overview',
  longitude: axis(-180, 180, 4),
  latitude: axis(-60, 60, 3),
  altitude: axis(100, 700, 6),
  minValue: 1e11,
  maxValue: 1e11,
  noDataValue: -999,
}
const constant = { metadata, values: new Float32Array(72).fill(1e11) }
const api = () => require('../src/utils/ionosphere/overview.ts')
test('trend uses elapsed UTC time, including nonuniform samples and single timestamps', () => {
  const times = ['2019-04-25T00:00:00Z', '2019-04-25T00:10:00Z', '2019-04-25T06:00:00Z']
  assert.equal(api().overviewTimePosition(times[0], times[0], times[2]), 0)
  assert.equal(api().overviewTimePosition(times[2], times[0], times[2]), 1)
  assert.equal(api().overviewTimePosition(times[1], times[0], times[2]), 1 / 36)
  assert.equal(api().overviewTimePosition(times[0], times[0], times[0]), 0)
})
test('constant column integrates physical height thickness in TECU and identifies limited peak', () => {
  const p = api().overviewProfile(constant, 0, 0)
  assert.ok(Math.abs(p.tec - 6) < 1e-6)
  assert.equal(p.altitudes[0], 100)
  assert.equal(p.altitudes.at(-1), 700)
  assert.equal(p.peak, null)
  assert.equal(p.f2Quality, 'ambiguous-peak')
  assert.equal(api().overviewProfile(constant, 0, 80).tec, null)
})
test('F2 peak searches only 200–600 km and missing segments do not become zero TEC', () => {
  const profile = api().profileMetrics(
    [100, 200, 300, 400, 500, 600, 700],
    [9e11, 1e11, 3e11, 5e11, 2e11, 1e11, 8e11]
  )
  assert.equal(profile.peak.nmF2, 5e11)
  assert.equal(profile.peak.hmF2, 400)
  assert.equal(profile.peak.boundary, false)
  assert.ok(Math.abs(profile.peak.foF2 - 8.98e-6 * Math.sqrt(5e11)) < 1e-10)
  const missing = api().profileMetrics(
    [100, 200, 300, 400, 500, 600, 700],
    [null, 1e11, 3e11, 5e11, 2e11, 1e11, 8e11]
  )
  assert.equal(missing.tec, null)
  assert.equal(missing.peak.nmF2, 5e11)
  assert.equal(api().profileMetrics([100, 200, 300], [1e11, null, 1e11]).peak, null)
})
test('homepage and shared derived core have identical content and valid-only peak semantics', () => {
  const derived = require('../src/utils/ionosphere/derived.ts')
  const volume = {
    metadata,
    values: Float32Array.from({ length: 72 }, (_, i) => (Math.floor(i / 12) === 2 ? 1e12 : 1e11)),
  }
  const common = derived.deriveGrid(volume, null, [100, 700])
  const home = api().analyzeOverview(volume)
  assert.equal(home.meanTec, common.meanContent)
  assert.equal(home.validF2Columns, common.validF2Columns)
  assert.deepEqual(home.qualityCounts, common.qualityCounts)
  assert.equal(home.peak.foF2, common.peak.foF2)
  const boundary = api().profileMetrics([100, 200, 300, 400, 500, 600, 700], [1, 2, 3, 4, 5, 6, 7])
  assert.equal(boundary.peak, null)
  assert.equal(boundary.f2Quality, 'boundary-peak')
})
test('global TEC mean uses spherical cell area, and peak altitude belongs to its maximum location', () => {
  const volume = {
    metadata,
    values: Float32Array.from({ length: 72 }, (_, i) => {
      const y = Math.floor(i / 4) % 3,
        z = Math.floor(i / 12)
      return (y === 1 ? 3e11 : 1e11) * (z === 2 ? 2 : 1)
    }),
  }
  const a = api().analyzeOverview(volume)
  const weights = [Math.cos((40 * Math.PI) / 180), 1, Math.cos((40 * Math.PI) / 180)]
  const expected =
    (7 * (weights[0] + 3 * weights[1] + weights[2])) / weights.reduce((s, x) => s + x, 0)
  assert.ok(Math.abs(a.meanTec - expected) < 1e-5)
  assert.equal(a.validColumns, 12)
  assert.equal(a.peak.latitude, 0)
  assert.equal(a.peak.hmF2, 350)
  const bad = { metadata, values: new Float32Array(72).fill(-999) }
  assert.equal(api().analyzeOverview(bad).range, null)
  assert.equal(api().analyzeOverview(bad).peak, null)
})
test('TEC raster puts north at top, excludes missing pixels and maps preview corners', () => {
  const grid = {
    longitude: axis(-180, 180, 2),
    latitude: axis(-90, 90, 2),
    values: [0, 1, 2, null],
    range: [0, 2],
  }
  const raster = api().tecRaster(grid)
  assert.equal(raster[3], 255)
  assert.equal(raster[7], 0)
  assert.ok(raster[0] > raster[2])
  assert.ok(raster[10] > raster[8])
  assert.deepEqual(api().tecPosition(grid, 0, 0), { longitude: -180, latitude: 90 })
  assert.deepEqual(api().tecPosition(grid, 1, 1), { longitude: 180, latitude: -90 })
  assert.equal(api().tecPosition(grid, -0.1, 0.5), null)
})
