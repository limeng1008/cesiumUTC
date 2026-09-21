import type * as Cesium from 'cesium'
import type {
  IonosphereSample,
  IonosphereVolume,
  SamplePosition,
  VolumeSettings,
} from '../../../models/ionosphere/IonosphereVolume'
import { sampleVolume, wrapLongitude } from '../../../utils/ionosphere/interpolation'
import { transfer } from '../shader/transferFunction'
import { containsRegion } from '../../../utils/ionosphere/region'
import { visibleSliceHeights } from '../../../utils/ionosphere/slices'

/** A transparent volume has no unique surface. Prefer the official picked cell,
 * then the strongest visible sample along the unoccluded camera ray. Sampling is
 * bounded to 8192 intervals, <= quarter-layer spacing for our supported grids.
 * This avoids assuming a limb ray intersects a cell's altitude-center shell.
 */
export function pickVolumeRay(
  C: typeof Cesium,
  viewer: Cesium.Viewer,
  pixel: Cesium.Cartesian2,
  volume: IonosphereVolume,
  settings: VolumeSettings,
  preferredIndex?: number
): IonosphereSample | null {
  if (!settings.volumeVisible || settings.opacity <= 0) return null
  const ray = viewer.camera.getPickRay(pixel)
  if (!ray) return null
  const m = volume.metadata,
    r = C.Ellipsoid.WGS84.radii
  const lo = Math.max(m.altitude.min, settings.altitudeRange[0])
  const hi = Math.min(m.altitude.max, settings.altitudeRange[1])
  if (hi <= lo) return null
  // One metre padding only for the search bound, not the accepted heights.
  const h = hi * 1000 + 1
  const interval = C.IntersectionTests.rayEllipsoid(ray, new C.Ellipsoid(r.x + h, r.y + h, r.z + h))
  if (!interval) return null
  const ground = C.IntersectionTests.rayEllipsoid(ray, C.Ellipsoid.WGS84)
  const start = Math.max(0, interval.start)
  const stop = Math.min(interval.stop, ground && ground.start >= 0 ? ground.start : Infinity)
  if (stop <= start) return null
  const steps = Math.min(
    8192,
    Math.max(2, Math.ceil((stop - start) / Math.min(m.altitude.step * 250, (hi - lo) * 250)))
  )
  const scratch = new C.Cartesian3()
  let best: IonosphereSample | null = null,
    preferred: IonosphereSample | null = null
  let bestAlpha = 0,
    preferredAlpha = 0
  for (let i = 0; i <= steps; i++) {
    const p = C.Cartographic.fromCartesian(
      C.Ray.getPoint(ray, start + ((stop - start) * i) / steps, scratch)
    )
    const altitude = p.height / 1000
    if (altitude < lo || altitude > hi) continue
    const longitude = wrapLongitude(C.Math.toDegrees(p.longitude)),
      latitude = C.Math.toDegrees(p.latitude)
    if (!containsRegion(settings.region, longitude, latitude)) continue
    const value = sampleVolume(volume, longitude, latitude, altitude, settings.interpolation)
    const alpha = transfer(value, settings)[3]
    if (alpha <= 0) continue
    const x = Math.min(
      m.longitude.count - 1,
      Math.floor((longitude - m.longitude.min) / m.longitude.step)
    )
    const y = Math.min(
      m.latitude.count - 1,
      Math.floor((latitude - m.latitude.min) / m.latitude.step)
    )
    const z = Math.min(
      m.altitude.count - 1,
      Math.floor((altitude - m.altitude.min) / m.altitude.step)
    )
    const voxelIndex = z * m.latitude.count * m.longitude.count + y * m.longitude.count + x
    if (alpha > bestAlpha || (voxelIndex === preferredIndex && alpha > preferredAlpha)) {
      const sample: IonosphereSample = {
        longitude,
        latitude,
        altitude,
        value,
        voxelIndex,
        method: settings.interpolation,
        source: 'voxel-ray',
      }
      if (alpha > bestAlpha) {
        best = sample
        bestAlpha = alpha
      }
      if (voxelIndex === preferredIndex && alpha > preferredAlpha) {
        preferred = sample
        preferredAlpha = alpha
      }
    }
  }
  return preferred || best
}
/** Intersect camera ray with constant *geodetic* height. An expanded ellipsoid
 * supplies a starting root; Newton refinement removes its height approximation.
 */
export function pickHeight(
  C: typeof Cesium,
  viewer: Cesium.Viewer,
  pixel: Cesium.Cartesian2,
  heightKm: number,
  accept: (point: SamplePosition) => boolean = () => true
): SamplePosition | null {
  const ray = viewer.camera.getPickRay(pixel)
  if (!ray) return null
  const h = heightKm * 1000,
    r = C.Ellipsoid.WGS84.radii
  const interval = C.IntersectionTests.rayEllipsoid(ray, new C.Ellipsoid(r.x + h, r.y + h, r.z + h))
  if (!interval) return null
  const scratch = new C.Cartesian3()
  const at = (t: number) => C.Cartographic.fromCartesian(C.Ray.getPoint(ray, t, scratch))
  const ground = C.IntersectionTests.rayEllipsoid(ray, C.Ellipsoid.WGS84)
  for (const guess of [interval.start, interval.stop]) {
    let t = guess
    for (let i = 0; i < 10; i++) {
      const error = at(t).height - h
      if (Math.abs(error) < 0.1) break
      const derivative = (at(t + 10).height - at(t - 10).height) / 20
      if (Math.abs(derivative) < 1e-7) break
      t -= error / derivative
    }
    const point = at(t)
    if (t < 0 || Math.abs(point.height - h) > 1 || (ground && ground.start > 0 && t > ground.start))
      continue
    const position = {
      longitude: C.Math.toDegrees(point.longitude),
      latitude: C.Math.toDegrees(point.latitude),
      altitude: point.height / 1000,
    }
    if (accept(position)) return position
  }
  return null
}

/** Select the nearest valid visible slice, not an arbitrary highest layer. */
export function pickSlices(
  C: typeof Cesium,
  viewer: Cesium.Viewer,
  pixel: Cesium.Cartesian2,
  volume: IonosphereVolume,
  settings: VolumeSettings
): IonosphereSample | null {
  const ray = viewer.camera.getPickRay(pixel)
  if (!ray || settings.opacity <= 0) return null
  let nearest: IonosphereSample | null = null,
    distance = Infinity
  for (const height of visibleSliceHeights(settings)) {
    const point = pickHeight(C, viewer, pixel, height, (p) => {
      if (!containsRegion(settings.region, p.longitude, p.latitude)) return false
      return (
        transfer(
          sampleVolume(volume, p.longitude, p.latitude, height, settings.interpolation),
          settings
        )[3] > 0
      )
    })
    if (!point) continue
    const world = C.Cartesian3.fromDegrees(point.longitude, point.latitude, height * 1000)
    const d = C.Cartesian3.distanceSquared(ray.origin, world)
    if (d >= distance) continue
    distance = d
    nearest = {
      ...point,
      altitude: height,
      value: sampleVolume(volume, point.longitude, point.latitude, height, settings.interpolation),
      method: settings.interpolation,
      source: 'height-slice',
    }
  }
  return nearest
}
