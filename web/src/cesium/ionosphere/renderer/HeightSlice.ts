import type * as Cesium from 'cesium'
import type { IonosphereVolume, VolumeSettings } from '../../../models/ionosphere/IonosphereVolume'
import { createSliceRaster } from './sliceRaster'
/** A genuine 2D diagnostic slice, NOT the volume renderer. Samples the same 3D
 * field at one height, on a geodetic RectangleGeometry using the same CPU/GPU LUT.
 */
export class HeightSlice {
  private primitive?: Cesium.Primitive
  private material?: Cesium.Material
  private key = ''
  private removeWarmup?: () => void
  constructor(private C: typeof Cesium, private viewer: Cesium.Viewer) {}
  update(volume: IonosphereVolume, settings: VolumeSettings): void {
    if (!settings.sliceVisible) {
      if (this.primitive) this.primitive.show = false
      return
    }
    const key = JSON.stringify([
      volume.metadata.id,
      settings.sliceAltitude,
      settings.valueRange,
      settings.colorMap,
      settings.normalization,
      settings.thresholdLow,
      settings.thresholdHigh,
      settings.opacity,
      settings.lowValueOpacity,
      settings.region,
      settings.interpolation,
    ])
    if (key === this.key && this.primitive) {
      this.primitive.show = true
      return
    }
    this.destroy()
    this.key = key
    const raster = createSliceRaster(volume, settings, settings.sliceAltitude)
    if (!raster) return
    const C = this.C,
      canvas = document.createElement('canvas')
    canvas.width = raster.width
    canvas.height = raster.height
    const ctx = canvas.getContext('2d')!
    const pixels = ctx.createImageData(canvas.width, canvas.height)
    pixels.data.set(raster.pixels)
    ctx.putImageData(pixels, 0, 0)
    // Canvas textures are queued in Material.update and uploaded on the next frame.
    // Hide the default white texture, explicitly request those frames in on-demand mode.
    const material = C.Material.fromType('Image', {
      image: canvas,
      transparent: true,
      color: new C.Color(1, 1, 1, 0),
    })
    this.material = material
    this.primitive = this.viewer.scene.primitives.add(
      new C.Primitive({
        geometryInstances: new C.GeometryInstance({
          geometry: new C.RectangleGeometry({
            rectangle: C.Rectangle.fromDegrees(
              raster.region.west,
              raster.region.south,
              raster.region.east,
              raster.region.north
            ),
            height: settings.sliceAltitude * 1000,
            ellipsoid: C.Ellipsoid.WGS84,
            granularity: C.Math.toRadians(0.5),
            vertexFormat: C.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
          }),
        }),
        appearance: new C.MaterialAppearance({
          material,
          materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED,
          faceForward: true,
          translucent: true,
          flat: true,
        }),
        asynchronous: false,
      })
    )
    let frames = 0
    this.removeWarmup = this.viewer.scene.postRender.addEventListener(() => {
      frames++
      if (frames >= 2) {
        material.uniforms.color.alpha = 1
        this.removeWarmup?.()
        this.removeWarmup = undefined
      }
      this.viewer.scene.requestRender()
    })
    this.viewer.scene.requestRender()
  }
  destroy(): void {
    this.removeWarmup?.()
    this.removeWarmup = undefined
    if (this.primitive && !this.viewer.isDestroyed())
      this.viewer.scene.primitives.remove(this.primitive)
    this.primitive = undefined
    // Primitive does not own/destroy appearance materials or their image textures.
    if (this.material && !this.material.isDestroyed()) this.material.destroy()
    this.material = undefined
    this.key = ''
  }
}
