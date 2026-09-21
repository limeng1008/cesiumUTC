<template>
  <section class="dataset-batch" aria-label="批量时刻入库">
    <header>
      <h3>批量时刻入库 · {{ parameter }}</h3>
      <button type="button" :disabled="busy" @click="selectAll">选择全部时刻</button>
    </header>
    <div class="dataset-batch-fields">
      <label
        >开始时间（UTC）<input v-model="start" type="datetime-local" step="1" :disabled="busy"
      /></label>
      <label
        >结束时间（UTC）<input v-model="end" type="datetime-local" step="1" :disabled="busy"
      /></label>
      <label
        >间隔（每 N 个源时刻选 1 个）<input
          v-model.number="stride"
          type="number"
          min="1"
          step="1"
          :disabled="busy"
      /></label>
    </div>
    <p class="dataset-muted">
      间隔 1 表示连续入库；当前文件若每 10 分钟一帧，间隔 6
      即每小时一帧。只选择源文件已有时刻，单次最多 256 个。
    </p>
    <p v-if="selectionError" class="dataset-error" role="alert">{{ selectionError }}</p>
    <div class="dataset-batch-counts">
      <span
        >选中 <strong>{{ summary.total }}</strong></span
      ><span
        >已入库 <strong>{{ summary.ready }}</strong></span
      ><span
        >排队 <strong>{{ summary.queued }}</strong></span
      ><span
        >处理中 <strong>{{ summary.processing }}</strong></span
      ><span
        >失败 <strong>{{ summary.failed }}</strong></span
      ><span
        >已取消 <strong>{{ summary.cancelled }}</strong></span
      ><span
        >未提交 <strong>{{ summary.unimported }}</strong></span
      >
    </div>
    <progress
      :value="summary.percent"
      max="100"
      :aria-label="`所选时刻处理进度 ${summary.percent}%`"
    />
    <p class="dataset-muted">
      当前选择已结束 {{ summary.settled }} / {{ summary.total }}（含失败与取消）；成功
      {{ summary.ready }}。队列在后台执行，离开页面不会停止。
    </p>
    <div class="dataset-batch-actions">
      <button
        class="primary"
        :disabled="blocked || !(summary.unimported + summary.failed + summary.cancelled)"
        @click="
          $emit(
            'submit',
            selected.map((t) => t.index)
          )
        "
      >
        {{ busy ? '提交中…' : '批量入库' }}
      </button>
      <button :disabled="blocked || !failedIndices.length" @click="$emit('submit', failedIndices)">
        重试所选失败任务
      </button>
      <button :disabled="blocked || !queuedIndices.length" @click="$emit('cancel', queuedIndices)">
        取消所选排队任务
      </button>
      <router-link
        v-if="parameter === 'Ne' && summary.ready && selected.length"
        :to="{
          path: '/time-variation',
          query: {
            datasetId: dataset.id,
            start: selected[0].timestamp,
            end: selected[selected.length - 1].timestamp,
          },
        }"
        >分析此时间范围 ↗</router-link
      >
    </div>
    <p v-if="message" class="dataset-batch-message" role="status">{{ message }}</p>
    <p class="dataset-muted">
      重复提交不覆盖成功产物；取消只影响所选范围中尚未执行的任务，当前转换会安全完成。已取消任务可再次批量入库。
    </p>
  </section>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import { selectBatchTimes, batchSummary } from '@/utils/ionosphere/batchImport'
const props = defineProps({
  dataset: { type: Object, required: true },
  busy: { type: Boolean, default: false },
  message: { type: String, default: '' },
  parameter: { type: String, default: 'Ne' },
})
defineEmits(['submit', 'cancel'])
const start = ref(''),
  end = ref(''),
  stride = ref(1)
function selectAll() {
  const times = [...props.dataset.preview.times].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
  )
  start.value = times[0]?.timestamp.slice(0, 19) || ''
  end.value = times[times.length - 1]?.timestamp.slice(0, 19) || ''
  stride.value = 1
}
watch(() => props.dataset.id, selectAll, { immediate: true })
const selection = computed(() => {
  try {
    const times = selectBatchTimes(
      props.dataset.preview.times,
      start.value,
      end.value,
      stride.value
    )
    return {
      times,
      error: !times.length
        ? '当前范围没有源文件时刻'
        : times.length > 256
        ? '超过单次256时刻限制，请缩小范围或增大间隔'
        : '',
    }
  } catch (cause) {
    return { times: [], error: cause.message }
  }
})
const selected = computed(() => selection.value.times),
  selectionError = computed(() => selection.value.error)
const tasks = computed(() =>
  props.dataset.imports.filter((t) => (t.parameter || 'Ne') === props.parameter)
)
const summary = computed(() => batchSummary(selected.value, tasks.value))
const blocked = computed(
  () => props.busy || !!selectionError.value || props.dataset.status !== 'preview'
)
const indicesFor = (status) => {
  const selectedIds = new Set(selected.value.map((t) => t.index))
  return tasks.value
    .filter((t) => t.status === status && selectedIds.has(t.timeIndex))
    .map((t) => t.timeIndex)
}
const failedIndices = computed(() => indicesFor('failed')),
  queuedIndices = computed(() => indicesFor('queued'))
</script>
<style scoped lang="scss">
.dataset-batch {
  border: 1px solid #28536c;
  border-radius: 6px;
  padding: 16px;
  margin: 18px 0;
  background: #0c2234;
  display: grid;
  gap: 14px;
}
header,
.dataset-batch-actions,
.dataset-batch-counts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
header {
  justify-content: space-between;
}
.dataset-batch-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
label {
  display: grid;
  gap: 7px;
  color: #a9c3d8;
  min-width: 0;
  font-size: 12px;
}
input {
  width: 100%;
  min-width: 0;
  background: #102b40;
  color: #deefff;
  border: 1px solid #30556e;
  border-radius: 4px;
  padding: 9px;
  min-height: 40px;
  color-scheme: dark;
}
.dataset-batch-counts {
  font-size: 12px;
  color: #a9c3d8;
}
strong {
  color: #e3f3ff;
}
progress {
  width: 100%;
  height: 10px;
  accent-color: #67cce8;
}
a {
  color: #77d7ef;
  font-size: 13px;
}
.dataset-batch-message {
  padding: 10px;
  background: #15394f;
  color: #c9edff;
  font-size: 13px;
}
@media (max-width: 600px) {
  .dataset-batch-fields {
    grid-template-columns: 1fr;
  }
  input {
    min-height: 44px;
  }
}
</style>
