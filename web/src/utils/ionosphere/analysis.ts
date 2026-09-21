import type { IonosphereVolume, SamplePosition } from '../../models/ionosphere/IonosphereVolume'
import { axisCenter, gridIndex, sampleVolume } from './interpolation'
import { containsRegion, sanitizeRegion, type GeographicRegion } from './region'

export interface LayerStatistics {
  altitude: number
  count: number
  eligible: number
  minimum: number | null
  maximum: number | null
  mean: number | null
}
export interface GridStatistics extends Omit<LayerStatistics, 'altitude'> {
  peak: (SamplePosition & { value: number }) | null
  layers: LayerStatistics[]
}
export interface AnalysisProfile {
  altitudes: number[]
  values: (number | null)[]
}
function checkBounds(region: GeographicRegion | null, heights: [number, number]) {
  if (region && !sanitizeRegion(region)) throw new Error('研究区域范围无效')
  if (!heights.every(Number.isFinite) || heights[0] >= heights[1])
    throw new Error('高度范围必须为递增的有限数值')
}
const valid = (value: number | null, noData?: number): value is number =>
  value !== null && Number.isFinite(value) && value >= 0 && value !== noData

/** Arithmetic mean of eligible grid-center samples, NOT a volume-weighted mean. */
export function analyzeGrid(
  volume: IonosphereVolume,
  region: GeographicRegion | null,
  heights: [number, number]
): GridStatistics {
  checkBounds(region, heights)
  const m = volume.metadata,
    d = m.validDomain
  const s: GridStatistics = {
    count: 0,
    eligible: 0,
    minimum: null,
    maximum: null,
    mean: null,
    peak: null,
    layers: [],
  }
  let total = 0
  for (let z = 0; z < m.altitude.count; z++) {
    const altitude = axisCenter(z, m.altitude)
    if (
      altitude < Math.max(heights[0], d?.altitudeMin ?? -Infinity) ||
      altitude > Math.min(heights[1], d?.altitudeMax ?? Infinity)
    )
      continue
    const layer: LayerStatistics = {
      altitude,
      count: 0,
      eligible: 0,
      minimum: null,
      maximum: null,
      mean: null,
    }
    let sum = 0
    for (let y = 0; y < m.latitude.count; y++) {
      const latitude = axisCenter(y, m.latitude)
      if (latitude < (d?.latitudeMin ?? -90) || latitude > (d?.latitudeMax ?? 90)) continue
      for (let x = 0; x < m.longitude.count; x++) {
        const longitude = axisCenter(x, m.longitude)
        if (!containsRegion(region, longitude, latitude)) continue
        layer.eligible++
        const value = volume.values[gridIndex(x, y, z, m.longitude.count, m.latitude.count)]
        if (!valid(value, m.noDataValue)) continue
        sum += value
        layer.count++
        layer.minimum = Math.min(layer.minimum ?? Infinity, value)
        layer.maximum = Math.max(layer.maximum ?? -Infinity, value)
        if (!s.peak || value > s.peak.value) s.peak = { longitude, latitude, altitude, value }
      }
    }
    layer.mean = layer.count ? sum / layer.count : null
    s.layers.push(layer)
    s.count += layer.count
    s.eligible += layer.eligible
    total += sum
    if (layer.minimum !== null) s.minimum = Math.min(s.minimum ?? Infinity, layer.minimum)
    if (layer.maximum !== null) s.maximum = Math.max(s.maximum ?? -Infinity, layer.maximum)
  }
  s.mean = s.count ? total / s.count : null
  return s
}

/** Same trilinear sampling as the 3D probe; gaps remain null. */
export function pointProfile(
  volume: IonosphereVolume,
  longitude: number,
  latitude: number,
  region: GeographicRegion | null,
  heights: [number, number]
): AnalysisProfile | null {
  checkBounds(region, heights)
  const m = volume.metadata,
    d = m.validDomain
  if (
    !containsRegion(region, longitude, latitude) ||
    latitude < Math.max(m.latitude.min, d?.latitudeMin ?? -90) ||
    latitude > Math.min(m.latitude.max, d?.latitudeMax ?? 90)
  )
    return null
  if (
    m.longitude.max - m.longitude.min < 360 &&
    (longitude < m.longitude.min || longitude > m.longitude.max)
  )
    return null
  const low = Math.max(heights[0], m.altitude.min, d?.altitudeMin ?? -Infinity),
    high = Math.min(heights[1], m.altitude.max, d?.altitudeMax ?? Infinity)
  if (high <= low) return null
  const altitudes = [
    low,
    ...Array.from({ length: m.altitude.count }, (_, z) => axisCenter(z, m.altitude)).filter(
      (h) => h > low && h < high
    ),
    high,
  ]
  const values = altitudes.map((h) => {
    const value = sampleVolume(volume, longitude, latitude, h)
    return valid(value, m.noDataValue) ? value : null
  })
  return { altitudes, values }
}
