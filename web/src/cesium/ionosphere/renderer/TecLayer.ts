import type * as Cesium from 'cesium'
import type { TecGrid } from '../../../models/ionosphere/Overview'
import { tecRaster } from '../../../utils/ionosphere/overview'
/** A single replaceable geographic image; no entity per grid cell. */
export class TecLayer {
  private layer?: Cesium.ImageryLayer
  private generation = 0
  private visible = true
  private alpha = 0.65
  constructor(private C: typeof Cesium, private viewer: Cesium.Viewer) {}
  setAppearance(visible: boolean, alpha: number) {
    this.visible = visible
    this.alpha = Math.max(0, Math.min(1, alpha))
    if (this.layer) {
      this.layer.show = visible
      this.layer.alpha = this.alpha
    }
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender()
  }
  async update(grid: TecGrid | null) {
    const generation = ++this.generation
    this.remove()
    if (!grid?.range || this.viewer.isDestroyed()) return
    const canvas = document.createElement('canvas')
    canvas.width = grid.longitude.count
    canvas.height = grid.latitude.count
    const context = canvas.getContext('2d')!,
      pixels = context.createImageData(canvas.width, canvas.height)
    pixels.data.set(tecRaster(grid))
    context.putImageData(pixels, 0, 0)
    const provider = await this.C.SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'), {
      rectangle: this.C.Rectangle.fromDegrees(
        grid.longitude.min,
        grid.latitude.min,
        grid.longitude.max,
        grid.latitude.max
      ),
      credit: 'SAMI3 · 当前高度范围柱积分 TEC',
    })
    if (generation !== this.generation || this.viewer.isDestroyed()) return
    this.layer = this.viewer.imageryLayers.addImageryProvider(provider)
    this.setAppearance(this.visible, this.alpha)
  }
  private remove() {
    if (this.layer && !this.viewer.isDestroyed()) this.viewer.imageryLayers.remove(this.layer, true)
    this.layer = undefined
  }
  destroy() {
    this.generation++
    this.remove()
  }
}
