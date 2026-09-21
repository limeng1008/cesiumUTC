import { defineStore } from 'pinia'
import { parameterName, displayUnit } from '../../utils/ionosphere/parameters'
import { ref, shallowRef, reactive, toRaw, watch, computed } from 'vue'
import type {
  IonosphereVolumeMetadata,
  IonosphereVolume,
  IonosphereSample,
  SamplePosition,
  VolumeSettings,
  VolumeSource,
} from '../../models/ionosphere/IonosphereVolume'
import { defaultSettings, sanitizeSettings } from '../../models/ionosphere/IonosphereVolume'
import type {
  IonosphereVolumeRenderer,
  RendererDiagnostics,
  RendererEvents,
} from '../../cesium/ionosphere/renderer/IonosphereVolumeRenderer'
import { IonosphereVolumeController } from '../../cesium/ionosphere/IonosphereVolumeController'
import type { SectionGrid } from '../../models/ionosphere/Section'
import { longitudeSpan, displayRegion } from '../../utils/ionosphere/region'
import { sampleSectionGrid, sectionRasterAlpha } from '../../utils/ionosphere/sections'
import { transfer } from '../../cesium/ionosphere/shader/transferFunction'
import {
  regionalValueRange,
  globalValueRange,
  expandedRange,
  type RangeStatistics,
} from '../../utils/ionosphere/valueRange'
export const useVolumeStore = defineStore('ionosphere-volume', () => {
  const parameter = ref('Ne'),
    metadata = shallowRef<IonosphereVolumeMetadata | null>(null),
    selectedPoint = shallowRef<IonosphereSample | null>(null)
  const parameterLabel = computed(() => parameterName(metadata.value?.parameter)),
    unitLabel = computed(() => displayUnit(metadata.value?.unit))
  const settings = reactive<VolumeSettings>(defaultSettings()),
    loading = ref(false),
    error = ref(''),
    status = ref('等待三维场景'),
    resolution = ref<'standard' | 'fine'>('standard'),
    loadMs = ref(0)
  const source = ref<VolumeSource>('sami3'),
    importId = ref<string | undefined>(),
    sourceLabel = computed(() =>
      metadata.value
        ? metadata.value.source === 'sami3-model'
          ? importId.value
            ? 'SAMI3 · 已入库数据集'
            : 'SAMI3 模型数据'
          : metadata.value.sourceName || 'Deterministic Mock'
        : '等待数据'
    ),
    altitudeBounds = computed(() => defaultSettings(metadata.value).altitudeRange)
  const diagnostics = shallowRef<RendererDiagnostics | null>(null)
  const sectionGrid = shallowRef<SectionGrid | null>(null)
  const rangeStatistics = shallowRef<RangeStatistics | null>(null),
    rangeEmpty = ref(false)
  let currentVolume: IonosphereVolume | null = null,
    rangeKey = '',
    cachedRange: RangeStatistics | null = null
  const drawingSection = ref(false),
    sectionHint = ref('')
  let sectionSelectionRequested = false
  const drawingRegion = ref(false),
    regionHint = ref('')
  let controller: IonosphereVolumeController | undefined,
    selectionBlocked = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    regionSelectionRequested = false
  let spatialContext:
    | {
        sha: string
        parameter: string
        heights: [number, number]
        section: VolumeSettings['section']
      }
    | undefined
  function fail(message: string) {
    error.value = message
    loading.value = false
    status.value = '加载或渲染异常'
  }
  function apply() {
    try {
      const safe = sanitizeSettings(structuredClone(toRaw(settings)), metadata.value)
      rangeEmpty.value = false
      if (currentVolume && safe.rangeMode !== 'manual') {
        if (safe.rangeMode === 'global') {
          const key = JSON.stringify([currentVolume.metadata.id, 'global', safe.normalization])
          if (key !== rangeKey) {
            cachedRange = globalValueRange(currentVolume, safe.normalization)
            rangeKey = key
          }
          rangeStatistics.value = cachedRange
          if (cachedRange?.range) safe.valueRange = expandedRange(cachedRange.range)
          else rangeEmpty.value = true
        } else {
          const key = JSON.stringify([
            currentVolume.metadata.id,
            safe.region,
            safe.altitudeRange,
            safe.normalization,
            safe.interpolation,
          ])
          if (key !== rangeKey) {
            cachedRange = regionalValueRange(currentVolume, safe)
            rangeKey = key
          }
          rangeStatistics.value = cachedRange
          if (cachedRange?.range) safe.valueRange = expandedRange(cachedRange.range)
          else rangeEmpty.value = true
        }
      } else rangeStatistics.value = null
      if (JSON.stringify(safe) !== JSON.stringify(settings)) Object.assign(settings, safe)
      controller?.configure(
        rangeEmpty.value
          ? {
              ...safe,
              volumeVisible: false,
              sliceVisible: false,
              section: { ...safe.section, visible: false },
            }
          : safe
      )
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    }
  }
  watch(
    settings,
    () => {
      selectedPoint.value = null
      clearTimeout(timer)
      timer = setTimeout(apply, 80)
    },
    { deep: true }
  )
  const rendererEvents: RendererEvents = {
    ready: () => {
      if (!metadata.value) return
      loading.value = false
      status.value = '三维体数据已就绪'
    },
    error: fail,
    sample: (point) => {
      selectedPoint.value = point
      status.value = point ? '空间采样完成' : '未命中可见数据，请点击彩色区域'
    },
    diagnostics: (data) => {
      diagnostics.value = data
    },
    section: (grid) => {
      sectionGrid.value = grid
    },
    sectionSelected: (path) => {
      if (!controller || loading.value || !metadata.value || !sectionSelectionRequested) return
      sectionSelectionRequested = false
      drawingSection.value = false
      settings.section.path = path
      setMode('path-section')
      sectionHint.value = '剖切线已生成；数据域之外透明显示'
      status.value = '沿线剖面已生成'
    },
    sectionDrawing: (active) => {
      if (!sectionSelectionRequested || !controller || loading.value) return
      drawingSection.value = active
    },
    sectionHint: (hint) => {
      if (sectionSelectionRequested) sectionHint.value = hint
    },
    regionSelected: (region) => {
      if (!controller || loading.value || !metadata.value || !regionSelectionRequested) return
      regionSelectionRequested = false
      settings.region = region
      selectedPoint.value = null
      drawingRegion.value = false
      regionHint.value = ''
      status.value = '区域已选定'
    },
    regionDrawing: (active) => {
      if (!controller || loading.value || !metadata.value || !regionSelectionRequested) return
      drawingRegion.value = active
      if (!active) regionHint.value = ''
    },
    regionHint: (message) => {
      if (!controller || loading.value || !metadata.value || !regionSelectionRequested) return
      regionHint.value = message
    },
  }
  function attach(renderer: IonosphereVolumeRenderer) {
    controller?.destroy()
    controller = new IonosphereVolumeController(renderer, {
      data: (volume, ms) => {
        currentVolume = volume.values ? volume : null
        rangeKey = ''
        cachedRange = null
        settings.rangeMode = 'global'
        metadata.value = volume.metadata
        const nextParameter = volume.metadata.parameter || 'Ne'
        const preserveSpatial =
          spatialContext && spatialContext.sha === volume.metadata.sourceSha256
        if (nextParameter !== parameter.value) {
          const defaults = defaultSettings(volume.metadata)
          settings.normalization = defaults.normalization
          settings.thresholdLow = defaults.thresholdLow
          settings.thresholdHigh = defaults.thresholdHigh
          selectedPoint.value = null
          sectionGrid.value = null
        }
        parameter.value = nextParameter
        loadMs.value = ms
        settings.valueRange = [volume.metadata.minValue, volume.metadata.maxValue]
        settings.altitudeRange = defaultSettings(volume.metadata).altitudeRange
        if (preserveSpatial && spatialContext) {
          const low = Math.max(settings.altitudeRange[0], spatialContext.heights[0]),
            high = Math.min(settings.altitudeRange[1], spatialContext.heights[1])
          if (high > low) settings.altitudeRange = [low, high]
          settings.section = structuredClone(spatialContext.section)
        }
        spatialContext = undefined
        status.value = '正在上传三维体素至 GPU'
        apply()
      },
      error: fail,
    })
    if (importId.value && !selectionBlocked) {
      beginLoading()
      controller.initialize(resolution.value, 'sami3', importId.value)
    } else clearSelection()
  }
  function beginLoading() {
    if (metadata.value?.sourceSha256)
      spatialContext = {
        sha: metadata.value.sourceSha256,
        parameter: parameter.value,
        heights: [...settings.altitudeRange],
        section: structuredClone(toRaw(settings.section)),
      }
    cancelRegion()
    cancelSection()
    clearTimeout(timer)
    error.value = ''
    loading.value = true
    metadata.value = null
    diagnostics.value = null
    loadMs.value = 0
    selectedPoint.value = null
    sectionGrid.value = null
    currentVolume = null
    rangeKey = ''
    cachedRange = null
    rangeStatistics.value = null
    rangeEmpty.value = false
    settings.section.visible = false
    settings.section.path = null
    status.value = '正在加载三维电离层数据'
  }
  function reload() {
    if (!controller) return
    if (!importId.value || selectionBlocked) {
      clearSelection()
      return
    }
    beginLoading()
    controller.load(resolution.value, 'sami3', importId.value)
  }
  function clearSelection() {
    selectionBlocked = true
    beginLoading()
    controller?.clear()
    loading.value = false
    status.value = '请选择数据管理中的文件和已入库时刻'
  }
  function selectImport(selected?: string) {
    if (importId.value === selected && (loading.value || metadata.value)) return
    importId.value = selected
    selectionBlocked = false
    if (selected) {
      source.value = 'sami3'
    }
    reload()
  }
  function sample(position: SamplePosition) {
    if (loading.value || !metadata.value) return
    selectedPoint.value = controller?.sample(position) || null
    status.value = selectedPoint.value?.value != null ? '坐标采样完成' : '采样点超出范围或为 noData'
  }
  function sampleSection(u: number, v: number) {
    let point: IonosphereSample | null = null
    if (
      !loading.value &&
      metadata.value &&
      settings.section.visible &&
      sectionGrid.value &&
      settings.probeEnabled &&
      !drawingSection.value &&
      !drawingRegion.value
    ) {
      point = sampleSectionGrid(sectionGrid.value, u, v, settings.interpolation)
      if (
        !point ||
        transfer(point.value, settings)[3] <= 0 ||
        sectionRasterAlpha(sectionGrid.value, settings, u, v) <= 0
      )
        point = null
    }
    selectedPoint.value = point
    controller?.markSample(point)
    status.value = point ? '剖面联动采样完成' : '该位置隐藏或无有效数据'
  }
  function setMode(mode: VolumeSettings['displayMode']) {
    cancelSection()
    settings.displayMode = mode
    if (mode === 'longitude-section' || mode === 'latitude-section' || mode === 'path-section') {
      const r =
        metadata.value?.longitude && metadata.value?.latitude
          ? displayRegion(settings.region, metadata.value)
          : settings.region
      settings.section.kind =
        mode === 'longitude-section'
          ? 'longitude'
          : mode === 'latitude-section'
          ? 'latitude'
          : 'path'
      settings.section.visible = true
      if (r) {
        settings.section.longitude = ((r.west + longitudeSpan(r) / 2 + 180) % 360) - 180
        settings.section.latitude = (r.south + r.north) / 2
      }
      settings.volumeVisible = false
      settings.probeEnabled = true
      return
    }
    settings.section.visible = false
    settings.volumeVisible = mode === 'volume'
    settings.sliceVisible = mode !== 'volume'
    if (mode !== 'volume')
      settings.sliceMode = mode === 'multi-height-slice' ? 'multiple' : 'single'
  }
  function drawRegion() {
    if (!controller || loading.value || !metadata.value) return
    cancelSection()
    regionSelectionRequested = true
    drawingRegion.value = true
    regionHint.value = '在地球表面依次点击两个角点；按 Esc 取消'
    controller.beginRegionSelection()
  }
  function cancelRegion() {
    regionSelectionRequested = false
    if (drawingRegion.value) controller?.cancelRegionSelection()
    drawingRegion.value = false
    regionHint.value = ''
  }
  function drawSection() {
    if (!controller || loading.value || !metadata.value) return
    cancelRegion()
    sectionSelectionRequested = true
    drawingSection.value = true
    sectionHint.value = '点击地面起点和终点；Esc 取消'
    controller.beginSectionSelection()
  }
  function cancelSection() {
    sectionSelectionRequested = false
    if (drawingSection.value) controller?.cancelSectionSelection()
    drawingSection.value = false
    sectionHint.value = ''
  }
  function clearSection() {
    cancelSection()
    settings.section.path = null
    settings.section.visible = false
    sectionGrid.value = null
    selectedPoint.value = null
  }
  function clearRegion() {
    cancelRegion()
    settings.region = null
    selectedPoint.value = null
  }
  function focusRegion() {
    if (!controller || loading.value || !metadata.value || (!settings.region && !sectionGrid.value))
      return
    clearTimeout(timer)
    apply()
    controller.focusRegion()
  }
  function useScientificSlices() {
    if (!controller || loading.value || !metadata.value || !settings.region) return
    cancelRegion()
    const [min, max] = altitudeBounds.value
    const heights = [100, 200, 300, 400].filter((h) => h >= min && h <= max)
    if (!heights.length) heights.push((min + max) / 2)
    Object.assign(settings, {
      displayMode: 'multi-height-slice',
      volumeVisible: false,
      sliceVisible: true,
      sliceMode: 'multiple',
      sliceAltitudes: heights,
      altitudeRange:
        heights.length > 1
          ? [heights[0], heights[heights.length - 1]]
          : [Math.max(min, heights[0] - 5), Math.min(max, heights[0] + 5)],
      normalization: 'linear',
      colorMap: 'blue-red',
      opacity: 0.45,
      lowValueOpacity: 0.56,
      thresholdLow: 0,
      thresholdHigh: 1,
      probeEnabled: true,
    })
    status.value = '局部科研切片已应用 · 保留当前数据与色标范围'
    focusRegion()
  }
  function reset() {
    cancelRegion()
    cancelSection()
    Object.assign(settings, defaultSettings(metadata.value))
  }
  function detach() {
    spatialContext = undefined
    cancelRegion()
    cancelSection()
    clearTimeout(timer)
    controller?.destroy()
    controller = undefined
    metadata.value = null
    sectionGrid.value = null
    currentVolume = null
    rangeKey = ''
    cachedRange = null
    rangeStatistics.value = null
    rangeEmpty.value = false
    selectedPoint.value = null
    diagnostics.value = null
    loading.value = false
    status.value = '等待三维场景'
    importId.value = undefined
    source.value = 'sami3'
    Object.assign(settings, defaultSettings())
  }
  return {
    parameter,
    parameterLabel,
    unitLabel,
    source,
    importId,
    sourceLabel,
    altitudeBounds,
    metadata,
    selectedPoint,
    settings,
    loading,
    error,
    status,
    resolution,
    loadMs,
    diagnostics,
    sectionGrid,
    rangeStatistics,
    rangeEmpty,
    drawingSection,
    sectionHint,
    drawSection,
    cancelSection,
    clearSection,
    drawingRegion,
    regionHint,
    rendererEvents,
    attach,
    reload,
    clearSelection,
    selectImport,
    sample,
    sampleSection,
    setMode,
    drawRegion,
    cancelRegion,
    clearRegion,
    focusRegion,
    useScientificSlices,
    reset,
    detach,
    fail,
  }
})
