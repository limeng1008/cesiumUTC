<template>
  <section class="managed-volume-source" aria-label="已入库数据选择">
    <label
      >数据文件
      <select
        :value="catalog.datasetId"
        aria-label="数据文件"
        :disabled="catalog.loading"
        @change="chooseFile($event.target.value)"
      >
        <option value="" disabled>
          {{ catalog.loading ? '正在读取数据管理…' : '请选择数据文件' }}
        </option>
        <option v-for="file in catalog.items" :key="file.id" :value="file.id">
          {{ file.name || file.originalName }} · {{ file.id.slice(0, 8) }}
        </option>
      </select>
    </label>
    <label
      >研究参数
      <select
        :value="catalog.parameter"
        aria-label="研究参数"
        :disabled="catalog.loading"
        @change="chooseParameter($event.target.value)"
      >
        <option
          v-for="p in catalog.parameterOptions"
          :key="p.parameter"
          :value="p.parameter"
          :disabled="!p.selectable"
          :title="p.reason"
        >
          {{ p.name }} · {{ p.parameter }} · {{ p.unit === 'm^-3' ? 'm⁻³' : p.unit }} —
          {{ p.state }}
        </option>
      </select>
    </label>
    <p class="volume-note">
      参数切换保持当前 UTC 时刻；未入库参数请到数据管理处理。TEC/F2 等派生量使用独立专题分析。
    </p>
    <details
      v-if="catalog.dataset?.preview?.parameters?.some((p) => !p.available)"
      class="volume-note"
    >
      <summary>不支持的变量与原因</summary>
      <p
        v-for="p in catalog.dataset.preview.parameters.filter((p) => !p.available)"
        :key="p.sourceVariable"
      >
        {{ p.sourceVariable }}：{{ p.reason }}
      </p>
    </details>
    <label
      >已入库时刻 · UTC
      <select
        :value="catalog.importId || ''"
        aria-label="已入库时刻"
        :disabled="catalog.loading || !catalog.readyImports.length"
        @change="chooseTime($event.target.value)"
      >
        <option v-if="!catalog.importId" value="" disabled>暂无可用入库时刻</option>
        <option v-for="task in catalog.readyImports" :key="task.id" :value="task.id">
          {{ utc(task.timestamp) }}
        </option>
      </select>
    </label>
    <p v-if="catalog.error" role="alert" class="volume-note">{{ catalog.error }}</p>
    <p v-else-if="!catalog.loading && !catalog.readyImports.length" class="volume-note">
      {{
        catalog.items.length
          ? '所选文件尚无成功入库的时刻，请前往数据管理完成入库。'
          : '暂无数据文件，请先到数据管理上传并入库。'
      }}
    </p>
    <p v-else-if="catalog.importId" class="volume-note">
      {{ catalog.readyImports.length }} 个已入库时刻 · 数据来自数据管理
    </p>
    <div class="region-actions">
      <router-link to="/data-management">数据管理 ↗</router-link
      ><button :disabled="catalog.loading" @click="refresh">刷新列表</button>
    </div>
  </section>
</template>
<script setup>
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useManagedVolumesStore } from '@/store/ionosphere/managedVolumes'
import { useVolumeStore } from '@/store/ionosphere/volume'
const catalog = useManagedVolumesStore(),
  volume = useVolumeStore(),
  route = useRoute(),
  router = useRouter()
let disposed = false,
  operation = 0
const queryId = () =>
  route.query.importId == null
    ? undefined
    : typeof route.query.importId === 'string'
    ? route.query.importId || 'invalid-import-id'
    : 'invalid-import-id'
const utc = (stamp) => new Date(stamp).toISOString().slice(0, 19).replace('T', ' ')
async function publish() {
  if (disposed) return
  volume.selectImport(catalog.importId)
  const query = { ...route.query }
  if (catalog.importId) query.importId = catalog.importId
  else delete query.importId
  await router.replace({ query })
}
function chooseFile(id) {
  operation++
  catalog.selectDataset(id)
  void publish()
  void catalog.loadDetails()
}
function chooseParameter(id) {
  operation++
  catalog.selectParameter(id)
  void publish()
}
function chooseTime(id) {
  operation++
  catalog.selectImport(id)
  void publish()
}
async function refresh(autoSelect = true) {
  const current = ++operation,
    requested = queryId()
  await catalog.refresh(requested)
  if (disposed || current !== operation) return
  // Invalid explicit links stay explicit errors, never silently choose another task.
  if (catalog.error) {
    volume.clearSelection()
    return
  }
  if (!autoSelect && !requested) catalog.importId = undefined
  await publish()
}
watch(
  () => route.query.importId,
  () => {
    if (disposed) return
    if (catalog.loading) {
      void refresh(false)
      return
    }
    const id = queryId()
    if (id) {
      operation++
      if (!catalog.syncImport(id)) volume.clearSelection()
      else {
        volume.selectImport(catalog.importId)
        void catalog.loadDetails()
      }
    } else if (catalog.importId) {
      catalog.importId = undefined
      volume.selectImport(undefined)
    }
  }
)
onMounted(refresh)
onBeforeUnmount(() => {
  disposed = true
  operation++
  catalog.dispose()
})
</script>
