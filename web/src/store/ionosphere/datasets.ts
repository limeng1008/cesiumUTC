import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Dataset } from '../../models/ionosphere/Dataset'
import {
  fetchDatasets,
  fetchDataset,
  uploadDataset,
  inspectDataset,
  importDataset,
  importDatasetBatch,
  cancelDatasetImports,
} from '../../services/ionosphere/datasetApi'

export const useDatasetStore = defineStore('ionosphere-datasets', () => {
  const items = ref<Dataset[]>([]),
    selected = ref<Dataset | null>(null)
  const page = ref(1),
    pageSize = 20,
    total = ref(0),
    timeIndex = ref(0)
  const parameter = ref('Ne')
  const error = ref(''),
    loading = ref(false),
    detailLoading = ref(false),
    busy = ref(false)
  const uploading = ref(false),
    uploadProgress = ref(0)
  const batchMessage = ref('')
  let lifetime = new AbortController(),
    listRevision = 0,
    detailRevision = 0,
    selectionRevision = 0,
    mutationRevision = 0
  const active = (dataset: Dataset) =>
    dataset.status === 'inspecting' ||
    dataset.imports.some((task) => task.status === 'queued' || task.status === 'processing')
  const hasActiveWork = computed(
    () => items.value.some(active) || !!(selected.value && active(selected.value))
  )
  function report(cause: unknown, signal: AbortSignal) {
    if (isCurrent(signal)) error.value = cause instanceof Error ? cause.message : String(cause)
  }
  function isCurrent(signal: AbortSignal) {
    return !signal.aborted && signal === lifetime.signal
  }
  function updateDataset(dataset: Dataset) {
    if (selected.value?.id === dataset.id) {
      selected.value = dataset
      const available = dataset.preview?.parameters?.filter((p) => p.available)
      if (available?.length && !available.some((p) => p.parameter === parameter.value))
        parameter.value =
          available.find((p) => p.parameter === 'Ne')?.parameter || available[0].parameter
    }
    items.value = items.value.map((item) => (item.id === dataset.id ? dataset : item))
  }
  async function refresh(clearError = true) {
    const revision = ++listRevision,
      signal = lifetime.signal,
      requestedPage = page.value,
      mutation = mutationRevision
    if (clearError) error.value = ''
    loading.value = true
    try {
      const result = await fetchDatasets(requestedPage, pageSize, signal)
      if (!isCurrent(signal) || revision !== listRevision || mutation !== mutationRevision) return
      items.value = result.items
      total.value = result.total
      if (selected.value) await refreshSelected()
    } catch (cause) {
      if (revision === listRevision && mutation === mutationRevision) report(cause, signal)
    } finally {
      if (isCurrent(signal) && revision === listRevision) loading.value = false
    }
  }
  async function refreshSelected() {
    if (!selected.value) return
    const id = selected.value.id,
      revision = ++detailRevision,
      signal = lifetime.signal,
      mutation = mutationRevision
    try {
      const result = await fetchDataset(id, signal)
      if (
        isCurrent(signal) &&
        revision === detailRevision &&
        mutation === mutationRevision &&
        selected.value?.id === id
      )
        updateDataset(result)
    } catch (cause) {
      if (revision === detailRevision && mutation === mutationRevision) report(cause, signal)
    }
  }
  async function selectDataset(id: string) {
    batchMessage.value = ''
    ++selectionRevision
    const revision = ++detailRevision,
      signal = lifetime.signal
    error.value = ''
    selected.value = null
    detailLoading.value = true
    try {
      // A mutation may complete while this explicit selection is loading. Read again
      // rather than discard the user's selection or show its pre-mutation snapshot.
      while (isCurrent(signal) && revision === detailRevision) {
        const mutation = mutationRevision
        const result = await fetchDataset(id, signal)
        if (!isCurrent(signal) || revision !== detailRevision) return
        if (mutation !== mutationRevision) continue
        selected.value = result
        parameter.value =
          result.preview?.parameters?.find((p) => p.available && p.parameter === 'Ne')?.parameter ||
          result.preview?.parameters?.find((p) => p.available)?.parameter ||
          'Ne'
        timeIndex.value = result.preview?.times[0]?.index ?? 0
        return
      }
    } catch (cause) {
      if (revision === detailRevision) report(cause, signal)
    } finally {
      if (isCurrent(signal) && revision === detailRevision) detailLoading.value = false
    }
  }
  async function upload(file: File) {
    if (uploading.value) return
    const signal = lifetime.signal,
      selection = selectionRevision
    ++mutationRevision
    error.value = ''
    uploading.value = true
    uploadProgress.value = 0
    try {
      const dataset = await uploadDataset(
        file,
        (percent) => {
          if (isCurrent(signal)) uploadProgress.value = percent
        },
        signal
      )
      if (!isCurrent(signal)) return
      ++mutationRevision
      // Selecting another record during transfer takes precedence over auto-selection.
      if (selection === selectionRevision) {
        ++selectionRevision
        ++detailRevision
        detailLoading.value = false
        selected.value = dataset
        parameter.value = 'Ne'
        timeIndex.value = 0
      }
      page.value = 1
      await refresh(false)
    } catch (cause) {
      report(cause, signal)
    } finally {
      if (isCurrent(signal)) uploading.value = false
    }
  }
  async function retryInspect() {
    if (!selected.value || busy.value) return
    const id = selected.value.id,
      signal = lifetime.signal
    ++mutationRevision
    busy.value = true
    error.value = ''
    try {
      const dataset = await inspectDataset(id, signal)
      if (isCurrent(signal)) {
        ++mutationRevision
        updateDataset(dataset)
      }
    } catch (cause) {
      report(cause, signal)
    } finally {
      if (isCurrent(signal)) busy.value = false
    }
  }
  async function createImport(index = timeIndex.value) {
    if (!selected.value || busy.value) return
    const id = selected.value.id,
      signal = lifetime.signal
    ++mutationRevision
    busy.value = true
    error.value = ''
    try {
      const task = await importDataset(id, index, signal, parameter.value)
      if (!isCurrent(signal)) return
      ++mutationRevision
      const dataset =
        selected.value?.id === id ? selected.value : items.value.find((item) => item.id === id)
      if (dataset)
        updateDataset({
          ...dataset,
          imports: [...dataset.imports.filter((item) => item.id !== task.id), task],
        })
    } catch (cause) {
      report(cause, signal)
    } finally {
      if (isCurrent(signal)) busy.value = false
    }
  }
  function activate() {
    if (lifetime.signal.aborted) lifetime = new AbortController()
  }
  async function batchAction(indices: number[], cancel: boolean) {
    if (!selected.value || busy.value) return
    const id = selected.value.id,
      signal = lifetime.signal
    ++mutationRevision
    busy.value = true
    error.value = ''
    batchMessage.value = ''
    try {
      if (!indices.length || indices.length > 256) throw new Error('请选择1–256个时刻')
      const result = await (cancel
        ? cancelDatasetImports(id, indices, signal, parameter.value)
        : importDatasetBatch(id, indices, signal, parameter.value))
      if (!isCurrent(signal)) return
      ++mutationRevision
      const dataset =
        selected.value?.id === id ? selected.value : items.value.find((d) => d.id === id)
      if (dataset) {
        const ids = new Set(result.tasks.map((t) => t.id))
        updateDataset({
          ...dataset,
          imports: [...dataset.imports.filter((t) => !ids.has(t.id)), ...result.tasks],
        })
      }
      if (selected.value?.id === id)
        batchMessage.value =
          'cancelled' in result
            ? `已取消 ${result.cancelled} 个排队任务；正在处理和已成功的任务不受影响。`
            : `已加入队列 ${result.queued} 个时刻，跳过 ${result.skipped} 个已成功或正在处理的时刻。`
    } catch (cause) {
      report(cause, signal)
      // An uncertain POST may already have committed; reconcile using the persistent catalog.
      if (isCurrent(signal)) await refresh(false)
    } finally {
      if (isCurrent(signal)) busy.value = false
    }
  }
  const createBatch = (indices: number[]) => batchAction(indices, false)
  const cancelBatch = (indices: number[]) => batchAction(indices, true)
  function dispose() {
    lifetime.abort()
    ++listRevision
    ++detailRevision
    ++selectionRevision
    ++mutationRevision
    items.value = []
    selected.value = null
    total.value = 0
    page.value = 1
    timeIndex.value = 0
    parameter.value = 'Ne'
    error.value = ''
    loading.value = false
    detailLoading.value = false
    busy.value = false
    uploading.value = false
    uploadProgress.value = 0
    batchMessage.value = ''
  }
  return {
    items,
    selected,
    page,
    pageSize,
    total,
    timeIndex,
    parameter,
    error,
    loading,
    detailLoading,
    busy,
    uploading,
    uploadProgress,
    hasActiveWork,
    refresh,
    selectDataset,
    upload,
    retryInspect,
    createImport,
    createBatch,
    cancelBatch,
    batchMessage,
    activate,
    dispose,
  }
})
