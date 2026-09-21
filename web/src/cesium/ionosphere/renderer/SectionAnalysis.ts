import type * as Cesium from 'cesium'
import type { IonosphereVolume, VolumeSettings } from '../../../models/ionosphere/IonosphereVolume'
import type { SectionGrid } from '../../../models/ionosphere/Section'
import { displayRegion } from '../../../utils/ionosphere/region'
import { createSectionGrid } from '../../../utils/ionosphere/sections'
import { createSectionPath } from './sectionPath'
import { SectionCurtain } from './SectionCurtain'

/** Owns sampling/cache separately from the volume shader and camera controls. */
export class SectionAnalysis {
  grid: SectionGrid | null = null
  private key = ''
  private curtain: SectionCurtain
  constructor(
    private C: typeof Cesium,
    private viewer: Cesium.Viewer,
    private changed: (grid: SectionGrid | null) => void
  ) {
    this.curtain = new SectionCurtain(C, viewer)
  }
  update(volume: IonosphereVolume, settings: VolumeSettings) {
    if (!settings.section.visible) {
      this.clear()
      return
    }
    const key = JSON.stringify([
      volume.metadata.id,
      settings.section,
      settings.region,
      settings.altitudeRange,
      settings.interpolation,
    ])
    if (key !== this.key) {
      this.key = key
      const region = displayRegion(settings.region, volume.metadata)
      const path = region && createSectionPath(this.C, settings.section, region)
      this.grid = path
        ? createSectionGrid(volume, settings, path.positions, path.distances, settings.section.kind)
        : null
      this.changed(this.grid)
    }
    this.curtain.update(this.grid, settings)
  }
  pick(position: { x: number; y: number }, settings: VolumeSettings) {
    return this.curtain.pick(new this.C.Cartesian2(position.x, position.y), settings)
  }
  focus() {
    if (!this.grid) return
    const C = this.C,
      grid = this.grid
    const points = grid.positions.flatMap((p) =>
      [grid.altitudes[0], grid.altitudes[grid.rows - 1]].map((h) =>
        C.Cartesian3.fromDegrees(p.longitude, p.latitude, h * 1000)
      )
    )
    const sphere = C.BoundingSphere.fromPoints(points)
    this.viewer.camera.flyToBoundingSphere(sphere, {
      offset: new C.HeadingPitchRange(
        C.Math.toRadians(grid.kind === 'longitude' ? 65 : -12),
        C.Math.toRadians(-23),
        Math.max(600000, sphere.radius * 2.7)
      ),
      duration: 0.8,
    })
  }
  clear() {
    this.curtain.destroy()
    this.key = ''
    if (this.grid) {
      this.grid = null
      this.changed(null)
    }
  }
  destroy() {
    this.clear()
  }
}
