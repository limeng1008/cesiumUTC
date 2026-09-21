import type * as Cesium from 'cesium'
import type {
  IonosphereVolume,
  IonosphereSample,
  SamplePosition,
  VolumeSettings,
  Quality,
} from '../../../models/ionosphere/IonosphereVolume'
import { defaultSettings, sanitizeSettings } from '../../../models/ionosphere/IonosphereVolume'
import { sampleVolume } from '../../../utils/ionosphere/interpolation'
import { createVoxelProvider } from '../provider/IonosphereVoxelProvider'
import { ionosphereVoxelShader } from '../shader/ionosphereVoxelShader'
import { paletteIndex } from '../shader/transferFunction'
import { pickSlices, pickVolumeRay } from '../interaction/IonospherePicking'
import { HeightSliceCollection } from './HeightSliceCollection'
import { RegionDrawing } from '../interaction/RegionDrawing'
import { SectionDrawing } from '../interaction/SectionDrawing'
import { RegionalContext } from './RegionalContext'
import { regionalPresentation } from './regionalPresentation'
import { SectionAnalysis } from './SectionAnalysis'
import { visibleSliceHeights } from '../../../utils/ionosphere/slices'
import { containsRegion, displayRegion, longitudeSpan } from '../../../utils/ionosphere/region'
import type { IonosphereVolumeRenderer, RendererEvents } from './IonosphereVolumeRenderer'
export const qualitySettings: Record<Quality, { stepSize: number; screenSpaceError: number }> = {
  performance: { stepSize: 2, screenSpaceError: 8 },
  standard: { stepSize: 1, screenSpaceError: 4 },
  high: { stepSize: 0.5, screenSpaceError: 1 },
}
/** The only adapter owning experimental Cesium voxel API and its resources. */
export class CesiumVoxelRenderer implements IonosphereVolumeRenderer {
  private primitive?: Cesium.VoxelPrimitive
  private shader?: Cesium.CustomShader
  private volume?: IonosphereVolume
  private settings = defaultSettings()
  private handler: Cesium.ScreenSpaceEventHandler
  private slice: HeightSliceCollection
  private drawing: RegionDrawing
  private sectionDrawing: SectionDrawing
  private regionalContext: RegionalContext
  private sections: SectionAnalysis
  private removers: Array<() => void> = []
  private tileRemovers: Array<() => void> = []
  private marker: Cesium.PointPrimitiveCollection
  private disposed = false
  private timer?: ReturnType<typeof setTimeout>
  private ready = false
  constructor(
    private C: typeof Cesium,
    private viewer: Cesium.Viewer,
    private events: RendererEvents
  ) {
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.globe.showGroundAtmosphere = false
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false
    this.slice = new HeightSliceCollection(C, viewer)
    this.sections = new SectionAnalysis(C, viewer, (grid) => this.events.section?.(grid))
    this.regionalContext = new RegionalContext(C, viewer, (message) => this.events.error(message))
    this.marker = viewer.scene.primitives.add(new C.PointPrimitiveCollection())
    this.handler = new C.ScreenSpaceEventHandler(viewer.canvas)
    this.handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      if (!this.settings.probeEnabled || this.drawing.active || this.sectionDrawing.active) return
      try {
        const point = this.pick(movement.position)
        this.mark(point)
        events.sample(point)
      } catch (error) {
        events.error(`空间拾取失败：${String(error)}`)
      }
    }, C.ScreenSpaceEventType.LEFT_CLICK)
    this.drawing = new RegionDrawing(C, viewer, {
      selected: (region) => this.events.regionSelected?.(region),
      active: (active) => this.events.regionDrawing?.(active),
      hint: (message) => this.events.regionHint?.(message),
    })
    this.sectionDrawing = new SectionDrawing(C, viewer, {
      selected: (path) => this.events.sectionSelected?.(path),
      active: (active) => this.events.sectionDrawing?.(active),
      hint: (hint) => this.events.sectionHint?.(hint),
    })
    this.removers.push(
      viewer.scene.renderError.addEventListener((_scene: unknown, error: Error) =>
        events.error(`Cesium/WebGL 渲染失败：${error.message}`)
      )
    )
    let previous = 0,
      frames = 0,
      sum = 0,
      elapsed = 0,
      start = 0
    this.removers.push(
      viewer.scene.preRender.addEventListener(() => {
        start = performance.now()
      })
    )
    this.removers.push(
      viewer.scene.postRender.addEventListener(() => {
        const now = performance.now(),
          delta = now - previous
        previous = now
        if (delta > 0 && delta < 250) {
          frames++
          elapsed += delta
          sum += now - start
        }
        if (elapsed >= 1000) {
          events.diagnostics({
            ready: this.ready,
            renderer:
              this.volume?.metadata.source === 'shandong-mock'
                ? 'Cesium Regional Slices'
                : 'Cesium ELLIPSOID Voxel',
            ...qualitySettings[this.settings.quality],
            gpuBytesEstimate:
              this.volume?.metadata.source === 'shandong-mock'
                ? visibleSliceHeights(this.settings).length * 360 * 180 * 4
                : this.volume
                ? (this.volume.metadata.longitude.count + 2) *
                  this.volume.metadata.latitude.count *
                  this.volume.metadata.altitude.count *
                  8
                : 0,
            fps: (1000 * frames) / elapsed,
            renderMs: sum / frames,
          })
          frames = 0
          sum = 0
          elapsed = 0
        }
      })
    )
  }
  load(volume: IonosphereVolume): void {
    this.clearVolume()
    this.volume = volume
    this.ready = false
    const C = this.C
    if (volume.metadata.source === 'shandong-mock') {
      this.ready = true
      this.configure(this.settings)
      this.focusRegion()
      this.events.ready()
      return
    }
    if (!C.VoxelPrimitive || !C.VoxelContent || !C.VoxelShapeType.ELLIPSOID)
      throw new Error('当前 Cesium 未提供 Voxel API')
    if (!this.viewer.canvas.getContext('webgl2')) throw new Error('三维体渲染需要 WebGL2')
    const floats = {
      u_valueMin: volume.metadata.minValue,
      u_valueMax: volume.metadata.maxValue,
      u_logScale: 1,
      u_low: this.settings.thresholdLow,
      u_high: 1,
      u_lowValueOpacity: this.settings.lowValueOpacity,
      u_opacity: 0.65,
      u_palette: paletteIndex(this.settings.colorMap),
      u_pathScale: 2 * (C.Ellipsoid.WGS84.maximumRadius + volume.metadata.altitude.max * 1000),
    }
    this.shader = new C.CustomShader({
      uniforms: Object.fromEntries(
        Object.entries(floats).map(([name, value]) => [name, { type: C.UniformType.FLOAT, value }])
      ),
      fragmentShaderText: ionosphereVoxelShader,
    })
    const primitive = new C.VoxelPrimitive({
      provider: createVoxelProvider(C, volume),
      customShader: this.shader,
      calculateStatistics: true,
    })
    this.primitive = primitive
    this.viewer.scene.primitives.add(primitive)
    primitive.depthTest = true
    primitive.nearestSampling = false
    this.tileRemovers.push(
      primitive.initialTilesLoaded.addEventListener(() => {
        if (this.disposed) return
        this.ready = true
        clearTimeout(this.timer)
        this.events.ready()
      })
    )
    this.tileRemovers.push(
      primitive.tileFailed.addEventListener((error: unknown) =>
        this.events.error(`体素上传失败：${String(error)}`)
      )
    )
    this.timer = setTimeout(() => {
      if (!this.ready && !this.disposed)
        this.events.error('体素初始化超时，请检查 WebGL2/GPU 或降低网格分辨率')
    }, 20000)
    this.configure(this.settings)
  }
  configure(settings: VolumeSettings): void {
    this.settings = sanitizeSettings(settings, this.volume?.metadata)
    if (this.volume) this.sections.update(this.volume, this.settings)
    if (this.volume?.metadata.source === 'shandong-mock') {
      this.settings.volumeVisible = false
      this.slice.update(this.volume, this.settings)
      this.regionalContext.update(this.volume, this.settings)
      this.marker.removeAll()
      this.events.diagnostics({
        ready: this.ready,
        renderer: 'Cesium Regional Slices',
        ...qualitySettings[this.settings.quality],
        gpuBytesEstimate: visibleSliceHeights(this.settings).length * 360 * 180 * 4,
        fps: null,
        renderMs: null,
      })
      this.viewer.scene.requestRender()
      return
    }
    if (!this.primitive || !this.shader || !this.volume) return
    const s = this.settings
    this.setAltitudeRange(...s.altitudeRange)
    this.setValueRange(...s.valueRange)
    this.setOpacity(s.opacity)
    this.setQuality(s.quality)
    this.shader.setUniform('u_low', s.thresholdLow)
    this.shader.setUniform('u_lowValueOpacity', s.lowValueOpacity)
    this.shader.setUniform('u_high', Math.max(s.thresholdHigh, s.thresholdLow + 1e-5))
    this.shader.setUniform('u_logScale', s.normalization === 'log' ? 1 : 0)
    this.shader.setUniform('u_palette', paletteIndex(s.colorMap))
    this.primitive.show = s.volumeVisible && !!displayRegion(s.region, this.volume.metadata)
    this.slice.update(this.volume, s)
    this.regionalContext.update(this.volume, s)
    this.marker.removeAll()
    this.events.diagnostics({
      ready: this.ready,
      renderer: 'Cesium ELLIPSOID Voxel',
      ...qualitySettings[s.quality],
      gpuBytesEstimate:
        (this.volume.metadata.longitude.count + 2) *
        this.volume.metadata.latitude.count *
        this.volume.metadata.altitude.count *
        8,
      fps: null,
      renderMs: null,
    })
    this.viewer.scene.requestRender()
  }
  setAltitudeRange(min: number, max: number): void {
    if (!this.primitive) return
    const C = this.C
    const domain = this.volume?.metadata.validDomain
    const region = this.settings?.region
    this.primitive.minClippingBounds = new C.Cartesian3(
      C.Math.toRadians(region?.west ?? -180),
      C.Math.toRadians(Math.max(region?.south ?? -90, domain?.latitudeMin ?? -90)),
      min * 1000
    )
    this.primitive.maxClippingBounds = new C.Cartesian3(
      C.Math.toRadians(region?.east ?? 180),
      C.Math.toRadians(Math.min(region?.north ?? 90, domain?.latitudeMax ?? 90)),
      max * 1000
    )
    this.viewer.scene.requestRender()
  }
  setValueRange(min: number, max: number): void {
    this.shader?.setUniform('u_valueMin', min)
    this.shader?.setUniform('u_valueMax', max)
  }
  setOpacity(opacity: number): void {
    this.shader?.setUniform('u_opacity', opacity)
  }
  setQuality(quality: Quality): void {
    if (this.primitive) Object.assign(this.primitive, qualitySettings[quality])
  }
  sample(position: SamplePosition): IonosphereSample | null {
    if (!this.volume) return null
    return {
      ...position,
      value: !containsRegion(this.settings.region, position.longitude, position.latitude)
        ? null
        : sampleVolume(
            this.volume,
            position.longitude,
            position.latitude,
            position.altitude,
            this.settings.interpolation
          ),
      method: this.settings.interpolation,
      source: 'coordinate',
    }
  }
  pick(position: { x: number; y: number }): IonosphereSample | null {
    if (!this.volume || !this.ready) return null
    const C = this.C,
      pixel = new C.Cartesian2(position.x, position.y),
      s = this.settings,
      m = this.volume.metadata
    let voxelIndex: number | undefined
    const section = this.sections.pick(position, s)
    if (section) return section
    const slice = pickSlices(C, this.viewer, pixel, this.volume, s)
    if (slice) return slice
    if (s.volumeVisible && this.primitive) {
      const cell = this.viewer.scene.pickVoxel(pixel)
      if (cell && cell.primitive === this.primitive) {
        const paddedNx = m.longitude.count + 2
        const z = Math.floor(cell.sampleIndex / (paddedNx * m.latitude.count))
        const y = Math.floor(cell.sampleIndex / paddedNx) % m.latitude.count,
          x = ((cell.sampleIndex % paddedNx) - 1 + m.longitude.count) % m.longitude.count
        voxelIndex = z * m.latitude.count * m.longitude.count + y * m.longitude.count + x
      }
      return pickVolumeRay(C, this.viewer, pixel, this.volume, s, voxelIndex)
    }
    return null
  }
  beginRegionSelection(): void {
    this.sectionDrawing.cancel()
    if (this.volume && this.ready) this.drawing.start()
  }
  beginSectionSelection(): void {
    this.drawing.cancel()
    if (this.volume && this.ready) this.sectionDrawing.start()
  }
  cancelSectionSelection(): void {
    this.sectionDrawing.cancel()
  }
  cancelRegionSelection(): void {
    this.drawing.cancel()
  }
  focusRegion(): void {
    if (!this.volume || this.drawing.active || this.sectionDrawing.active) return
    if (this.settings.section.visible && this.sections.grid) {
      this.sections.focus()
      return
    }
    const presentation = regionalPresentation(this.volume.metadata, this.settings)
    const region = presentation?.region ?? displayRegion(this.settings.region, this.volume.metadata)
    if (!this.settings.region) return
    if (!region) return
    const C = this.C,
      span = longitudeSpan(region),
      points: Cesium.Cartesian3[] = []
    for (const height of presentation?.heights ?? this.settings.altitudeRange) {
      for (let i = 0; i <= 8; i++) {
        const lon = region.west + (span * i) / 8
        for (const lat of [region.south, (region.south + region.north) / 2, region.north])
          points.push(C.Cartesian3.fromDegrees(lon, lat, height * 1000))
      }
    }
    const sphere = C.BoundingSphere.fromPoints(points)
    this.viewer.camera.flyToBoundingSphere(sphere, {
      offset: new C.HeadingPitchRange(
        C.Math.toRadians(-12),
        C.Math.toRadians(-23),
        Math.max(600000, sphere.radius * 2.6)
      ),
      duration: 0.8,
    })
  }
  private mark(point: IonosphereSample | null): void {
    this.marker.removeAll()
    if (point)
      this.marker.add({
        position: this.C.Cartesian3.fromDegrees(
          point.longitude,
          point.latitude,
          point.altitude * 1000
        ),
        pixelSize: 9,
        color: this.C.Color.WHITE,
        outlineColor: this.C.Color.CYAN,
        outlineWidth: 2,
      })
    this.viewer.scene.requestRender()
  }
  markSample(point: IonosphereSample | null): void {
    this.mark(point)
  }
  private clearVolume(): void {
    clearTimeout(this.timer)
    this.tileRemovers.splice(0).forEach((remove) => remove())
    this.drawing.cancel()
    this.sectionDrawing.cancel()
    this.slice.clear()
    this.sections.clear()
    this.regionalContext.clear()
    if (this.primitive && !this.viewer.isDestroyed())
      this.viewer.scene.primitives.remove(this.primitive)
    this.primitive = undefined
    if (this.shader && !this.shader.isDestroyed()) this.shader.destroy()
    this.shader = undefined
    this.marker.removeAll()
    this.volume = undefined
    this.ready = false
  }
  clear(): void {
    this.clearVolume()
    this.viewer.scene.requestRender()
  }
  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearVolume()
    this.removers.splice(0).forEach((remove) => remove())
    this.drawing.destroy()
    this.sectionDrawing.destroy()
    this.slice.destroy()
    this.sections.destroy()
    this.regionalContext.destroy()
    this.handler.destroy()
    if (!this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(this.marker)
  }
}
