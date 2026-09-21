<template>
  <section class="dataset-page">
    <header class="module-heading">
      <div>
        <span class="eyebrow">DATA MANAGEMENT</span>
        <h1>数据管理</h1>
      </div>
      <span class="dataset-chip">SAMI3 · 模型数据</span>
    </header>
    <section class="dataset-upload data-panel" aria-labelledby="upload-title">
      <header>
        <h2 id="upload-title">上传数据</h2>
        <span class="panel-code">01 / UPLOAD</span>
      </header>
      <div class="dataset-upload-body">
        <div class="dataset-upload-copy">
          <strong>导入 SAMI3 NetCDF 文件</strong>
          <p>上传后自动解析网格与时刻。预览确认后，可单时刻或批量入库，再打开三维与时空分析。</p>
          <small
            >单文件最大 1 GiB；支持 .nc、.nc4 及无扩展名文件（如 content）。文件内容须符合 SAMI3
            格式。</small
          >
        </div>
        <div class="dataset-upload-actions">
          <input
            id="dataset-file"
            ref="fileInput"
            type="file"
            :disabled="store.uploading"
            aria-label="选择 SAMI3 NetCDF 文件"
            @change="chooseFile"
          />
          <span v-if="selectedFile" class="dataset-file-size">{{
            formatBytes(selectedFile.size)
          }}</span>
          <button
            class="primary"
            :disabled="!selectedFile || store.uploading || !!fileError"
            @click="sendUpload"
          >
            {{ store.uploading ? '正在上传…' : '上传并解析' }}
          </button>
        </div>
      </div>
      <p v-if="fileError" class="dataset-error" role="alert">{{ fileError }}</p>
      <div v-if="store.uploading" class="dataset-transfer" role="status">
        <progress :value="store.uploadProgress" max="100" aria-label="文件上传进度"></progress>
        <span>{{
          store.uploadProgress === 100
            ? '文件传输完成，等待服务器确认…'
            : `文件上传 ${store.uploadProgress}%`
        }}</span>
      </div>
    </section>
    <div v-if="store.error" class="dataset-error-banner" role="alert">
      <span>{{ store.error }}</span
      ><button :disabled="store.loading" @click="store.refresh()">重新获取数据</button>
    </div>
    <div class="dataset-workspace">
      <section class="data-panel dataset-list" aria-labelledby="datasets-title">
        <header>
          <h2 id="datasets-title">
            数据集 <span class="dataset-count">{{ store.total }}</span>
          </h2>
          <button :disabled="store.loading" @click="store.refresh()">
            {{ store.loading ? '更新中…' : '刷新' }}
          </button>
        </header>
        <p class="dataset-list-note">查看数据集预览与入库任务</p>
        <div v-if="!store.items.length" class="dataset-empty" role="status">
          {{ store.loading ? '正在获取数据集…' : '暂无数据集，上传文件开始分析' }}
        </div>
        <ul v-else class="dataset-rows">
          <li v-for="dataset in store.items" :key="dataset.id">
            <button
              class="dataset-row"
              :class="{ selected: store.selected?.id === dataset.id }"
              :aria-pressed="store.selected?.id === dataset.id"
              @click="store.selectDataset(dataset.id)"
            >
              <span class="dataset-row-head"
                ><strong>{{ dataset.name || dataset.originalName }}</strong
                ><span class="dataset-state" :class="dataset.status">{{
                  datasetStatus(dataset.status)
                }}</span></span
              >
              <span class="dataset-row-meta"
                >{{ formatBytes(dataset.byteSize) }} <span>·</span>
                {{ formatTime(dataset.createdAt) }}</span
              >
              <span class="dataset-row-foot"
                >{{ dataset.imports.filter((task) => task.status === 'ready').length }}
                个参数时刻已入库
                <span
                  v-if="
                    dataset.imports.some((task) => ['queued', 'processing'].includes(task.status))
                  "
                  >· 任务处理中</span
                ></span
              >
            </button>
          </li>
        </ul>
        <footer class="dataset-pagination">
          <button :disabled="store.page <= 1 || store.loading" @click="changePage(-1)">
            上一页</button
          ><span>{{ store.page }} / {{ Math.max(1, Math.ceil(store.total / store.pageSize)) }}</span
          ><button
            :disabled="store.page * store.pageSize >= store.total || store.loading"
            @click="changePage(1)"
          >
            下一页
          </button>
        </footer>
      </section>
      <section class="data-panel dataset-detail" aria-labelledby="detail-title">
        <header>
          <h2 id="detail-title">解析预览与入库</h2>
          <span class="panel-code">02 / PREVIEW & IMPORT</span>
        </header>
        <div v-if="store.detailLoading" class="dataset-empty" role="status">
          正在读取数据集详情…
        </div>
        <div v-else-if="!store.selected" class="dataset-empty">
          <span class="dataset-empty-symbol" aria-hidden="true">▤</span
          ><strong>选择一个数据集</strong>
          <p>查看网格范围、时间信息和入库状态</p>
        </div>
        <div v-else class="dataset-detail-body">
          <div class="dataset-detail-heading">
            <h3>{{ store.selected.name || store.selected.originalName }}</h3>
            <span class="dataset-state" :class="store.selected.status">{{
              datasetStatus(store.selected.status)
            }}</span>
          </div>
          <p class="dataset-id">数据集 ID {{ store.selected.id }}</p>
          <div
            v-if="store.selected.status === 'inspecting'"
            class="dataset-stage-message"
            role="status"
          >
            <span class="dataset-pulse"></span
            >正在解析文件，完成后将显示预览。可离开页面，解析会继续。
          </div>
          <div v-if="store.selected.status === 'failed'" class="dataset-error-banner" role="alert">
            <span>{{ store.selected.error || '解析失败，请确认文件符合 SAMI3 NetCDF 格式' }}</span
            ><button :disabled="store.busy" @click="store.retryInspect">重试解析</button>
          </div>
          <template v-if="store.selected.preview">
            <section class="dataset-import-form" aria-label="物理参数目录">
              <label for="dataset-parameter">选择研究参数</label>
              <div>
                <select
                  id="dataset-parameter"
                  v-model="store.parameter"
                  :disabled="store.busy"
                  aria-label="入库研究参数"
                >
                  <option v-if="!store.selected.preview.parameters" value="Ne">
                    电子密度 Ne · 旧版解析
                  </option>
                  <option
                    v-for="p in store.selected.preview.parameters || []"
                    :key="p.sourceVariable"
                    :value="p.parameter"
                    :disabled="!p.available"
                  >
                    {{ p.parameterName }} · {{ p.parameter }} · {{ p.sourceVariable }} —
                    {{ p.available ? '可入库' : '暂不支持' }}
                  </option>
                </select>
                <button
                  :disabled="store.busy || store.selected.status === 'inspecting'"
                  @click="store.retryInspect"
                >
                  {{ store.busy ? '处理中…' : '刷新变量目录' }}
                </button>
              </div>
              <p v-if="!store.selected.preview.parameters">
                旧版解析信息仅记录 Ne；刷新变量目录不会覆盖已入库数据。
              </p>
              <p v-for="p in store.selected.preview.parameters || []" :key="p.sourceVariable">
                {{ p.parameterName }} · {{ p.sourceVariable }} · {{ p.sourceUnit || '未知单位' }} →
                {{ p.unit }}
                <span v-if="p.dimensions?.length"> · 维度：{{ p.dimensions.join(' × ') }}</span>
                <span v-if="p.shape?.length"> · 形状：{{ p.shape.join(' × ') }}</span>
                <span v-if="!p.available"> · {{ p.reason }}</span>
              </p>
              <p>仅导入文件实际包含且通过校验的参数；未知单位和不支持的布局不会被猜测转换。</p>
            </section>
            <dl class="dataset-facts">
              <div>
                <dt>物理量</dt>
                <dd>{{ selectedParameter?.sourceVariable || store.selected.preview.variable }}</dd>
              </div>
              <div>
                <dt>原始单位 → 入库单位</dt>
                <dd>
                  {{ selectedParameter?.sourceUnit || store.selected.preview.units }} →
                  {{ selectedParameter?.unit || store.selected.preview.outputUnits }}
                </dd>
              </div>
              <div>
                <dt>网格（经度 × 纬度 × 高度）</dt>
                <dd>
                  {{ store.selected.preview.dimensions.longitude }} ×
                  {{ store.selected.preview.dimensions.latitude }} ×
                  {{ store.selected.preview.dimensions.altitude }}
                </dd>
              </div>
              <div>
                <dt>可用时刻</dt>
                <dd>{{ store.selected.preview.timeCount }} 个</dd>
              </div>
              <div>
                <dt>经度范围</dt>
                <dd>{{ range(store.selected.preview.bounds.longitude) }}°</dd>
              </div>
              <div>
                <dt>纬度范围</dt>
                <dd>{{ range(store.selected.preview.bounds.latitude) }}°</dd>
              </div>
              <div>
                <dt>高度范围</dt>
                <dd>{{ range(store.selected.preview.bounds.altitude) }} km</dd>
              </div>
            </dl>
            <div class="dataset-import-form">
              <label for="dataset-time">选择入库时刻（UTC）</label>
              <div>
                <select
                  id="dataset-time"
                  v-model.number="store.timeIndex"
                  :disabled="store.busy || store.selected.status !== 'preview'"
                >
                  <option
                    v-for="time in store.selected.preview.times"
                    :key="time.index"
                    :value="time.index"
                  >
                    {{ formatTime(time.timestamp) }} · #{{ time.index }}
                  </option></select
                ><button
                  class="primary"
                  :disabled="store.busy || store.selected.status !== 'preview' || !canImport"
                  @click="store.createImport()"
                >
                  {{ store.busy ? '提交中…' : '将此时刻入库' }}
                </button>
              </div>
              <p>
                {{ store.parameter }} 每个时刻独立保存；重复提交不会覆盖成功产物，其他参数不受影响。
              </p>
            </div>
            <BatchImportPanel
              :dataset="store.selected"
              :busy="store.busy || !canImport"
              :parameter="store.parameter"
              :message="store.batchMessage"
              @submit="store.createBatch"
              @cancel="store.cancelBatch"
            />
          </template>
          <section class="dataset-tasks" aria-labelledby="tasks-title">
            <h3 id="tasks-title">
              {{ store.parameter }} 入库任务 <span>{{ parameterTasks.length }}</span>
            </h3>
            <p v-if="!parameterTasks.length" class="dataset-muted">该参数尚未创建入库任务</p>
            <article v-for="task in parameterTasks" :key="task.id" class="dataset-task">
              <div class="dataset-task-top">
                <strong>{{ formatTime(task.timestamp) }}</strong
                ><span class="dataset-state" :class="task.status">{{ taskStage(task) }}</span>
              </div>
              <div class="dataset-task-bottom">
                <span>时刻 #{{ task.timeIndex }}</span
                ><button v-if="task.status === 'ready'" class="primary" @click="open3D(task)">
                  打开三维</button
                ><button
                  v-else-if="task.status === 'failed' || task.status === 'cancelled'"
                  :disabled="store.busy"
                  @click="store.createImport(task.timeIndex)"
                >
                  重试入库</button
                ><span v-else class="dataset-muted">后台处理中，状态自动更新</span>
              </div>
              <p v-if="task.error" class="dataset-error" role="alert">{{ task.error }}</p>
            </article>
          </section>
        </div>
      </section>
    </div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDatasetStore } from '@/store/ionosphere/datasets'
import { MAX_DATASET_BYTES } from '@/services/ionosphere/datasetApi'
import BatchImportPanel from '@/components/ionosphere/BatchImportPanel.vue'
import './data-management.scss'
const store = useDatasetStore(),
  router = useRouter()
const selectedParameter = computed(() =>
  store.selected?.preview?.parameters?.find((p) => p.parameter === store.parameter && p.available)
)
const canImport = computed(() =>
  !store.selected?.preview?.parameters ? store.parameter === 'Ne' : !!selectedParameter.value
)
const parameterTasks = computed(() =>
  (store.selected?.imports || []).filter((t) => (t.parameter || 'Ne') === store.parameter)
)
const selectedFile = ref(null),
  fileError = ref(''),
  fileInput = ref(null)
let timer,
  stopped = false
function chooseFile(event) {
  selectedFile.value = event.target.files?.[0] || null
  fileError.value =
    selectedFile.value?.size > MAX_DATASET_BYTES
      ? '文件超过 1 GiB 上传限制'
      : selectedFile.value?.size === 0
      ? '文件为空，请重新选择'
      : ''
}
async function sendUpload() {
  if (!selectedFile.value || fileError.value || store.uploading) return
  await store.upload(selectedFile.value)
  if (!store.error) {
    selectedFile.value = null
    if (fileInput.value) fileInput.value.value = ''
  }
}
async function changePage(offset) {
  store.page += offset
  await store.refresh()
}
function open3D(task) {
  if (task.status === 'ready') router.push({ path: '/ionosphere', query: { importId: task.id } })
}
function datasetStatus(status) {
  return { inspecting: '解析中', preview: '可入库', failed: '解析失败' }[status] || status
}
function taskStage(task) {
  if (task.status === 'processing') return task.progress >= 90 ? '写入产物' : '转换网格'
  return (
    { queued: '等待处理', ready: '已入库', failed: '入库失败', cancelled: '已取消' }[task.status] ||
    task.status
  )
}
function formatBytes(bytes) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : bytes >= 1024 ** 2
    ? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
    : bytes >= 1024
    ? `${(bytes / 1024).toFixed(1)} KiB`
    : `${bytes} B`
}
function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`
}
function range(values) {
  return values.map((value) => Number(value.toFixed(2))).join(' ～ ')
}
async function poll() {
  if (stopped) return
  if (store.hasActiveWork && !store.loading && !store.busy) await store.refresh(false)
  if (!stopped) timer = setTimeout(poll, 3000)
}
onMounted(() => {
  store.activate()
  store.refresh()
  timer = setTimeout(poll, 3000)
})
onBeforeUnmount(() => {
  stopped = true
  clearTimeout(timer)
  store.dispose()
})
</script>
