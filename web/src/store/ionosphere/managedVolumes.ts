import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { Dataset } from '../../models/ionosphere/Dataset'
import { fetchDatasets, fetchDataset } from '../../services/ionosphere/datasetApi'
import { scalarParameters, taskParameter } from '../../utils/ionosphere/parameters'

/** Catalog contains import summaries already; never creates an import as a side effect. */
export const useManagedVolumesStore = defineStore('managed-volume-sources', () => {
  const items = shallowRef<Dataset[]>([]),
    datasetId = ref(''),
    importId = ref<string>(),
    parameter = ref('Ne'),
    selectedTime = ref<number>()
  const loading = ref(false),
    error = ref('')
  const dataset = computed(() => items.value.find((d) => d.id === datasetId.value))
  const readyImports = computed(() =>
    (dataset.value?.imports || [])
      .filter((i) => i.status === 'ready' && taskParameter(i) === parameter.value)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  )
  const parameterOptions = computed(() =>
    scalarParameters.map((p) => {
      const entries = dataset.value?.preview?.parameters?.filter((v) => v.parameter === p.parameter)
      const task = dataset.value?.imports.find(
        (i) => taskParameter(i) === p.parameter && i.timeIndex === selectedTime.value
      )
      const state = task
        ? {
            ready: '已入库',
            queued: '排队中',
            processing: '入库中',
            failed: '入库失败',
            cancelled: '已取消',
          }[task.status]
        : entries?.some((v) => v.available)
        ? '当前时刻未入库'
        : entries?.length
        ? '暂不支持'
        : dataset.value?.preview?.parameters
        ? '源文件未包含'
        : '变量目录待解析'
      return {
        ...p,
        state,
        taskId: task?.status === 'ready' ? task.id : undefined,
        selectable:
          !!task ||
          !!entries?.some((v) => v.available) ||
          !!dataset.value?.imports.some(
            (i) => taskParameter(i) === p.parameter && i.status === 'ready'
          ),
        reason:
          entries
            ?.filter((v) => !v.available)
            .map((v) => v.reason)
            .filter(Boolean)
            .join('；') || '',
      }
    })
  )
  let detailRevision = 0,
    detailAbort: AbortController | undefined
  async function loadDetails() {
    const id = datasetId.value,
      current = ++detailRevision
    detailAbort?.abort()
    if (!id || dataset.value?.preview) return
    detailAbort = new AbortController()
    const signal = detailAbort.signal
    try {
      const detail = await fetchDataset(id, signal)
      if (!signal.aborted && current === detailRevision && id === datasetId.value)
        items.value = items.value.map((d) => (d.id === id ? detail : d))
    } catch (cause) {
      if (!signal.aborted && current === detailRevision)
        error.value = `变量目录读取失败：${cause instanceof Error ? cause.message : String(cause)}`
    }
  }
  function selectParameter(id: string) {
    if (!scalarParameters.some((p) => p.parameter === id)) return
    parameter.value = id
    importId.value = readyImports.value.find((i) => i.timeIndex === selectedTime.value)?.id
    error.value = ''
  }
  let revision = 0,
    abort: AbortController | undefined
  function selectDataset(id: string) {
    datasetId.value = items.value.some((d) => d.id === id) ? id : ''
    parameter.value = 'Ne'
    if (!readyImports.value.length)
      parameter.value = taskParameter(dataset.value?.imports.find((i) => i.status === 'ready'))
    importId.value = readyImports.value[readyImports.value.length - 1]?.id
    selectedTime.value = readyImports.value.find((i) => i.id === importId.value)?.timeIndex
    error.value = ''
  }
  function selectImport(id: string) {
    if (readyImports.value.some((i) => i.id === id)) {
      importId.value = id
      selectedTime.value = readyImports.value.find((i) => i.id === id)?.timeIndex
      error.value = ''
    }
  }
  function syncImport(id: string): boolean {
    const owner = items.value.find((d) =>
      d.imports.some((i) => i.id === id && i.status === 'ready')
    )
    if (!owner) {
      datasetId.value = ''
      importId.value = undefined
      error.value = '指定入库时刻不可用或无权限，请重新选择文件和已入库时刻'
      return false
    }
    datasetId.value = owner.id
    const task = owner.imports.find((i) => i.id === id)!
    parameter.value = taskParameter(task)
    selectedTime.value = task.timeIndex
    importId.value = id
    error.value = ''
    return true
  }
  async function refresh(requestedImport?: string) {
    abort?.abort()
    abort = new AbortController()
    const signal = abort.signal,
      current = ++revision,
      previousDataset = datasetId.value
    loading.value = true
    error.value = ''
    try {
      const all: Dataset[] = []
      let page = 1,
        total = 0
      do {
        const result = await fetchDatasets(page++, 100, signal)
        if (signal.aborted || current !== revision) return
        total = result.total
        all.push(...result.items)
        if (!result.items.length) break
      } while (all.length < total)
      items.value = all
      if (requestedImport) syncImport(requestedImport)
      else
        selectDataset(
          all.some((d) => d.id === previousDataset)
            ? previousDataset
            : all.find((d) => d.imports.some((i) => i.status === 'ready'))?.id || all[0]?.id || ''
        )
      await loadDetails()
    } catch (cause) {
      if (current === revision && !signal.aborted) {
        items.value = []
        datasetId.value = ''
        importId.value = undefined
        error.value = cause instanceof Error ? cause.message : String(cause)
      }
    } finally {
      if (current === revision) loading.value = false
    }
  }
  function dispose() {
    revision++
    detailRevision++
    detailAbort?.abort()
    abort?.abort()
    items.value = []
    datasetId.value = ''
    importId.value = undefined
    parameter.value = 'Ne'
    selectedTime.value = undefined
    loading.value = false
    error.value = ''
  }
  return {
    items,
    datasetId,
    dataset,
    importId,
    readyImports,
    parameter,
    parameterOptions,
    selectedTime,
    selectParameter,
    loadDetails,
    loading,
    error,
    selectDataset,
    selectImport,
    syncImport,
    refresh,
    dispose,
  }
})
