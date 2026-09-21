import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import type { Dataset } from '../../models/ionosphere/Dataset'
import type { IonosphereVolume } from '../../models/ionosphere/IonosphereVolume'
import { validateMetadata } from '../../models/ionosphere/validation'
import type {
  OverviewAnalysis,
  OverviewFrame,
  OverviewTrend,
  WeatherInfo,
} from '../../models/ionosphere/Overview'
import { analyzeOverview, overviewProfile } from '../../utils/ionosphere/overview'
import { fetchDatasets, fetchDataset } from '../../services/ionosphere/datasetApi'
import { fetchOverviewFrame, fetchSpaceWeather } from '../../services/ionosphere/overviewApi'

export const useOverviewStore = defineStore('ionosphere-overview', () => {
  const datasets = shallowRef<Dataset[]>([]),
    datasetId = ref(''),
    timeIndex = ref(0),
    totalDatasets = ref(0)
  const frame = shallowRef<OverviewFrame | null>(null),
    volume = shallowRef<IonosphereVolume | null>(null),
    analysis = shallowRef<OverviewAnalysis | null>(null)
  const point = shallowRef<{ longitude: number; latitude: number } | null>(null),
    weather = shallowRef<WeatherInfo | null>(null)
  const loading = ref(false),
    catalogLoading = ref(false),
    weatherLoading = ref(false),
    error = ref(''),
    weatherError = ref(''),
    playing = ref(false)
  const trend = shallowRef<OverviewTrend[]>([]),
    showTec = ref(true),
    opacity = ref(0.65)
  const dataset = computed(() => datasets.value.find((d) => d.id === datasetId.value) || null)
  const times = computed(() => dataset.value?.preview?.times ?? [])
  const profile = computed(() =>
    volume.value && point.value
      ? overviewProfile(volume.value, point.value.longitude, point.value.latitude)
      : null
  )
  const currentImport = computed(
    () =>
      dataset.value?.imports.find(
        (i) =>
          i.status === 'ready' &&
          (i.parameter || 'Ne') === 'Ne' &&
          i.timeIndex === frame.value?.timeIndex
      ) || null
  )
  let generation = 0,
    catalogGeneration = 0,
    disposed = false,
    weatherGeneration = 0
  let frameAbort: AbortController | undefined,
    catalogAbort: AbortController | undefined,
    weatherAbort: AbortController | undefined,
    timer: ReturnType<typeof setTimeout> | undefined
  function stop() {
    playing.value = false
    clearTimeout(timer)
  }
  function clearFrame() {
    frame.value = null
    volume.value = null
    analysis.value = null
    weather.value = null
  }
  async function refreshWeather() {
    weatherAbort?.abort()
    const g = ++weatherGeneration,
      stamp = frame.value?.metadata.timestamp
    weather.value = null
    weatherError.value = ''
    weatherLoading.value = !!stamp
    if (!stamp) return
    weatherAbort = new AbortController()
    try {
      const info = await fetchSpaceWeather(stamp, weatherAbort.signal)
      if (!disposed && g === weatherGeneration) weather.value = info
    } catch (e) {
      if (!disposed && g === weatherGeneration)
        weatherError.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (!disposed && g === weatherGeneration) weatherLoading.value = false
    }
  }
  async function load(index: number) {
    if (
      disposed ||
      !dataset.value ||
      !Number.isInteger(index) ||
      !times.value.some((t) => t.index === index)
    )
      return
    frameAbort?.abort()
    weatherAbort?.abort()
    weatherGeneration++
    weather.value = null
    weatherLoading.value = false
    const g = ++generation,
      id = datasetId.value
    frameAbort = new AbortController()
    clearFrame()
    timeIndex.value = index
    loading.value = true
    error.value = ''
    try {
      const result = await fetchOverviewFrame(id, index, frameAbort.signal)
      if (disposed || g !== generation) return
      const m = validateMetadata(result.metadata),
        count = m.longitude.count * m.latitude.count * m.altitude.count
      if (m.parameter !== 'Ne') throw new Error('首页 TEC/F2 分析需要电子密度 Ne，返回参数不匹配')
      if (
        result.datasetId !== id ||
        result.timeIndex !== index ||
        Date.parse(m.timestamp || '') !==
          Date.parse(times.value.find((t) => t.index === index)?.timestamp || '') ||
        !Array.isArray(result.values) ||
        result.values.length !== count ||
        !Number.isSafeInteger(count) ||
        count > 1_000_000 ||
        result.values.some((v) => !Number.isFinite(v) || !Number.isFinite(Math.fround(v)))
      )
        throw new Error('首页网格或时刻校验失败，请重新加载')
      const loaded = { metadata: m, values: new Float32Array(result.values) },
        stats = analyzeOverview(loaded)
      volume.value = loaded
      analysis.value = stats
      frame.value = result
      trend.value = [
        ...trend.value.filter((t) => t.index !== index),
        { index, timestamp: m.timestamp || '', meanTec: stats.meanTec },
      ].sort((a, b) => a.index - b.index)
      void refreshWeather()
    } catch (e) {
      if (!disposed && g === generation) {
        error.value = e instanceof Error ? e.message : String(e)
        clearFrame()
        stop()
      }
    } finally {
      if (!disposed && g === generation) {
        loading.value = false
        if (playing.value) schedule()
      }
    }
  }
  function schedule() {
    clearTimeout(timer)
    const position = times.value.findIndex((t) => t.index === timeIndex.value)
    if (!frame.value || position < 0 || position >= times.value.length - 1) {
      stop()
      return
    }
    timer = setTimeout(() => {
      if (playing.value && !disposed) void load(times.value[position + 1].index)
    }, 1200)
  }
  function togglePlay() {
    if (playing.value) {
      stop()
      return
    }
    if (
      loading.value ||
      !frame.value ||
      timeIndex.value === times.value[times.value.length - 1]?.index
    )
      return
    playing.value = true
    schedule()
  }
  async function selectTime(index: number) {
    stop()
    await load(index)
  }
  async function selectDataset(id: string) {
    stop()
    generation++
    frameAbort?.abort()
    weatherAbort?.abort()
    weatherGeneration++
    datasetId.value = id
    point.value = null
    trend.value = []
    clearFrame()
    error.value = ''
    loading.value = false
    const g = generation
    if (!dataset.value) return
    loading.value = true
    frameAbort = new AbortController()
    try {
      // The catalog intentionally omits large previews. Read only the selected file's detail.
      const detail = await fetchDataset(id, frameAbort.signal)
      if (disposed || g !== generation) return
      if (detail.id !== id || detail.status !== 'preview' || !detail.preview?.times.length)
        throw new Error('所选文件尚无可用时刻，请在数据管理中检查解析状态')
      datasets.value = datasets.value.map((d) => (d.id === id ? detail : d))
      await load(times.value[0].index)
    } catch (e) {
      if (!disposed && g === generation) {
        error.value = e instanceof Error ? e.message : String(e)
        loading.value = false
      }
    }
  }
  async function initialize() {
    disposed = false
    stop()
    generation++
    frameAbort?.abort()
    weatherAbort?.abort()
    weatherGeneration++
    clearFrame()
    point.value = null
    trend.value = []
    loading.value = false
    weatherLoading.value = false
    weatherError.value = ''
    catalogAbort?.abort()
    catalogAbort = new AbortController()
    const g = ++catalogGeneration
    catalogLoading.value = true
    error.value = ''
    try {
      const items: Dataset[] = []
      let page = 1,
        total = 0
      do {
        const data = await fetchDatasets(page, 100, catalogAbort.signal)
        if (disposed || g !== catalogGeneration) return
        total = data.total
        items.push(...data.items)
        if (!data.items.length) break
        page++
      } while (items.length < total)
      totalDatasets.value = total
      datasets.value = items.filter((d) => d.status === 'preview')
      const id = datasets.value.some((d) => d.id === datasetId.value)
        ? datasetId.value
        : datasets.value[0]?.id
      if (id) await selectDataset(id)
      else {
        datasetId.value = ''
        clearFrame()
      }
    } catch (e) {
      if (!disposed && g === catalogGeneration)
        error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (!disposed && g === catalogGeneration) catalogLoading.value = false
    }
  }
  function pick(longitude: number, latitude: number) {
    if (![longitude, latitude].every(Number.isFinite) || latitude < -90 || latitude > 90) return
    point.value = { longitude, latitude }
  }
  function dispose() {
    disposed = true
    generation++
    catalogGeneration++
    weatherGeneration++
    stop()
    frameAbort?.abort()
    catalogAbort?.abort()
    weatherAbort?.abort()
    clearFrame()
    point.value = null
    trend.value = []
    loading.value = false
    weatherLoading.value = false
    catalogLoading.value = false
    datasets.value = []
    datasetId.value = ''
    totalDatasets.value = 0
    timeIndex.value = 0
    error.value = ''
    weatherError.value = ''
  }
  return {
    datasets,
    datasetId,
    dataset,
    totalDatasets,
    times,
    timeIndex,
    frame,
    volume,
    analysis,
    point,
    profile,
    weather,
    trend,
    currentImport,
    loading,
    catalogLoading,
    weatherLoading,
    error,
    weatherError,
    playing,
    showTec,
    opacity,
    initialize,
    selectDataset,
    selectTime,
    togglePlay,
    stop,
    pick,
    dispose,
    refreshWeather,
  }
})
