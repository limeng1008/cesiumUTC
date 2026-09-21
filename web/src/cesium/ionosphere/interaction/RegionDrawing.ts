import type * as Cesium from 'cesium'
import { regionFromCorners, type GeographicRegion } from '../../../utils/ionosphere/region'

interface DrawingEvents {
  selected: (region: GeographicRegion) => void
  active: (active: boolean) => void
  hint: (message: string) => void
}
/** Two ground clicks, never depth-pick the volume being cropped. */
export class RegionDrawing {
  active = false
  private first?: { longitude: number; latitude: number }
  private preview?: Cesium.Entity
  private handler: Cesium.ScreenSpaceEventHandler
  private previousInputs = true
  private previousCursor = ''
  private keydown = (event: Event) => {
    if (this.active && (event as KeyboardEvent).key === 'Escape') this.cancel()
  }
  constructor(
    private C: typeof Cesium,
    private viewer: Cesium.Viewer,
    private events: DrawingEvents,
    private keyboard: EventTarget = document
  ) {
    this.handler = new C.ScreenSpaceEventHandler(viewer.canvas)
    this.handler.setInputAction(
      (e: { position: Cesium.Cartesian2 }) => this.click(e.position),
      C.ScreenSpaceEventType.LEFT_CLICK
    )
    this.handler.setInputAction(
      (e: { endPosition: Cesium.Cartesian2 }) => this.move(e.endPosition),
      C.ScreenSpaceEventType.MOUSE_MOVE
    )
    keyboard.addEventListener('keydown', this.keydown)
  }
  start(): void {
    this.cancel()
    this.viewer.camera.cancelFlight?.()
    this.previousInputs = this.viewer.scene.screenSpaceCameraController.enableInputs
    this.previousCursor = this.viewer.canvas.style.cursor
    this.viewer.scene.screenSpaceCameraController.enableInputs = false
    this.viewer.canvas.style.cursor = 'crosshair'
    this.active = true
    this.events.active(true)
    this.events.hint('点击地图上的第一个角点，再点击对角点；Esc 取消。')
  }
  private ground(pixel: Cesium.Cartesian2) {
    const point = this.viewer.camera.pickEllipsoid(pixel, this.C.Ellipsoid.WGS84)
    if (!point) return null
    const p = this.C.Cartographic.fromCartesian(point)
    return {
      longitude: this.C.Math.toDegrees(p.longitude),
      latitude: this.C.Math.toDegrees(p.latitude),
    }
  }
  private click(pixel: Cesium.Cartesian2): void {
    if (!this.active) return
    const point = this.ground(pixel)
    if (!point) {
      this.events.hint('请点击地球表面，天空不能作为区域角点。')
      return
    }
    if (!this.first) {
      this.first = point
      this.events.hint('移动鼠标预览矩形，点击对角点完成；Esc 取消。')
      return
    }
    const region = regionFromCorners(this.first, point)
    if (!region) {
      this.events.hint('区域过窄：经纬跨度至少 0.01°，请重新选择对角点。')
      return
    }
    this.cancel()
    this.events.selected(region)
    this.events.hint('矩形区域已应用于体、切片与探针；可点击“定位区域”查看。')
  }
  private move(pixel: Cesium.Cartesian2): void {
    if (!this.active || !this.first) return
    const point = this.ground(pixel)
    if (!point) return
    const region = regionFromCorners(this.first, point)
    if (!region) return
    const C = this.C
    if (this.preview) this.viewer.entities.remove(this.preview)
    this.preview = this.viewer.entities.add({
      rectangle: {
        coordinates: C.Rectangle.fromDegrees(region.west, region.south, region.east, region.north),
        height: 1000,
        material: C.Color.CYAN.withAlpha(0.15),
        outline: true,
        outlineColor: C.Color.CYAN,
      },
    })
    this.viewer.scene.requestRender()
  }
  cancel(): void {
    if (this.preview && !this.viewer.isDestroyed()) this.viewer.entities.remove(this.preview)
    this.preview = undefined
    this.first = undefined
    if (!this.active) return
    this.active = false
    if (!this.viewer.isDestroyed()) {
      this.viewer.scene.screenSpaceCameraController.enableInputs = this.previousInputs
      this.viewer.canvas.style.cursor = this.previousCursor
      this.viewer.scene.requestRender()
    }
    this.events.active(false)
    this.events.hint('')
  }
  destroy(): void {
    this.cancel()
    this.keyboard.removeEventListener('keydown', this.keydown)
    this.handler.destroy()
  }
}
