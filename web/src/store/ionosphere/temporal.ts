import { computed, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { useManagedVolumesStore } from './managedVolumes'
import { fetchDataset } from '../../services/ionosphere/datasetApi'
import { fetchVolume } from '../../services/ionosphere/ionosphereApi'
import type { Dataset } from '../../models/ionosphere/Dataset'
import {
  timeSlots,
  summarize,
  validateConditions,
  type TemporalConditions,
  type TemporalRow,
} from '../../utils/ionosphere/temporal'

export const useTemporalStore = defineStore('ionosphere-temporal', () => {
  const catalog = useManagedVolumesStore(),
    dataset = shallowRef<Dataset | null>(null)
  const conditions = ref<TemporalConditions>({
    longitude: 0,
    latitude: 0,
    altitude: 300,
    heights: [100, 500],
    region: null,
  })
  const start = ref(''),
    end = ref(''),
    rows = shallowRef<TemporalRow[]>([])
  const loading = ref(false),
    running = ref(false),
    completed = ref(0),
    error = ref(''),
    cancelled = ref(false)
  let revision = 0,
    selection = 0,
    initialization = 0,
    abort: AbortController | undefined,
    detailAbort: AbortController | undefined
  const windowSlots = computed(() => {
    if (!dataset.value) return []
    try {
      return timeSlots(dataset.value, Date.parse(start.value + 'Z'), Date.parse(end.value + 'Z'))
    } catch {
      return []
    }
  })
  const available = computed(() => windowSlots.value.filter((t) => t.task).length)
  function cancel() {
    revision++
    abort?.abort()
    if (running.value) {
      cancelled.value = true
      rows.value = rows.value.map((r) =>
        r.status === 'waiting' || r.status === 'loading' ? { ...r, status: 'cancelled' } : r
      )
    }
    running.value = false
  }
  function invalidate() {
    cancel()
    rows.value = []
    completed.value = 0
    error.value = ''
    cancelled.value = false
  }
  watch([conditions, start, end], invalidate, { deep: true, flush: 'sync' })
  async function selectDataset(id: string) {
    const current = ++selection
    detailAbort?.abort()
    invalidate()
    dataset.value = null
    loading.value = false
    catalog.selectDataset(id)
    if (!catalog.datasetId) {
      error.value = '指定文件不可用，请重新选择数据管理中的文件'
      return
    }
    const controller = new AbortController()
    detailAbort = controller
    loading.value = true
    try {
      const d = await fetchDataset(id, controller.signal)
      if (current !== selection || controller.signal.aborted) return
      if (d.id !== id) throw new Error('返回文件与所选文件不一致')
      if (!d.preview?.times.length) throw new Error('文件缺少时间索引，请前往数据管理检查文件')
      const times = [...d.preview.times].sort(
        (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
      )
      const h = d.preview.bounds.altitude
      conditions.value = {
        longitude: 0,
        latitude: 0,
        altitude: Math.max(h[0], Math.min(300, h[1])),
        heights: [...h],
        region: null,
      }
      start.value = new Date(times[0].timestamp).toISOString().slice(0, 19)
      end.value = new Date(times[times.length - 1].timestamp).toISOString().slice(0, 19)
      dataset.value = d
    } catch (cause) {
      if (current === selection && !controller.signal.aborted)
        error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (current === selection) loading.value = false
    }
  }
  async function initialize(id?: string) {
    const current = ++initialization
    ++selection
    detailAbort?.abort()
    invalidate()
    dataset.value = null
    await catalog.refresh()
    if (current !== initialization) return
    if (catalog.error) {
      error.value = catalog.error
      return
    }
    if (!id && !catalog.datasetId) return
    await selectDataset(id ?? catalog.datasetId)
  }
  async function run() {
    invalidate()
    if (!dataset.value) {
      error.value = '请先选择可用数据文件'
      return
    }
    let slots
    const c = JSON.parse(JSON.stringify(conditions.value)) as TemporalConditions
    try {
      validateConditions(c)
      const h = dataset.value.preview!.bounds.altitude
      if (c.heights[0] < h[0] || c.heights[1] > h[1])
        throw new Error(`高度范围须在源文件 ${h[0]}–${h[1]} km 内`)
      slots = timeSlots(dataset.value, Date.parse(start.value + 'Z'), Date.parse(end.value + 'Z'))
      if (!slots.some((t) => t.task))
        throw new Error('当前时间窗没有成功入库时刻，请前往数据管理入库')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      return
    }
    rows.value = slots.map((t) => ({
      ...t,
      point: null,
      mean: null,
      maximum: null,
      count: 0,
      profile: [],
    }))
    const current = revision,
      controller = new AbortController()
    abort = controller
    running.value = true
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      if (!slot.task) continue
      if (current !== revision || controller.signal.aborted) return
      const update = (patch: Partial<TemporalRow>) => {
        rows.value = rows.value.map((r, j) => (j === i ? { ...r, ...patch } : r))
      }
      update({ status: 'loading' })
      // Bound a stalled request without cancelling other usable frames.
      const frameController = new AbortController(),
        stop = () => frameController.abort()
      controller.signal.addEventListener('abort', stop, { once: true })
      const timeout = setTimeout(stop, 60000)
      try {
        const v = await fetchVolume('standard', frameController.signal, 'sami3', slot.task.id)
        if (current !== revision || controller.signal.aborted) return
        if (frameController.signal.aborted) throw new Error('该时刻读取超时，请重试')
        if ((v.metadata.parameter || 'Ne') !== 'Ne')
          throw new Error('时空分析需要电子密度 Ne，返回参数不匹配')
        if (Date.parse(v.metadata.timestamp || '') !== slot.milliseconds)
          throw new Error('入库任务与返回数据时刻不一致')
        update({ ...summarize(v, c), status: 'success' })
      } catch (cause) {
        if (current !== revision || controller.signal.aborted) return
        update({
          status: 'error',
          error: frameController.signal.aborted
            ? '该时刻读取超时，请重试'
            : cause instanceof Error
            ? cause.message
            : String(cause),
        })
      } finally {
        clearTimeout(timeout)
        controller.signal.removeEventListener('abort', stop)
      }
      completed.value++
      // Let map interactions and cancellation run between CPU analysis frames.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (current === revision) running.value = false
  }
  function applyTimeWindow(low: string, high: string): boolean {
    invalidate()
    try {
      if (!dataset.value || !/Z$/.test(low) || !/Z$/.test(high))
        throw new Error('分析链接的 UTC 时间范围无效')
      timeSlots(dataset.value, Date.parse(low), Date.parse(high))
      start.value = new Date(low).toISOString().slice(0, 19)
      end.value = new Date(high).toISOString().slice(0, 19)
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      return false
    }
  }
  function dispose() {
    initialization++
    selection++
    detailAbort?.abort()
    invalidate()
    dataset.value = null
    loading.value = false
    catalog.dispose()
  }
  return {
    catalog,
    dataset,
    conditions,
    start,
    end,
    rows,
    loading,
    running,
    completed,
    error,
    cancelled,
    windowSlots,
    available,
    initialize,
    selectDataset,
    run,
    applyTimeWindow,
    cancel,
    dispose,
  }
})
