const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    f
  )
const api = () => {
  assert.ok(fs.existsSync('src/utils/ionosphere/derived.ts'), 'shared derived core must exist')
  return require('../src/utils/ionosphere/derived.ts')
}
const close = (actual, expected, tolerance = 1e-10) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${actual} ≈ ${expected}`
  )
const axis = (min, max, count) => ({ min, max, count, step: (max - min) / count })
const volume = (fn = () => 1e11) => ({
  metadata: {
    parameter: 'Ne',
    longitude: axis(-180, 180, 4),
    latitude: axis(-60, 60, 3),
    altitude: axis(100, 700, 6),
    noDataValue: -999,
  },
  values: Float32Array.from({ length: 72 }, (_, i) =>
    fn(i % 4, Math.floor(i / 4) % 3, Math.floor(i / 12))
  ),
})
const levels = [100, 200, 300, 400, 500, 600, 700]
const peaked = [1e11, 2e11, 5e11, 1e12, 4e11, 2e11, 1e11]

test('already canonical regional longitude retains exact cell-center precision', () => {
  const v = volume()
  v.metadata.longitude = axis(-1, 1, 73)
  v.metadata.latitude = axis(-60, 60, 1)
  v.values = Float32Array.from({ length: 73 * 6 }, (_, i) => (i % 73 === 0 ? -999 : 1e11))
  const lon = -1 + 1.5 * v.metadata.longitude.step
  assert.equal(api().sampleDerivedProfile(v, lon, 0, [100, 700]).content.quality, 'valid')
  assert.equal(api().deriveGrid(v, null, [100, 700]).validContentColumns, 72)
  assert.equal(
    api().sampleDerivedProfile(v, lon - 0.001, 0, [100, 700]).content.quality,
    'missing-data'
  )
})

test('periodic exact centers survive cancellation near the first longitude index', () => {
  const v = volume()
  v.metadata.longitude = axis(-180, 180, 73)
  v.metadata.latitude = axis(-60, 60, 1)
  v.values = Float32Array.from({ length: 73 * 6 }, (_, i) => (i % 73 === 72 ? -999 : 1e11))
  const lon = -180 + v.metadata.longitude.step / 2
  const p = api().sampleDerivedProfile(v, lon, 0, [100, 700])
  assert.equal(p.content.quality, 'valid')
  assert.equal(api().deriveGrid(v, null, [100, 700]).validContentColumns, 72)
  assert.equal(
    api().sampleDerivedProfile(v, lon - 0.001, 0, [100, 700]).content.quality,
    'missing-data'
  )
})

test('version, default window, quality labels and metric units are stable', () => {
  const a = api()
  assert.equal(a.DERIVED_ALGORITHM, 'ne-derived-v1')
  assert.deepEqual(a.DEFAULT_F2_WINDOW, [200, 600])
  assert.equal(a.PEAK_RELATIVE_TOLERANCE, 1e-6)
  for (const q of [
    'valid',
    'invalid-input',
    'outside-coverage',
    'missing-data',
    'no-positive-peak',
    'ambiguous-peak',
    'boundary-peak',
  ])
    assert.equal(typeof a.DERIVED_QUALITY_LABELS[q], 'string')
  assert.equal(a.DERIVED_METRICS.content.unit, 'TECU')
  assert.equal(a.DERIVED_METRICS.foF2.unit, 'MHz')
})
test('constant and linear nonuniform profiles integrate exact clipped bounds', () => {
  close(api().deriveProfile([100, 240, 700], [1e11, 1e11, 1e11], [130, 670]).content.value, 5.4)
  const heights = [100, 175, 420, 700]
  const p = api().deriveProfile(
    heights,
    heights.map((h) => 2e9 * h),
    [125, 650]
  )
  close(p.content.value, 1e-4 * (650 ** 2 - 125 ** 2))
  assert.equal(p.content.coverage, 1)
  assert.equal(p.content.quality, 'valid')
})
test('zero is valid content but not a positive peak; constant positive is ambiguous', () => {
  const p = api().deriveProfile(
    levels,
    levels.map(() => 0),
    [100, 700]
  )
  assert.deepEqual(p.content, { value: 0, quality: 'valid', coverage: 1 })
  assert.equal(p.f2.quality, 'no-positive-peak')
  assert.equal(p.f2.peak, null)
  assert.equal(
    api().deriveProfile(
      levels,
      levels.map(() => 3),
      [100, 700]
    ).f2.quality,
    'ambiguous-peak'
  )
})
test('missing neighbors never bridge gaps or masquerade as partial integral', () => {
  const p = api().deriveProfile([100, 200, 300, 500], [1e11, 1e11, null, 1e11], [100, 500])
  assert.deepEqual(p.content, { value: null, quality: 'missing-data', coverage: 0.25 })
  for (const bad of [null, NaN, -1, Infinity]) {
    assert.equal(
      api().deriveProfile([100, 200, 300], [bad, 1e11, 1e11], [150, 300]).content.quality,
      'missing-data'
    )
    close(api().deriveProfile([100, 200, 300], [bad, 1e11, 1e11], [200, 300]).content.value, 1)
  }
})
test('invalid arrays and ranges have priority, while requested ranges remain independent', () => {
  for (const heights of [[100, 100], [200, 100], [NaN, 200], [100]]) {
    const p = api().deriveProfile(
      heights,
      heights.map(() => null),
      [50, 900]
    )
    assert.equal(p.content.quality, 'invalid-input')
    assert.equal(p.f2.quality, 'invalid-input')
  }
  assert.equal(api().deriveProfile(levels, [1], [100, 700]).content.quality, 'invalid-input')
  for (const range of [
    [700, 100],
    [100, 100],
    [NaN, 700],
    [100, Infinity],
  ]) {
    const p = api().deriveProfile(levels, peaked, range)
    assert.equal(p.content.quality, 'invalid-input')
    assert.equal(p.f2.quality, 'valid')
    assert.equal(api().deriveProfile(levels, peaked, [100, 700], range).f2.quality, 'invalid-input')
  }
})
test('out of domain never silently clips and takes priority over missing values', () => {
  const p = api().deriveProfile([250, 350, 450, 550], [null, 3, 1, 0], [200, 550])
  assert.deepEqual(p.content, { value: null, quality: 'outside-coverage', coverage: 0 })
  assert.equal(p.f2.quality, 'outside-coverage')
  assert.equal(p.f2.peak, null)
})
test('F2 accepts unique internal peaks and uses the MHz plasma-frequency formula', () => {
  const p = api().deriveProfile(levels, peaked, [100, 200])
  assert.equal(p.f2.quality, 'valid')
  assert.deepEqual(p.f2.peak, { nmF2: 1e12, hmF2: 400, foF2: 8.98 })
  assert.deepEqual(p.integrationRange, [100, 200])
  assert.deepEqual(p.f2Window, [200, 600])
})
test('F2 missing-data is scoped to its independent window and exact endpoints', () => {
  const outside = api().deriveProfile(levels, [null, ...peaked.slice(1, 6), null], [100, 700])
  assert.equal(outside.content.quality, 'missing-data')
  assert.equal(outside.f2.quality, 'valid')
  const inside = [...peaked]
  inside[3] = null
  assert.equal(api().deriveProfile(levels, inside, [100, 200]).f2.quality, 'missing-data')
  const clipped = api().deriveProfile(levels, peaked, [100, 700], [250, 550])
  assert.equal(clipped.f2.peak.hmF2, 400)
})
test('monotonic and edge peaks are diagnostic candidates only', () => {
  for (const values of [levels, [...levels].reverse()]) {
    const p = api().deriveProfile(levels, values, [100, 700])
    assert.equal(p.f2.quality, 'boundary-peak')
    assert.equal(p.f2.peak, null)
    assert.ok(p.f2.candidate)
    assert.equal(p.f2.candidate.foF2, undefined)
  }
})
test('ties and tolerance-level plateaus take priority over boundary status', () => {
  for (const values of [
    [1, 9, 9, 1, 1, 1, 1],
    [1, 1, 9, 1, 9, 1, 1],
    [1, 1, 9, 9 * (1 - 0.5e-6), 1, 1, 1],
  ]) {
    const p = api().deriveProfile(levels, values, [100, 700])
    assert.equal(p.f2.quality, 'ambiguous-peak')
    assert.equal(p.f2.peak, null)
  }
  assert.equal(
    api().deriveProfile(levels, [1, 1, 9, 9 * (1 - 2e-6), 1, 1, 1], [100, 700]).f2.quality,
    'valid'
  )
})
test('volume sampling preserves full domain, edge extension, valid bounds and missing values', () => {
  const v = volume((x, y, z) => (z === 2 ? 1e12 : 1e11))
  const p = api().sampleDerivedProfile(v, -135, -40, [100, 200])
  assert.deepEqual(p.altitudes, [100, 150, 250, 350, 450, 550, 650, 700])
  assert.equal(p.f2.peak.hmF2, 350)
  close(p.content.value, 1, 1e-6)
  v.metadata.validDomain = { latitudeMin: -60, latitudeMax: 60, altitudeMin: 125, altitudeMax: 675 }
  const clipped = api().sampleDerivedProfile(v, -135, -40, [100, 200])
  assert.equal(clipped.altitudes[0], 125)
  assert.equal(clipped.altitudes.at(-1), 675)
  assert.equal(clipped.content.quality, 'outside-coverage')
  assert.equal(clipped.f2.quality, 'valid')
  v.values[0] = -999
  assert.equal(api().sampleDerivedProfile(v, -135, -40, [125, 200]).content.quality, 'missing-data')
})
test('only electron density is accepted, including legacy parameter omission', () => {
  for (const parameter of ['Te', 'Ti', 'O+']) {
    const v = volume()
    v.metadata.parameter = parameter
    assert.throws(() => api().sampleDerivedProfile(v, 0, 0, [100, 700]))
    assert.throws(() => api().deriveGrid(v, null, [100, 700]))
  }
  const v = volume()
  delete v.metadata.parameter
  assert.equal(api().deriveGrid(v, null, [100, 700]).validContentColumns, 12)
})
test('exact physical grid knots stay valid despite fractional-step roundoff and missing neighbors', () => {
  const v = volume((x, y, z) => (z === 3 ? 1e12 : 1e11))
  v.metadata.altitude = axis(100, 700, 7)
  v.values = Float32Array.from({ length: 84 }, (_, i) =>
    Math.floor(i / 12) === 4 ? -999 : Math.floor(i / 12) === 3 ? 1e12 : 1e11
  )
  const p = api().sampleDerivedProfile(v, -135, -40, [100, 400], [200, 400])
  assert.equal(p.altitudes[4], 400)
  assert.ok(p.values[4] > 0)
  assert.equal(p.content.quality, 'valid')
  assert.equal(p.f2.quality, 'boundary-peak')
  const { sampleVolume } = require('../src/utils/ionosphere/interpolation.ts')
  assert.equal(sampleVolume(v, -135, -40, 400.001), null)
})
test('grid retains XY shape, selects antimeridian centers, and counts every eligible quality', () => {
  const v = volume((x, y, z) => (z === 2 ? 1e12 : 1e11))
  const grid = api().deriveGrid(v, { west: 120, east: -120, south: -60, north: 60 }, [100, 700])
  assert.equal(grid.values.content.length, 12)
  assert.equal(grid.eligibleColumns, 6)
  assert.equal(grid.validContentColumns, 6)
  assert.equal(grid.validF2Columns, 6)
  assert.equal(grid.values.content[1], null)
  assert.equal(grid.qualityCounts.content.valid, 6)
  assert.equal(
    Object.values(grid.qualityCounts.f2).reduce((a, b) => a + b, 0),
    6
  )
  assert.equal(grid.peak.longitude, -135)
  assert.equal(grid.peak.latitude, -40)
  assert.equal(grid.peak.hmF2, 350)
  close(grid.peak.foF2, 8.98, 1e-6)
  assert.equal(grid.algorithm, 'ne-derived-v1')
})
test('area mean clips actual cell edges to valid latitude, but uses center-only research selection', () => {
  const v = volume((x, y) => (y + 1) * 1e11)
  v.metadata.validDomain = { latitudeMin: -45, latitudeMax: 45, altitudeMin: 100, altitudeMax: 700 }
  const grid = api().deriveGrid(v, { west: -150, east: 0, south: -42, north: 10 }, [100, 700])
  const a = Math.sin((-20 * Math.PI) / 180) - Math.sin((-45 * Math.PI) / 180)
  const b = Math.sin((20 * Math.PI) / 180) - Math.sin((-20 * Math.PI) / 180)
  const actualOne = v.values[0] * 600e-13
  const actualTwo = v.values[4] * 600e-13
  close(grid.meanContent, (actualOne * a + actualTwo * b) / (a + b))
  assert.equal(grid.eligibleColumns, 4)
  assert.equal(grid.validF2Columns, 0)
  assert.equal(grid.ranges.hmF2, null)
  assert.equal(grid.qualityCounts.f2['ambiguous-peak'], 4)
  v.metadata.validDomain.latitudeMin = -20
  assert.equal(api().deriveGrid(v, null, [100, 700]).eligibleColumns, 8)
})
test('empty regions do not invent zeros, invalid regions throw, and missing grid columns remain transparent', () => {
  const empty = api().deriveGrid(volume(), { west: 0, east: 1, south: 0, north: 1 }, [100, 700])
  assert.equal(empty.eligibleColumns, 0)
  assert.equal(empty.meanContent, null)
  assert.equal(empty.peak, null)
  assert.equal(empty.ranges.content, null)
  assert.throws(() =>
    api().deriveGrid(volume(), { west: 0, east: 0, south: 0, north: 1 }, [100, 700])
  )
  const v = volume()
  v.values[0] = NaN
  const grid = api().deriveGrid(v, null, [100, 700])
  assert.equal(grid.qualityCounts.content['missing-data'], 1)
  assert.equal(grid.validContentColumns, 11)
})
test('raster uses northern top row, valid zero color, null transparency, and per-metric ranges', () => {
  const grid = {
    longitude: axis(-180, 180, 2),
    latitude: axis(-90, 90, 2),
    values: { content: [0, 1, 2, null], hmF2: [null, null, null, null] },
    ranges: { content: [0, 2], hmF2: null },
  }
  const raster = api().derivedRaster(grid, 'content')
  assert.equal(raster[3], 255)
  assert.equal(raster[7], 0)
  assert.equal(raster[11], 255)
  assert.ok(raster[0] > raster[2])
  assert.ok(raster[10] > raster[8])
  assert.ok(
    api()
      .derivedRaster(grid, 'hmF2')
      .every((v) => v === 0)
  )
})
