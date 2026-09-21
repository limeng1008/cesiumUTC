import type * as Cesium from 'cesium'
import type { GeoPoint, SectionDefinition } from '../../../models/ionosphere/Section'
import { wrapLongitude } from '../../../utils/ionosphere/interpolation'
import {
  longitudeSpan,
  sanitizeRegion,
  type GeographicRegion,
} from '../../../utils/ionosphere/region'

export interface SectionPath {
  positions: GeoPoint[]
  distances: number[]
}

/** Fixed sections keep the geographic rectangle's direction, while two-point
 * paths follow the shortest WGS84 geodesic (not a straight line in lon/lat). */
export function createSectionPath(
  C: typeof Cesium,
  definition: SectionDefinition,
  region: GeographicRegion | null,
  columns = 129
): SectionPath | null {
  columns = Math.max(2, Math.min(513, Math.round(Number.isFinite(columns) ? columns : 129)))
  const bounds = sanitizeRegion(region) ?? { west: -180, east: 180, south: -89.9, north: 89.9 }
  const sanitize = (p: GeoPoint): GeoPoint | null =>
    Number.isFinite(p.longitude) && Number.isFinite(p.latitude)
      ? { longitude: wrapLongitude(p.longitude), latitude: Math.max(-90, Math.min(90, p.latitude)) }
      : null
  let positions: GeoPoint[]
  if (definition.kind === 'path') {
    if (!definition.path) return null
    const a = sanitize(definition.path[0]),
      b = sanitize(definition.path[1])
    if (!a || !b) return null
    const start = C.Cartographic.fromDegrees(a.longitude, a.latitude)
    const end = C.Cartographic.fromDegrees(b.longitude, b.latitude)
    const cosine =
      Math.sin(start.latitude) * Math.sin(end.latitude) +
      Math.cos(start.latitude) * Math.cos(end.latitude) * Math.cos(end.longitude - start.longitude)
    // Vincenty's inverse solution is ill-conditioned near antipodal endpoints.
    if (cosine < -0.9999) return null
    try {
      const geodesic = new C.EllipsoidGeodesic(start, end, C.Ellipsoid.WGS84)
      if (!Number.isFinite(geodesic.surfaceDistance) || geodesic.surfaceDistance < 10) return null
      positions = Array.from({ length: columns }, (_, i) => {
        const point = geodesic.interpolateUsingFraction(i / (columns - 1))
        return {
          longitude: wrapLongitude(C.Math.toDegrees(point.longitude)),
          latitude: C.Math.toDegrees(point.latitude),
        }
      })
      return {
        positions,
        distances: positions.map((_, i) => ((geodesic.surfaceDistance / 1000) * i) / (columns - 1)),
      }
    } catch {
      return null
    }
  }
  const fixed = sanitize({ longitude: definition.longitude, latitude: definition.latitude })
  if (!fixed) return null
  positions = Array.from({ length: columns }, (_, i) => {
    const fraction = i / (columns - 1)
    return definition.kind === 'longitude'
      ? {
          longitude: fixed.longitude,
          latitude: bounds.south + fraction * (bounds.north - bounds.south),
        }
      : {
          longitude: wrapLongitude(bounds.west + fraction * longitudeSpan(bounds)),
          latitude: fixed.latitude,
        }
  })
  const distances = [0]
  for (let i = 1; i < positions.length; i++) {
    const a = positions[i - 1],
      b = positions[i]
    const geodesic = new C.EllipsoidGeodesic(
      C.Cartographic.fromDegrees(a.longitude, a.latitude),
      C.Cartographic.fromDegrees(b.longitude, b.latitude),
      C.Ellipsoid.WGS84
    )
    distances.push(distances[i - 1] + geodesic.surfaceDistance / 1000)
  }
  if (!Number.isFinite(distances[distances.length - 1]) || distances[distances.length - 1] < 0.01)
    return null
  return { positions, distances }
}
