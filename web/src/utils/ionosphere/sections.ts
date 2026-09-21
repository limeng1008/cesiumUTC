import type {
  IonosphereVolume,
  InterpolationMode,
  VolumeSettings,
} from '../../models/ionosphere/IonosphereVolume'
import type {
  GeoPoint,
  SectionGrid,
  SectionKind,
  SectionSample,
} from '../../models/ionosphere/Section'
import { sampleVolume, wrapLongitude } from './interpolation'
import { containsRegion } from './region'
import { transfer } from '../../cesium/ionosphere/shader/transferFunction'

/** Node sampling keeps both the scientific plot and the mesh UV coordinates aligned. */
export function createSectionGrid(
  volume: IonosphereVolume,
  settings: VolumeSettings,
  positions: GeoPoint[],
  distances: number[],
  kind: SectionKind,
  rows = 128
): SectionGrid | null {
  if (positions.length < 2 || distances.length !== positions.length) return null
  if (
    positions.some((p) => !Number.isFinite(p.longitude) || !Number.isFinite(p.latitude)) ||
    distances.some((d, i) => !Number.isFinite(d) || (i > 0 && d < distances[i - 1]))
  )
    return null
  const m = volume.metadata
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
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null
  rows = Math.max(2, Math.min(512, Math.round(Number.isFinite(rows) ? rows : 128)))
  const columns = Math.min(513, positions.length)
  const indices = Array.from({ length: columns }, (_, i) =>
    Math.round((i * (positions.length - 1)) / (columns - 1))
  )
  const points = indices.map((i) => ({ ...positions[i] }))
  const altitudes = Array.from(
    { length: rows },
    (_, row) => high - (row * (high - low)) / (rows - 1)
  )
  const values = new Float32Array(columns * rows).fill(NaN)
  points.forEach((point, col) => {
    if (!containsRegion(settings.region, point.longitude, point.latitude)) return
    altitudes.forEach((altitude, row) => {
      values[row * columns + col] =
        sampleVolume(volume, point.longitude, point.latitude, altitude, settings.interpolation) ??
        NaN
    })
  })
  return {
    kind,
    columns,
    rows,
    positions: points,
    distances: indices.map((i) => distances[i]),
    altitudes,
    values,
  }
}

/** Scientific interpolation of the very same node grid used to color the curtain.
 * Any missing neighbor carrying nonzero weight makes the result unavailable. */
export function sampleSectionGrid(
  grid: SectionGrid,
  u: number,
  v: number,
  method: InterpolationMode = 'trilinear'
): SectionSample | null {
  if (![u, v].every(Number.isFinite) || u < 0 || u > 1 || v < 0 || v > 1) return null
  const x = u * (grid.columns - 1),
    y = v * (grid.rows - 1)
  const ix = Math.min(Math.floor(x), grid.columns - 2),
    iy = Math.min(Math.floor(y), grid.rows - 2)
  const fx = x - ix,
    fy = y - iy
  let value = 0
  if (method === 'nearest') {
    value = grid.values[Math.round(y) * grid.columns + Math.round(x)]
    if (!Number.isFinite(value)) return null
  } else {
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy)
        if (weight === 0) continue
        const sample = grid.values[(iy + dy) * grid.columns + ix + dx]
        if (!Number.isFinite(sample)) return null
        value += sample * weight
      }
  }
  const a = grid.positions[ix],
    b = grid.positions[ix + 1]
  return {
    longitude: wrapLongitude(a.longitude + wrapLongitude(b.longitude - a.longitude) * fx),
    latitude: a.latitude + (b.latitude - a.latitude) * fx,
    altitude: grid.altitudes[iy] + (grid.altitudes[iy + 1] - grid.altitudes[iy]) * fy,
    distance: grid.distances[ix] + (grid.distances[ix + 1] - grid.distances[ix]) * fx,
    value,
    method,
    source: 'vertical-section',
    sectionU: u,
    sectionV: v,
  }
}

export function createSectionRaster(
  grid: SectionGrid,
  settings: VolumeSettings
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(grid.values.length * 4)
  grid.values.forEach((value, index) => {
    const rgba = transfer(Number.isFinite(value) ? value : null, settings)
    rgba.forEach((component, channel) => {
      pixels[index * 4 + channel] = Math.round(component * 255)
    })
  })
  return pixels
}

/** Match the bilinear alpha of the colored texture, not just transfer(mean Ne). */
export function sectionRasterAlpha(
  grid: SectionGrid,
  settings: VolumeSettings,
  u: number,
  v: number
): number {
  if (![u, v].every(Number.isFinite) || u < 0 || u > 1 || v < 0 || v > 1) return 0
  const x = u * (grid.columns - 1),
    y = v * (grid.rows - 1),
    ix = Math.min(Math.floor(x), grid.columns - 2),
    iy = Math.min(Math.floor(y), grid.rows - 2)
  let alpha = 0
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const value = grid.values[(iy + dy) * grid.columns + ix + dx]
      const a = transfer(Number.isFinite(value) ? value : null, settings)[3]
      alpha += (Math.round(a * 255) / 255) * (dx ? x - ix : 1 - x + ix) * (dy ? y - iy : 1 - y + iy)
    }
  return alpha
}
