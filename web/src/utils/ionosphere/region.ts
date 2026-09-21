import type {
  IonosphereVolumeMetadata,
  SamplePosition,
} from '../../models/ionosphere/IonosphereVolume'
import { wrapLongitude } from './interpolation'

/** Degrees. east < west represents a rectangle crossing the antimeridian. */
export interface GeographicRegion {
  west: number
  south: number
  east: number
  north: number
}
export function longitudeSpan(region: GeographicRegion): number {
  const width = region.east - region.west
  return width < 0 ? width + 360 : width
}
export function sanitizeRegion(
  region: GeographicRegion | null | undefined
): GeographicRegion | null {
  if (!region) return null
  const { west, south, east, north } = region
  if (![west, south, east, north].every(Number.isFinite)) return null
  if (west < -180 || west > 180 || east < -180 || east > 180 || south < -90 || north > 90)
    return null
  if (north - south < 0.01 || longitudeSpan(region) < 0.01) return null
  return { west, south, east, north }
}
export function regionFromCorners(
  a: Pick<SamplePosition, 'longitude' | 'latitude'>,
  b: Pick<SamplePosition, 'longitude' | 'latitude'>
): GeographicRegion | null {
  const x = wrapLongitude(a.longitude),
    y = wrapLongitude(b.longitude)
  const west = Math.min(x, y),
    east = Math.max(x, y)
  return sanitizeRegion({
    west: east - west > 180 ? east : west,
    east: east - west > 180 ? west : east,
    south: Math.min(a.latitude, b.latitude),
    north: Math.max(a.latitude, b.latitude),
  })
}
export function containsRegion(
  region: GeographicRegion | null,
  longitude: number,
  latitude: number
): boolean {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false
  if (!region) return true
  const offset = (((wrapLongitude(longitude) - region.west) % 360) + 360) % 360
  return (
    latitude >= region.south && latitude <= region.north && offset <= longitudeSpan(region) + 1e-9
  )
}
/** Intersect only the displayed region with the supported data domain, never stretch data. */
export function displayRegion(
  region: GeographicRegion | null,
  metadata: IonosphereVolumeMetadata
): GeographicRegion | null {
  const bounds = region ?? { west: -180, east: 180, south: -90, north: 90 }
  const south = Math.max(bounds.south, metadata.validDomain?.latitudeMin ?? metadata.latitude.min)
  const north = Math.min(bounds.north, metadata.validDomain?.latitudeMax ?? metadata.latitude.max)
  if (north <= south) return null
  if (metadata.longitude.max - metadata.longitude.min < 360 - 1e-6) {
    const segments =
      bounds.east < bounds.west
        ? [
            [bounds.west, 180],
            [-180, bounds.east],
          ]
        : [[bounds.west, bounds.east]]
    for (const [lo, hi] of segments) {
      const west = Math.max(lo, metadata.longitude.min),
        east = Math.min(hi, metadata.longitude.max)
      if (east > west) return { west, east, south, north }
    }
    return null
  }
  return { ...bounds, south, north }
}
