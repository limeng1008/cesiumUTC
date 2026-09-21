import type {
  IonosphereAxis,
  IonosphereVolume,
  VolumeSettings,
} from '../../models/ionosphere/IonosphereVolume'
import { displayRegion, longitudeSpan } from './region'
import { sampleVolume } from './interpolation'
export interface RangeStatistics {
  range: [number, number] | null
  count: number
}
/** Metadata extrema describe this loaded grid, not the entire source time series. */
export function globalValueRange(
  volume: IonosphereVolume,
  normalization: VolumeSettings['normalization']
): RangeStatistics {
  const { minValue, maxValue, noDataValue } = volume.metadata
  if (
    Number.isFinite(minValue) &&
    Number.isFinite(maxValue) &&
    maxValue >= minValue &&
    (normalization === 'log' ? minValue > 0 : minValue >= 0)
  )
    return { range: [minValue, maxValue], count: volume.values?.length ?? 0 }
  let min = Infinity,
    max = -Infinity,
    count = 0
  for (const value of volume.values) {
    if (
      !Number.isFinite(value) ||
      value === noDataValue ||
      value < 0 ||
      (normalization === 'log' && value === 0)
    )
      continue
    min = Math.min(min, value)
    max = Math.max(max, value)
    count++
  }
  return { range: count ? [min, max] : null, count }
}
const axisSamples = (axis: IonosphereAxis, lo: number, hi: number) => {
  const points = [lo, hi]
  for (let i = 0; i < axis.count; i++) {
    const p = axis.min + (i + 0.5) * axis.step
    if (p > lo && p < hi) points.push(p)
  }
  return points
}
/** Trilinear extrema lie on cell/crop boundaries; do not scan all source times. */
export function regionalValueRange(
  volume: IonosphereVolume,
  settings: Pick<VolumeSettings, 'region' | 'altitudeRange' | 'normalization'> &
    Partial<Pick<VolumeSettings, 'interpolation'>>
): RangeStatistics {
  const m = volume.metadata,
    r = displayRegion(settings.region, m)
  if (!r) return { range: null, count: 0 }
  const low = Math.max(
    settings.altitudeRange[0],
    m.altitude.min,
    m.validDomain?.altitudeMin ?? -Infinity
  )
  const high = Math.min(
    settings.altitudeRange[1],
    m.altitude.max,
    m.validDomain?.altitudeMax ?? Infinity
  )
  if (high < low) return { range: null, count: 0 }
  const end = r.west + longitudeSpan(r),
    lons = [r.west, end]
  for (let i = 0; i < m.longitude.count; i++) {
    const raw = m.longitude.min + (i + 0.5) * m.longitude.step,
      p = r.west + ((((raw - r.west) % 360) + 360) % 360)
    if (p > r.west && p < end) lons.push(p)
  }
  let min = Infinity,
    max = -Infinity,
    count = 0
  for (const h of axisSamples(m.altitude, low, high))
    for (const lat of axisSamples(m.latitude, r.south, r.north))
      for (const lon of lons) {
        const v = sampleVolume(volume, lon, lat, h, settings.interpolation ?? 'trilinear')
        if (v == null || !Number.isFinite(v) || (settings.normalization === 'log' && v <= 0))
          continue
        min = Math.min(min, v)
        max = Math.max(max, v)
        count++
      }
  return { range: count ? [min, max] : null, count }
}
export function expandedRange(range: [number, number]): [number, number] {
  const [lo, hi] = range
  return hi > lo ? [lo, hi] : [lo, lo + Math.max(1e-30, Math.abs(lo) * 1e-6)]
}
