import type * as Cesium from 'cesium'
import type { IonosphereVolume, VolumeSettings } from '../../../models/ionosphere/IonosphereVolume'
import { displayRegion, longitudeSpan } from '../../../utils/ionosphere/region'
import { visibleSliceHeights } from '../../../utils/ionosphere/slices'
import { HeightSlice } from './HeightSlice'

/** Owns the lifetime of independent altitude textures and their geographic labels. */
export class HeightSliceCollection {
  private layers = new Map<number, HeightSlice>()
  private labels: Cesium.LabelCollection
  private outlines: Cesium.PolylineCollection
  private labelKey = ''
  constructor(private C: typeof Cesium, private viewer: Cesium.Viewer) {
    this.labels = viewer.scene.primitives.add(new C.LabelCollection())
    this.outlines = viewer.scene.primitives.add(new C.PolylineCollection())
  }
  update(volume: IonosphereVolume, settings: VolumeSettings): void {
    const region = displayRegion(settings.region, volume.metadata)
    const heights = region ? visibleSliceHeights(settings) : []
    for (const [height, layer] of this.layers) {
      if (heights.includes(height)) continue
      layer.destroy()
      this.layers.delete(height)
    }
    for (const height of heights) {
      let layer = this.layers.get(height)
      if (!layer) {
        layer = new HeightSlice(this.C, this.viewer)
        this.layers.set(height, layer)
      }
      layer.update(volume, { ...settings, sliceAltitude: height })
    }
    const labelKey = JSON.stringify([region, heights, settings.sliceLabels, settings.opacity > 0])
    if (labelKey === this.labelKey) return
    this.labelKey = labelKey
    this.labels.removeAll()
    this.outlines.removeAll()
    if (!region || settings.opacity <= 0) return
    const C = this.C
    if (settings.region)
      for (const height of heights) {
        const east = region.west + longitudeSpan(region)
        const corners = [
          [region.west, region.south],
          [east, region.south],
          [east, region.north],
          [region.west, region.north],
        ]
        const coordinates: number[] = []
        for (let side = 0; side < 4; side++)
          for (let i = 0; i < 32; i++) {
            const a = corners[side],
              b = corners[(side + 1) % 4]
            coordinates.push(
              a[0] + ((b[0] - a[0]) * i) / 32,
              a[1] + ((b[1] - a[1]) * i) / 32,
              height * 1000
            )
          }
        coordinates.push(region.west, region.south, height * 1000)
        this.outlines.add({
          positions: C.Cartesian3.fromDegreesArrayHeights(coordinates),
          width: 1,
          material: C.Material.fromType('Color', { color: new C.Color(0.4, 0.72, 1, 0.45) }),
        })
      }
    if (!settings.sliceLabels) return
    // Regional labels sit on the southwest corner, at the true slice height.
    const longitude = settings.region ? region.west : 108
    const latitude = settings.region ? region.south : 25
    for (const height of heights)
      this.labels.add({
        position: C.Cartesian3.fromDegrees(longitude, latitude, height * 1000),
        text: `${height} km`,
        font: '14px sans-serif',
        fillColor: C.Color.WHITE,
        outlineColor: C.Color.BLACK,
        outlineWidth: 3,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: C.HorizontalOrigin.RIGHT,
        pixelOffset: new C.Cartesian2(-10, 0),
        disableDepthTestDistance: 0,
      })
  }
  clear(): void {
    for (const layer of this.layers.values()) layer.destroy()
    this.layers.clear()
    this.labels.removeAll()
    this.outlines.removeAll()
    this.labelKey = ''
  }
  destroy(): void {
    this.clear()
    if (!this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.labels)
      this.viewer.scene.primitives.remove(this.outlines)
    }
  }
}
