import type { IonosphereVolume } from '../../models/ionosphere/IonosphereVolume'
import {
  DEFAULT_F2_WINDOW,
  DERIVED_ALGORITHM,
  DERIVED_METRICS,
  DERIVED_QUALITY_LABELS,
  PEAK_RELATIVE_TOLERANCE,
  type DerivedContent,
  type DerivedF2,
  type DerivedGrid,
  type DerivedMetric,
  type DerivedProfile,
  type DerivedQuality,
  type DerivedSampledProfile,
  type HeightRange,
  type QualityCounts,
} from '../../models/ionosphere/Derived'
import { axisCenter, sampleVolume } from './interpolation'
import { containsRegion, sanitizeRegion, type GeographicRegion } from './region'
import { colorAt } from '../../cesium/ionosphere/shader/transferFunction'
export * from '../../models/ionosphere/Derived'

const valid = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0
const validRange = (r: HeightRange) => r.length === 2 && r.every(Number.isFinite) && r[0] < r[1]

/** Real-height piecewise-linear integration. Missing adjacent nodes are never bridged. */
export function deriveProfile(
  altitudes: readonly number[],
  values: readonly (number | null)[],
  integrationRange: HeightRange,
  f2Window: HeightRange = DEFAULT_F2_WINDOW
): DerivedProfile {
  const profileValid =
    altitudes.length >= 2 &&
    altitudes.length === values.length &&
    altitudes.every((h, i) => Number.isFinite(h) && (i === 0 || h > altitudes[i - 1]))
  const issue = (range: HeightRange): DerivedQuality | null => {
    if (!profileValid || !validRange(range)) return 'invalid-input'
    if (range[0] < altitudes[0] || range[1] > altitudes[altitudes.length - 1])
      return 'outside-coverage'
    return null
  }
  const at = (h: number): number | null => {
    const i = altitudes.findIndex((a) => a >= h)
    if (i < 0) return null
    if (altitudes[i] === h) return valid(values[i]) ? values[i] : null
    if (i === 0 || !valid(values[i - 1]) || !valid(values[i])) return null
    const a = values[i - 1] as number,
      b = values[i] as number
    const t = (h - altitudes[i - 1]) / (altitudes[i] - altitudes[i - 1])
    return a * (1 - t) + b * t
  }
  const clipped = (range: HeightRange) => {
    const heights = [range[0], ...altitudes.filter((h) => h > range[0] && h < range[1]), range[1]]
    return { heights, samples: heights.map(at) }
  }
  const content = (): DerivedContent => {
    const quality = issue(integrationRange)
    if (quality) return { value: null, quality, coverage: 0 }
    const { heights, samples } = clipped(integrationRange)
    let sum = 0,
      covered = 0,
      missing = false
    for (let i = 1; i < heights.length; i++) {
      const a = samples[i - 1],
        b = samples[i],
        thickness = heights[i] - heights[i - 1]
      if (!valid(a) || !valid(b)) {
        missing = true
        continue
      }
      covered += thickness
      sum += (a * 0.5 + b * 0.5) * 1e-13 * thickness
    }
    return {
      value: missing ? null : sum,
      quality: missing ? 'missing-data' : 'valid',
      coverage: missing ? Math.min(1, covered / (integrationRange[1] - integrationRange[0])) : 1,
    }
  }
  const f2 = (): DerivedF2 => {
    const quality = issue(f2Window)
    if (quality) return { quality, peak: null, candidate: null }
    const { heights, samples } = clipped(f2Window)
    if (!samples.every(valid)) return { quality: 'missing-data', peak: null, candidate: null }
    let index = 0
    for (let i = 1; i < samples.length; i++) if (samples[i] > samples[index]) index = i
    const maximum = samples[index]
    const candidate = { nmF2: maximum, hmF2: heights[index] }
    if (maximum <= 0) return { quality: 'no-positive-peak', peak: null, candidate }
    const tolerance = PEAK_RELATIVE_TOLERANCE * maximum
    if (samples.filter((v) => maximum - v <= tolerance).length > 1)
      return { quality: 'ambiguous-peak', peak: null, candidate }
    if (
      index === 0 ||
      index === samples.length - 1 ||
      maximum <= samples[index - 1] ||
      maximum <= samples[index + 1]
    )
      return { quality: 'boundary-peak', peak: null, candidate }
    return {
      quality: 'valid',
      peak: { ...candidate, foF2: 8.98e-6 * Math.sqrt(maximum) },
      candidate,
    }
  }
  return {
    content: content(),
    f2: f2(),
    integrationRange: [...integrationRange],
    f2Window: [...f2Window],
  }
}

function assertElectronDensity(volume: IonosphereVolume) {
  if ((volume.metadata.parameter ?? 'Ne') !== 'Ne') throw new Error('派生分析仅支持电子密度 Ne')
}

/** Sample the entire valid altitude domain. Edge half-cells follow sampleVolume's nearest-center extension. */
export function sampleDerivedProfile(
  volume: IonosphereVolume,
  longitude: number,
  latitude: number,
  integrationRange: HeightRange,
  f2Window: HeightRange = DEFAULT_F2_WINDOW
): DerivedSampledProfile {
  assertElectronDensity(volume)
  const m = volume.metadata,
    a = m.altitude
  const low = Math.max(a.min, m.validDomain?.altitudeMin ?? a.min)
  const high = Math.min(a.max, m.validDomain?.altitudeMax ?? a.max)
  const altitudes = [
    low,
    ...Array.from({ length: a.count }, (_, i) => axisCenter(i, a)).filter(
      (h) => h > low && h < high
    ),
    high,
  ]
  const values = altitudes.map((h) => {
    const value = sampleVolume(volume, longitude, latitude, h)
    return valid(value) ? value : null
  })
  return {
    longitude,
    latitude,
    altitudes,
    values,
    ...deriveProfile(altitudes, values, integrationRange, f2Window),
  }
}

const counts = (): QualityCounts =>
  Object.fromEntries(Object.keys(DERIVED_QUALITY_LABELS).map((q) => [q, 0])) as QualityCounts
const metrics = Object.keys(DERIVED_METRICS) as DerivedMetric[]

/** Center-selected columns; mean content uses exact spherical cell area, clipped only to valid data latitude. */
export function deriveGrid(
  volume: IonosphereVolume,
  region: GeographicRegion | null,
  integrationRange: HeightRange,
  f2Window: HeightRange = DEFAULT_F2_WINDOW
): DerivedGrid {
  assertElectronDensity(volume)
  const selectedRegion = sanitizeRegion(region)
  if (region && !selectedRegion) throw new Error('研究区域范围无效')
  const m = volume.metadata,
    size = m.longitude.count * m.latitude.count
  const grid: DerivedGrid = {
    longitude: { ...m.longitude },
    latitude: { ...m.latitude },
    values: {
      content: Array(size).fill(null),
      nmF2: Array(size).fill(null),
      hmF2: Array(size).fill(null),
      foF2: Array(size).fill(null),
    },
    ranges: { content: null, nmF2: null, hmF2: null, foF2: null },
    eligibleColumns: 0,
    validContentColumns: 0,
    validF2Columns: 0,
    qualityCounts: { content: counts(), f2: counts() },
    meanContent: null,
    peak: null,
    integrationRange: [...integrationRange],
    f2Window: [...f2Window],
    algorithm: DERIVED_ALGORITHM,
  }
  let weighted = 0,
    weightSum = 0
  const south = Math.max(m.latitude.min, m.validDomain?.latitudeMin ?? -90)
  const north = Math.min(m.latitude.max, m.validDomain?.latitudeMax ?? 90)
  const radians = Math.PI / 180
  for (let y = 0; y < m.latitude.count; y++) {
    const latitude = axisCenter(y, m.latitude)
    if (latitude < south || latitude > north) continue
    const cellSouth = Math.max(south, m.latitude.min + y * m.latitude.step)
    const cellNorth = Math.min(north, m.latitude.min + (y + 1) * m.latitude.step)
    const latitudeWeight = Math.sin(cellNorth * radians) - Math.sin(cellSouth * radians)
    for (let x = 0; x < m.longitude.count; x++) {
      const longitude = axisCenter(x, m.longitude)
      if (!containsRegion(selectedRegion, longitude, latitude)) continue
      const p = sampleDerivedProfile(volume, longitude, latitude, integrationRange, f2Window)
      const index = y * m.longitude.count + x
      grid.eligibleColumns++
      grid.qualityCounts.content[p.content.quality]++
      grid.qualityCounts.f2[p.f2.quality]++
      if (p.content.quality === 'valid' && p.content.value !== null) {
        grid.values.content[index] = p.content.value
        grid.validContentColumns++
        const width =
          Math.min(m.longitude.max, m.longitude.min + (x + 1) * m.longitude.step) -
          (m.longitude.min + x * m.longitude.step)
        const weight = width * radians * latitudeWeight
        weighted += p.content.value * weight
        weightSum += weight
      }
      if (p.f2.quality === 'valid' && p.f2.peak) {
        grid.validF2Columns++
        for (const metric of ['nmF2', 'hmF2', 'foF2'] as const)
          grid.values[metric][index] = p.f2.peak[metric]
        if (!grid.peak || p.f2.peak.nmF2 > grid.peak.nmF2)
          grid.peak = { ...p.f2.peak, longitude, latitude }
      }
      for (const metric of metrics) {
        const value = grid.values[metric][index]
        if (value === null) continue
        const range = grid.ranges[metric]
        grid.ranges[metric] = range
          ? [Math.min(range[0], value), Math.max(range[1], value)]
          : [value, value]
      }
    }
  }
  grid.meanContent = weightSum > 0 ? weighted / weightSum : null
  return grid
}

/** Image row zero is north; invalid results are transparent and real zeros retain color. */
export function derivedRaster(
  grid: Pick<DerivedGrid, 'longitude' | 'latitude' | 'values' | 'ranges'>,
  metric: DerivedMetric
): Uint8ClampedArray {
  const nx = grid.longitude.count,
    ny = grid.latitude.count
  const result = new Uint8ClampedArray(nx * ny * 4),
    range = grid.ranges[metric]
  if (!range) return result
  const [lo, hi] = range
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const value = grid.values[metric][y * nx + x]
      if (!valid(value)) continue
      const color = colorAt(hi > lo ? (value - lo) / (hi - lo) : 0.5, 'blue-red')
      const offset = ((ny - 1 - y) * nx + x) * 4
      color.forEach((c, k) => {
        result[offset + k] = Math.round(c * 255)
      })
      result[offset + 3] = 255
    }
  return result
}
