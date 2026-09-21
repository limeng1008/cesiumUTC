import type * as Cesium from 'cesium'
import type { GeoPoint } from '../../../models/ionosphere/Section'
import { createSectionPath } from '../renderer/sectionPath'

interface DrawingEvents {
  selected: (path: [GeoPoint, GeoPoint]) => void
  active: (active: boolean) => void
  hint: (message: string) => void
}

/** Transient ground selection; the owner retains the committed section path. */
export class SectionDrawing {
  active = false
  private first?: GeoPoint
  private preview?: Cesium.PolylineCollection
  private line?: Cesium.Polyline
  private handler: Cesium.ScreenSpaceEventHandler
  private previousInputs = true
  private previousCursor = ''
  private destroyed = false
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
      (event: { position: Cesium.Cartesian2 }) => this.click(event.position),
      C.ScreenSpaceEventType.LEFT_CLICK
    )
    this.handler.setInputAction(
      (event: { endPosition: Cesium.Cartesian2 }) => this.move(event.endPosition),
      C.ScreenSpaceEventType.MOUSE_MOVE
    )
    keyboard.addEventListener('keydown', this.keydown)
  }

  start(): void {
    if (this.destroyed || this.viewer.isDestroyed()) return
    this.cancel()
    this.viewer.camera.cancelFlight?.()
    this.previousInputs = this.viewer.scene.screenSpaceCameraController.enableInputs
    this.previousCursor = this.viewer.canvas.style.cursor
    this.viewer.scene.screenSpaceCameraController.enableInputs = false
    this.viewer.canvas.style.cursor = 'crosshair'
    this.active = true
    this.events.active(true)
    this.events.hint('点击地球表面的起点，再点击终点绘制垂直剖面；Esc 取消。')
  }

  private ground(pixel: Cesium.Cartesian2): GeoPoint | null {
    const position = this.viewer.camera.pickEllipsoid(pixel, this.C.Ellipsoid.WGS84)
    if (!position) return null
    const point = this.C.Cartographic.fromCartesian(position)
    return {
      longitude: this.C.Math.toDegrees(point.longitude),
      latitude: this.C.Math.toDegrees(point.latitude),
    }
  }

  private path(end: GeoPoint) {
    return createSectionPath(
      this.C,
      {
        kind: 'path',
        longitude: 118,
        latitude: 37,
        path: [this.first!, end],
        visible: true,
      },
      null
    )
  }

  private click(pixel: Cesium.Cartesian2): void {
    if (!this.active) return
    const point = this.ground(pixel)
    if (!point) {
      this.events.hint('请点击地球表面，天空不能作为剖面端点。')
      return
    }
    if (!this.first) {
      this.first = point
      this.events.hint('移动鼠标预览 WGS84 最短路径，点击终点完成；Esc 取消。')
      return
    }
    if (!this.path(point)) {
      this.events.hint('两点距离需至少 10 米，且不能接近对跖点；请重新选择终点。')
      return
    }
    const selected: [GeoPoint, GeoPoint] = [this.first, point]
    this.cancel()
    this.events.selected(selected)
    this.events.hint('已沿两点间的 WGS84 最短路径生成垂直剖面。')
  }

  private move(pixel: Cesium.Cartesian2): void {
    if (!this.active || !this.first) return
    const point = this.ground(pixel)
    const path = point ? this.path(point) : null
    if (!path) {
      if (this.line) {
        this.line.show = false
        this.viewer.scene.requestRender()
      }
      return
    }
    const C = this.C
    const positions = path.positions.map((p) =>
      C.Cartesian3.fromDegrees(p.longitude, p.latitude, 1000)
    )
    if (!this.preview) {
      this.preview = this.viewer.scene.primitives.add(new C.PolylineCollection())
      this.line = this.preview!.add({
        positions,
        width: 3,
        material: C.Material.fromType('Color', { color: C.Color.CYAN }),
      })
    } else {
      this.line!.positions = positions
      this.line!.show = true
    }
    this.viewer.scene.requestRender()
  }

  cancel(): void {
    if (this.preview) {
      if (!this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(this.preview)
      if (!this.preview.isDestroyed()) this.preview.destroy()
    }
    this.preview = undefined
    this.line = undefined
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
    if (this.destroyed) return
    this.cancel()
    this.keyboard.removeEventListener('keydown', this.keydown)
    this.handler.destroy()
    this.destroyed = true
  }
}
