import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { useManagedVolumesStore } from './managedVolumes'
import { fetchVolume } from '../../services/ionosphere/ionosphereApi'
import type { IonosphereVolume } from '../../models/ionosphere/IonosphereVolume'
import { analyzeGrid, pointProfile } from '../../utils/ionosphere/analysis'
import { deriveGrid, sampleDerivedProfile } from '../../utils/ionosphere/derived'
import { DEFAULT_F2_WINDOW } from '../../models/ionosphere/Derived'
import { sanitizeRegion, type GeographicRegion } from '../../utils/ionosphere/region'

export const useAnalysisStore = defineStore('ionosphere-analysis', () => {
  const catalog = useManagedVolumesStore()
  const volume = shallowRef<IonosphereVolume | null>(null),
    importId = ref<string>()
  const region = ref<GeographicRegion | null>(null),
    heights = ref<[number, number]>([0, 1])
  const point = ref<{ longitude: number; latitude: number } | null>(null)
  const f2Window = ref<[number, number]>([...DEFAULT_F2_WINDOW])
  const loading = ref(false),
    error = ref(''),
    inputError = ref('')
  let revision = 0,
    catalogRevision = 0,
    abort: AbortController | undefined,
    loadedFile = ''
  const statistics = computed(() =>
    volume.value ? analyzeGrid(volume.value, region.value, heights.value) : null
  )
  const profile = computed(() =>
    volume.value && point.value
      ? pointProfile(
          volume.value,
          point.value.longitude,
          point.value.latitude,
          region.value,
          heights.value
        )
      : null
  )
  const derived = computed(() =>
    volume.value ? deriveGrid(volume.value, region.value, heights.value, f2Window.value) : null
  )
  const derivedPoint = computed(() =>
    volume.value && point.value
      ? sampleDerivedProfile(
          volume.value,
          point.value.longitude,
          point.value.latitude,
          heights.value,
          f2Window.value
        )
      : null
  )
  function cancelLoad() {
    revision++
    abort?.abort()
    volume.value = null
    loading.value = false
    error.value = ''
    inputError.value = ''
  }
  async function loadSelected() {
    cancelLoad()
    importId.value = catalog.importId
    if (loadedFile !== catalog.datasetId) {
      region.value = null
      point.value = null
      f2Window.value = [...DEFAULT_F2_WINDOW]
    }
    if (!importId.value) return
    const current = revision,
      id = importId.value
    const task = catalog.readyImports.find((t) => t.id === id)
    if (!task) {
      error.value = '请选择已成功入库的时刻'
      return
    }
    if ((task.parameter || 'Ne') !== 'Ne') {
      error.value = '当前数据分析仅支持电子密度 Ne；该参数请在三维电离层中查看切片与剖面'
      return
    }
    const fileId = catalog.datasetId
    abort = new AbortController()
    const signal = abort.signal
    loading.value = true
    try {
      const data = await fetchVolume('standard', signal, 'sami3', id)
      if (signal.aborted || current !== revision) return
      if (
        !Number.isFinite(Date.parse(task.timestamp)) ||
        Date.parse(data.metadata.timestamp || '') !== Date.parse(task.timestamp)
      )
        throw new Error('入库任务与返回数据的时刻不一致，请重新加载')
      const m = data.metadata
      if ((m.parameter || 'Ne') !== 'Ne') throw new Error('数据分析需要电子密度 Ne，返回参数不匹配')
      const low = Math.max(m.altitude.min, m.validDomain?.altitudeMin ?? -Infinity),
        high = Math.min(m.altitude.max, m.validDomain?.altitudeMax ?? Infinity)
      if (loadedFile !== fileId || heights.value[0] < low || heights.value[1] > high) {
        heights.value = [low, high]
      }
      loadedFile = fileId
      volume.value = data
      if (point.value && !profile.value) point.value = null
    } catch (cause) {
      if (current === revision && !signal.aborted)
        error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (current === revision) loading.value = false
    }
  }
  async function initialize(requested?: string, autoSelect = true) {
    const current = ++catalogRevision
    cancelLoad()
    importId.value = undefined
    await catalog.refresh(requested)
    if (current !== catalogRevision) return
    if (catalog.error) {
      error.value = catalog.error
      return
    }
    if (!requested && !autoSelect) catalog.importId = undefined
    await loadSelected()
  }
  async function selectImport(id?: string) {
    catalogRevision++
    cancelLoad()
    importId.value = undefined
    if (!id) {
      catalog.importId = undefined
      return
    }
    if (!catalog.syncImport(id)) {
      error.value = catalog.error
      return
    }
    await loadSelected()
  }
  async function selectDataset(id: string) {
    catalogRevision++
    catalog.selectDataset(id)
    await loadSelected()
  }
  function applyBounds(next: GeographicRegion | null, range: [number, number]): boolean {
    const m = volume.value?.metadata
    if (!m) return false
    const low = Math.max(m.altitude.min, m.validDomain?.altitudeMin ?? -Infinity),
      high = Math.min(m.altitude.max, m.validDomain?.altitudeMax ?? Infinity)
    if (
      (next && !sanitizeRegion(next)) ||
      !range.every(Number.isFinite) ||
      range[0] >= range[1] ||
      range[0] < low ||
      range[1] > high
    ) {
      inputError.value = `请检查经纬度边界与高度范围（${low}–${high} km，最低须小于最高）`
      return false
    }
    region.value = next ? { ...next } : null
    heights.value = [...range]
    inputError.value = ''
    if (point.value && !profile.value) point.value = null
    return true
  }
  function pick(longitude: number, latitude: number): boolean {
    if (!volume.value) return false
    if (
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      !pointProfile(volume.value, longitude, latitude, region.value, heights.value)
    ) {
      inputError.value = '采样位置不在当前研究区域或数据有效范围内'
      return false
    }
    point.value = { longitude, latitude }
    inputError.value = ''
    return true
  }
  function applyF2Window(range: [number, number]): boolean {
    const m = volume.value?.metadata
    if (!m) return false
    const low = Math.max(m.altitude.min, m.validDomain?.altitudeMin ?? -Infinity),
      high = Math.min(m.altitude.max, m.validDomain?.altitudeMax ?? Infinity)
    if (
      !range.every(Number.isFinite) ||
      range[0] >= range[1] ||
      range[0] < low ||
      range[1] > high
    ) {
      inputError.value = `请检查 F2 搜索窗（${low}–${high} km，下限须小于上限，不自动截短）`
      return false
    }
    f2Window.value = [...range]
    inputError.value = ''
    return true
  }
  function clearPoint() {
    point.value = null
    inputError.value = ''
  }
  function dispose() {
    catalogRevision++
    cancelLoad()
    catalog.dispose()
    importId.value = undefined
    point.value = null
    region.value = null
    f2Window.value = [...DEFAULT_F2_WINDOW]
    loadedFile = ''
  }
  return {
    catalog,
    volume,
    importId,
    region,
    heights,
    f2Window,
    point,
    loading,
    error,
    inputError,
    statistics,
    profile,
    derived,
    derivedPoint,
    initialize,
    selectImport,
    selectDataset,
    applyBounds,
    applyF2Window,
    pick,
    clearPoint,
    dispose,
  }
})
