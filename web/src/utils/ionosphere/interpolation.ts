import type {
  IonosphereAxis,
  IonosphereVolume,
  InterpolationMode,
} from '../../models/ionosphere/IonosphereVolume'
export const gridIndex = (x: number, y: number, z: number, nx: number, ny: number): number =>
  z * ny * nx + y * nx + x
export const wrapLongitude = (lon: number): number =>
  lon >= -180 && lon < 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180
/** Fractional cell-center index, not a vertex index. */
export const axisCoordinate = (value: number, axis: IonosphereAxis): number => {
  const index = (value - axis.min) / axis.step - 0.5
  const knot = Math.round(index)
  // Include coordinate subtraction error, especially near index zero on a
  // negative-origin axis. Only ULP-scale weights snap, never real offsets.
  const errorScale = Math.max(
    1,
    Math.abs(index),
    (Math.abs(value) + Math.abs(axis.min)) / Math.abs(axis.step)
  )
  return Math.abs(index - knot) <= 8 * Number.EPSILON * errorScale ? knot : index
}
export const axisCenter = (index: number, axis: IonosphereAxis): number =>
  axis.min + (index + 0.5) * axis.step
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x))
/** Global longitude is periodic; regional longitude is closed. Edge half-cells extend nearest center.
 * Any noData neighbor with nonzero weight yields null (no invented science data).
 */
export function sampleVolume(
  volume: IonosphereVolume,
  lon: number,
  lat: number,
  altitude: number,
  method: InterpolationMode = 'trilinear'
): number | null {
  const m = volume.metadata
  if (
    ![lon, lat, altitude].every(Number.isFinite) ||
    lat < m.latitude.min ||
    lat > m.latitude.max ||
    altitude < m.altitude.min ||
    altitude > m.altitude.max
  )
    return null
  const domain = m.validDomain
  if (
    domain &&
    (lat < domain.latitudeMin ||
      lat > domain.latitudeMax ||
      altitude < domain.altitudeMin ||
      altitude > domain.altitudeMax)
  )
    return null
  const nx = m.longitude.count,
    ny = m.latitude.count
  const periodic = Math.abs(m.longitude.max - m.longitude.min - 360) < 1e-6
  const longitude = wrapLongitude(lon)
  if (!periodic && (longitude < m.longitude.min || longitude > m.longitude.max)) return null
  const x = periodic
    ? axisCoordinate(longitude, m.longitude)
    : clamp(axisCoordinate(longitude, m.longitude), 0, nx - 1)
  const y = clamp(axisCoordinate(lat, m.latitude), 0, ny - 1),
    z = clamp(axisCoordinate(altitude, m.altitude), 0, m.altitude.count - 1)
  const at = (i: number, j: number, k: number) =>
    volume.values[gridIndex(periodic ? ((i % nx) + nx) % nx : clamp(i, 0, nx - 1), j, k, nx, ny)]
  const valid = (v: number) => Number.isFinite(v) && v !== m.noDataValue
  if (method === 'nearest') {
    const v = at(Math.round(x), Math.round(y), Math.round(z))
    return valid(v) ? v : null
  }
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z),
    fx = x - ix,
    fy = y - iy,
    fz = z - iz
  let result = 0
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz)
        if (weight === 0) continue
        const v = at(ix + dx, Math.min(iy + dy, ny - 1), Math.min(iz + dz, m.altitude.count - 1))
        if (!valid(v)) return null
        result += v * weight
      }
  return result
}
