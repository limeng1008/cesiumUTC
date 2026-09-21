import type { IonosphereVolumeRenderer } from './renderer/IonosphereVolumeRenderer'
import type {
  IonosphereVolume,
  IonosphereSample,
  SamplePosition,
  VolumeSettings,
  VolumeSource,
  VolumeSourceCatalog,
} from '../../models/ionosphere/IonosphereVolume'
import { fetchSources, fetchVolume } from '../../services/ionosphere/ionosphereApi'
import { createShandongVolume } from '../../services/ionosphere/shandongMock'
export interface ControllerEvents {
  data: (volume: IonosphereVolume, loadMs: number) => void
  error: (message: string) => void
  catalog?: (catalog: VolumeSourceCatalog, selected: VolumeSource) => void
}
/** Coordinates API and interchangeable rendering; no experimental Cesium types. */
export class IonosphereVolumeController {
  private request?: AbortController
  private revision = 0
  constructor(private renderer: IonosphereVolumeRenderer, private events: ControllerEvents) {}
  async initialize(
    resolution: 'standard' | 'fine',
    preferredSource?: VolumeSource,
    importId?: string
  ): Promise<void> {
    if (importId) {
      await this.load(resolution, 'sami3', importId)
      return
    }
    if (!preferredSource || preferredSource === 'shandong-mock') {
      this.events.catalog?.(
        {
          defaultSource: 'shandong-mock',
          sources: [
            { id: 'shandong-mock', name: '山东局部 · 确定性模拟', available: true },
            { id: 'mock', name: '全球 Mock · 算法测试', available: true },
            { id: 'sami3', name: 'SAMI3 · 模型快照', available: true },
          ],
        },
        'shandong-mock'
      )
      await this.load(resolution, 'shandong-mock')
      return
    }
    this.request?.abort()
    const abort = new AbortController(),
      revision = ++this.revision
    this.request = abort
    const timeout = setTimeout(() => abort.abort(new Error('数据源目录请求超时')), 20000)
    try {
      const catalog = await fetchSources(abort.signal)
      if (revision !== this.revision) return
      const source = preferredSource ?? catalog.defaultSource
      this.events.catalog?.(
        {
          ...catalog,
          sources: [
            { id: 'shandong-mock', name: '山东局部 · 确定性模拟', available: true },
            ...catalog.sources,
          ],
        },
        source
      )
      await this.load(resolution, source, importId)
    } catch (error) {
      if (revision === this.revision)
        this.events.error(error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(timeout)
    }
  }
  async load(
    resolution: 'standard' | 'fine',
    source: VolumeSource = 'mock',
    importId?: string
  ): Promise<void> {
    this.request?.abort()
    const abort = new AbortController()
    this.request = abort
    const revision = ++this.revision,
      start = performance.now()
    const timeout = setTimeout(() => abort.abort(new Error('数据请求超时')), 20000)
    try {
      this.renderer.clear()
      const volume =
        source === 'shandong-mock'
          ? createShandongVolume()
          : await fetchVolume(resolution, abort.signal, source, importId)
      if (revision !== this.revision) return
      this.events.data(volume, performance.now() - start)
      this.renderer.load(volume)
    } catch (error) {
      if (revision === this.revision)
        this.events.error(error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(timeout)
    }
  }
  configure(settings: VolumeSettings): void {
    this.renderer.configure(settings)
  }
  clear(): void {
    this.revision++
    this.request?.abort()
    this.renderer.clear()
  }
  beginRegionSelection(): void {
    this.renderer.beginRegionSelection()
  }
  beginSectionSelection(): void {
    this.renderer.beginSectionSelection?.()
  }
  cancelSectionSelection(): void {
    this.renderer.cancelSectionSelection?.()
  }
  markSample(point: IonosphereSample | null): void {
    this.renderer.markSample?.(point)
  }
  cancelRegionSelection(): void {
    this.renderer.cancelRegionSelection()
  }
  focusRegion(): void {
    this.renderer.focusRegion()
  }
  sample(position: SamplePosition) {
    return this.renderer.sample(position)
  }
  destroy(): void {
    this.revision++
    this.request?.abort()
    this.renderer.destroy()
  }
}
