import type { IonosphereVolume } from '../../models/ionosphere/IonosphereVolume'
import type {
  ProfileMetrics,
  OverviewProfile,
  OverviewAnalysis,
  TecGrid,
} from '../../models/ionosphere/Overview'
import { deriveProfile, deriveGrid, sampleDerivedProfile, type DerivedProfile } from './derived'
import { colorAt } from '../../cesium/ionosphere/shader/transferFunction'

const valid = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0
/** Preserve elapsed time on charts; source time samples need not be evenly spaced. */
export function overviewTimePosition(timestamp: string, first: string, last: string): number {
  const start = Date.parse(first),
    end = Date.parse(last),
    value = Date.parse(timestamp)
  if (![start, end, value].every(Number.isFinite) || end <= start) return 0
  return Math.max(0, Math.min(1, (value - start) / (end - start)))
}
/** Compatibility adapter: all numerical decisions belong to the shared core. */
function metrics(p: DerivedProfile): ProfileMetrics {
  return {
    tec: p.content.value,
    peak: p.f2.peak ? { ...p.f2.peak, boundary: false } : null,
    contentQuality: p.content.quality,
    f2Quality: p.f2.quality,
    coverage: p.content.coverage,
  }
}
export function profileMetrics(altitudes: number[], values: (number | null)[]): ProfileMetrics {
  return metrics(deriveProfile(altitudes, values, [altitudes[0], altitudes[altitudes.length - 1]]))
}
function heightDomain(volume: IonosphereVolume): [number, number] {
  const m = volume.metadata
  return [
    Math.max(m.altitude.min, m.validDomain?.altitudeMin ?? m.altitude.min),
    Math.min(m.altitude.max, m.validDomain?.altitudeMax ?? m.altitude.max),
  ]
}
export function overviewProfile(
  volume: IonosphereVolume,
  longitude: number,
  latitude: number
): OverviewProfile {
  const p = sampleDerivedProfile(volume, longitude, latitude, heightDomain(volume))
  return { longitude, latitude, altitudes: p.altitudes, values: p.values, ...metrics(p) }
}
export function analyzeOverview(volume: IonosphereVolume): OverviewAnalysis {
  const altitudeRange = heightDomain(volume)
  const grid = deriveGrid(volume, null, altitudeRange)
  return {
    longitude: grid.longitude,
    latitude: grid.latitude,
    values: grid.values.content,
    range: grid.ranges.content,
    meanTec: grid.meanContent,
    validColumns: grid.validContentColumns,
    eligibleColumns: grid.eligibleColumns,
    validF2Columns: grid.validF2Columns,
    qualityCounts: grid.qualityCounts,
    peak: grid.peak ? { ...grid.peak, boundary: false } : null,
    altitudeRange,
  }
}
/** Image row zero is north; underlying grid rows remain south→north. */
export function tecRaster(grid: TecGrid): Uint8ClampedArray {
  const nx = grid.longitude.count,
    ny = grid.latitude.count,
    result = new Uint8ClampedArray(nx * ny * 4)
  if (!grid.range) return result
  const [lo, hi] = grid.range
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const value = grid.values[y * nx + x]
      if (!valid(value)) continue
      const color = colorAt(hi > lo ? (value - lo) / (hi - lo) : 0.5, 'blue-red'),
        i = ((ny - 1 - y) * nx + x) * 4
      color.forEach((c, k) => (result[i + k] = Math.round(c * 255)))
      result[i + 3] = 255
    }
  return result
}
export function tecPosition(
  grid: TecGrid,
  u: number,
  v: number
): { longitude: number; latitude: number } | null {
  if (![u, v].every(Number.isFinite) || u < 0 || u > 1 || v < 0 || v > 1) return null
  return {
    longitude: grid.longitude.min + u * (grid.longitude.max - grid.longitude.min),
    latitude: grid.latitude.max - v * (grid.latitude.max - grid.latitude.min),
  }
}
