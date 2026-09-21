<template>
  <section class="analysis-page" :aria-busy="store.loading || catalog.loading">
    <header class="analysis-heading">
      <div>
        <h1>电离层数据分析</h1>
        <p>IONOSPHERIC DATA ANALYSIS · 已入库网格</p>
      </div>
      <div class="analysis-actions">
        <router-link
          v-if="catalog.datasetId"
          :to="{ path: '/time-variation', query: { datasetId: catalog.datasetId } }"
          >分析时空变化 ↗</router-link
        >
        <router-link
          v-if="store.volume"
          :to="{ path: '/ionosphere', query: { importId: store.importId } }"
          >在三维电离层中查看 ↗</router-link
        >
      </div>
    </header>
    <div class="analysis-workspace">
      <aside :class="['analysis-controls', 'analysis-panel']" aria-label="分析条件">
        <h2>分析条件</h2>
        <label
          >数据文件<select
            :value="catalog.datasetId"
            aria-label="分析数据文件"
            :disabled="catalog.loading"
            @change="chooseFile($event.target.value)"
          >
            <option value="" disabled>请选择已入库文件</option>
            <option v-for="file in catalog.items" :key="file.id" :value="file.id">
              {{ file.name || file.originalName }} · {{ file.id.slice(0, 8) }}
            </option>
          </select></label
        >
        <label
          >已入库时刻 · UTC<select
            :value="store.importId || ''"
            aria-label="分析入库时刻"
            :disabled="catalog.loading || !catalog.readyImports.length"
            @change="chooseTime($event.target.value)"
          >
            <option value="" disabled>请选择成功入库时刻</option>
            <option v-for="task in catalog.readyImports" :key="task.id" :value="task.id">
              {{ utc(task.timestamp) }}
            </option>
          </select></label
        >
        <div class="analysis-actions">
          <router-link to="/data-management">数据管理 ↗</router-link
          ><button :disabled="catalog.loading" @click="refresh">刷新数据</button>
        </div>
        <p class="analysis-note">
          {{ catalog.readyImports.length }} 个可用时刻 · 不使用预览或示例数据
        </p>
        <form @submit.prevent="apply">
          <fieldset :disabled="!store.volume">
            <legend>研究范围</legend>
            <label
              >空间范围<select v-model="regional" aria-label="统计空间范围">
                <option :value="false">全数据范围</option>
                <option :value="true">矩形研究区域</option>
              </select></label
            >
            <div v-if="regional" class="analysis-input-grid">
              <label
                >西界 °<input
                  v-model.number="bounds.west"
                  aria-label="区域西界"
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  required
              /></label>
              <label
                >东界 °<input
                  v-model.number="bounds.east"
                  aria-label="区域东界"
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  required
              /></label>
              <label
                >南界 °<input
                  v-model.number="bounds.south"
                  aria-label="区域南界"
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  required
              /></label>
              <label
                >北界 °<input
                  v-model.number="bounds.north"
                  aria-label="区域北界"
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  required
              /></label>
            </div>
            <p v-if="regional" class="analysis-note">东界小于西界表示跨日期变更线。</p>
            <div class="analysis-input-grid">
              <label
                >最低高度 km<input
                  v-model.number="draftHeights[0]"
                  aria-label="分析最低高度"
                  type="number"
                  :min="limits[0]"
                  :max="limits[1]"
                  step="any"
                  required /></label
              ><label
                >最高高度 km<input
                  v-model.number="draftHeights[1]"
                  aria-label="分析最高高度"
                  type="number"
                  :min="limits[0]"
                  :max="limits[1]"
                  step="any"
                  required
              /></label>
            </div>
            <button type="submit" class="analysis-primary">应用范围并分析</button>
          </fieldset>
        </form>
        <form @submit.prevent="store.applyF2Window(draftF2Window)">
          <fieldset :disabled="!store.volume">
            <legend>F2 搜索窗 · 独立高度范围</legend>
            <div class="analysis-input-grid">
              <label
                >下限 km<input
                  v-model.number="draftF2Window[0]"
                  aria-label="F2 搜索窗下限"
                  type="number"
                  :min="limits[0]"
                  :max="limits[1]"
                  step="any"
                  required
              /></label>
              <label
                >上限 km<input
                  v-model.number="draftF2Window[1]"
                  aria-label="F2 搜索窗上限"
                  type="number"
                  :min="limits[0]"
                  :max="limits[1]"
                  step="any"
                  required
              /></label>
            </div>
            <p class="analysis-note">
              默认 200–600 km。独立于上方积分范围；超出数据覆盖时不自动截短。
            </p>
            <button type="submit">应用 F2 搜索窗</button>
          </fieldset>
        </form>
        <form @submit.prevent="store.pick(lon, lat)">
          <fieldset :disabled="!store.volume">
            <legend>指定位置剖面</legend>
            <div class="analysis-input-grid">
              <label
                >经度 °<input
                  v-model.number="lon"
                  type="number"
                  aria-label="剖面经度"
                  min="-180"
                  max="180"
                  step="any"
                  required /></label
              ><label
                >纬度 °<input
                  v-model.number="lat"
                  type="number"
                  aria-label="剖面纬度"
                  min="-90"
                  max="90"
                  step="any"
                  required
              /></label>
            </div>
            <div class="analysis-actions">
              <button type="submit">采样剖面</button
              ><button type="button" :disabled="!store.point" @click="store.clearPoint">
                清除采样点
              </button>
            </div>
          </fieldset>
        </form>
        <p v-if="store.inputError" role="alert" class="analysis-error">{{ store.inputError }}</p>
        <div class="analysis-provenance">
          <h3>数据与计算口径</h3>
          <p v-if="store.volume">
            {{ store.volume.metadata.longitude.count }} ×
            {{ store.volume.metadata.latitude.count }} ×
            {{ store.volume.metadata.altitude.count }} · 标准入库网格<br />{{
              utc(store.volume.metadata.timestamp)
            }}
            UTC<br />{{ limits.join('–') }} km · Ne / m⁻³
          </p>
          <p>当前结果基于重采样网格，不是原始文件全分辨率。SAMI3 为模型数据，非实测。</p>
          <p>均值为有效网格点的算术均值，非面积或体积加权；缺失值不计为零。</p>
        </div>
      </aside>
      <div class="analysis-results">
        <p v-if="catalog.loading || store.loading" class="analysis-status" role="status">
          正在读取{{ catalog.loading ? '数据管理目录' : '入库网格并计算统计' }}…
        </p>
        <div v-else-if="store.error" class="analysis-error analysis-panel" role="alert">
          <strong>分析数据加载失败</strong>
          <p>{{ store.error }}</p>
          <button @click="refresh">重试</button>
        </div>
        <div v-else-if="!store.volume" class="analysis-panel analysis-empty" role="status">
          暂无可分析的入库数据，请选择文件与成功入库时刻，或前往<router-link to="/data-management"
            >数据管理</router-link
          >上传并入库。
        </div>
        <div class="analysis-metrics" aria-label="区域统计结果">
          <article v-for="metric in metrics" :key="metric.label" class="analysis-panel">
            <span>{{ metric.label }}</span
            ><strong>{{ metric.value }}</strong
            ><small>{{ metric.unit }}</small>
          </article>
        </div>
        <p v-if="store.statistics && !store.statistics.count" class="analysis-status" role="status">
          当前范围没有有效网格中心。请扩大区域或调整高度；系统不会自动扩展选区或填充零值。
        </p>
        <DerivedAnalysis
          :grid="store.derived"
          :point="store.derivedPoint"
          :metadata="store.volume?.metadata"
          :import-id="store.importId"
          :source-file="catalog.dataset?.originalName || catalog.dataset?.name || ''"
          @point="(p) => store.pick(p.longitude, p.latitude)"
        />
        <div class="analysis-visuals">
          <AnalysisMap
            :region="store.region"
            :point="store.point"
            :enabled="!!store.volume"
            @region="setRegion"
            @point="(p) => store.pick(p.longitude, p.latitude)"
          /><AnalysisProfile
            :layers="store.statistics?.layers || []"
            :profile="store.profile"
            :loading="store.loading"
          />
        </div>
        <section class="analysis-panel analysis-summary" aria-label="分析结果说明">
          <p>
            <strong>{{ store.region ? '局部研究区域' : '全数据范围' }}</strong> ·
            {{ store.volume ? store.heights.join('–') + ' km' : '等待数据'
            }}<template v-if="store.statistics">
              · 有效 {{ store.statistics.count.toLocaleString() }} / 范围内
              {{ store.statistics.eligible.toLocaleString() }} 个网格点</template
            >
          </p>
          <p v-if="store.statistics?.peak">
            网格最大值位置：{{ store.statistics.peak.longitude.toFixed(3) }}°,
            {{ store.statistics.peak.latitude.toFixed(3) }}°,
            {{ store.statistics.peak.altitude.toFixed(2) }} km。该高度不是 hmF2；同值取 Z/Y/X
            顺序首个网格点。
          </p>
          <p v-if="store.point">
            采样点：{{ store.point.longitude.toFixed(4) }}°, {{ store.point.latitude.toFixed(4) }}°
            · 三线性插值<template v-if="!store.profile?.values.some((v) => v !== null)">
              · 该柱没有有效采样值</template
            >
          </p>
          <p v-else>点击地球或输入经纬度，叠加指定位置的高度剖面。</p>
        </section>
        <section class="analysis-panel analysis-table-panel">
          <header class="analysis-panel-head">
            <div>
              <h2>逐高度统计明细</h2>
              <small>网格中心高度 · Ne / m⁻³ · “—” 表示无有效数据</small>
            </div>
          </header>
          <div class="analysis-table-scroll">
            <table>
              <caption>
                当前研究区域的高度统计与指定位置采样
              </caption>
              <thead>
                <tr>
                  <th scope="col">高度 km</th>
                  <th scope="col">有效点数</th>
                  <th scope="col">最小 Ne</th>
                  <th scope="col">最大 Ne</th>
                  <th scope="col">平均 Ne</th>
                  <th scope="col">选定位置 Ne</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.altitude">
                  <th scope="row">{{ row.altitude.toFixed(2) }}</th>
                  <td>{{ row.count }} / {{ row.eligible }}</td>
                  <td>{{ scientific(row.minimum) }}</td>
                  <td>{{ scientific(row.maximum) }}</td>
                  <td>{{ scientific(row.mean) }}</td>
                  <td>{{ scientific(row.pointValue) }}</td>
                </tr>
                <tr v-if="!rows.length">
                  <td colspan="6">暂无高度统计数据</td>
                </tr>
              </tbody>
            </table>
          </div>
          <details v-if="store.profile">
            <summary>查看指定位置完整剖面（含高度边界）</summary>
            <div class="analysis-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">高度 km</th>
                    <th scope="col">Ne / m⁻³</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(h, i) in store.profile.altitudes" :key="h">
                    <th scope="row">{{ h.toFixed(2) }}</th>
                    <td>{{ scientific(store.profile.values[i]) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </section>
      </div>
    </div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAnalysisStore } from '@/store/ionosphere/analysis'
import { sampleVolume } from '@/utils/ionosphere/interpolation'
import AnalysisMap from '@/components/ionosphere/AnalysisMap.vue'
import AnalysisProfile from '@/components/ionosphere/AnalysisProfile.vue'
import DerivedAnalysis from '@/components/ionosphere/DerivedAnalysis.vue'
import './analysis.scss'
const store = useAnalysisStore(),
  catalog = store.catalog,
  route = useRoute(),
  router = useRouter()
const regional = ref(false),
  bounds = ref({ west: -180, east: 180, south: -90, north: 90 }),
  draftHeights = ref([0, 1]),
  draftF2Window = ref([200, 600]),
  lon = ref(0),
  lat = ref(0)
const limits = computed(() => {
  const m = store.volume?.metadata
  return m
    ? [
        Math.max(m.altitude.min, m.validDomain?.altitudeMin ?? -Infinity),
        Math.min(m.altitude.max, m.validDomain?.altitudeMax ?? Infinity),
      ]
    : [0, 1]
})
const scientific = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toExponential(4) : '—')
const utc = (v) =>
  Number.isFinite(Date.parse(v)) ? new Date(v).toISOString().slice(0, 19).replace('T', ' ') : '—'
const metrics = computed(() => {
  const s = store.statistics
  return [
    { label: '最小电子密度', value: scientific(s?.minimum), unit: 'Ne · m⁻³' },
    { label: '最大电子密度', value: scientific(s?.maximum), unit: 'Ne · m⁻³' },
    { label: '平均电子密度', value: scientific(s?.mean), unit: '网格点算术均值 · m⁻³' },
    {
      label: '最大值所在高度',
      value: s?.peak ? s.peak.altitude.toFixed(2) : '—',
      unit: 'km · 当前网格最大值',
    },
  ]
})
const rows = computed(() =>
  (store.statistics?.layers || []).map((l) => {
    const value =
      store.volume && store.point && store.profile
        ? sampleVolume(store.volume, store.point.longitude, store.point.latitude, l.altitude)
        : null
    return { ...l, pointValue: value !== null && value >= 0 ? value : null }
  })
)
watch(
  () => [store.region, store.heights],
  () => {
    regional.value = !!store.region
    bounds.value = { ...(store.region || { west: -180, east: 180, south: -90, north: 90 }) }
    draftHeights.value = [...store.heights]
  },
  { immediate: true }
)
watch(
  () => store.f2Window,
  (range) => {
    if (range) draftF2Window.value = [...range]
  },
  { immediate: true }
)
watch(
  () => store.point,
  (p) => {
    if (p) {
      lon.value = p.longitude
      lat.value = p.latitude
    }
  }
)
function apply() {
  store.applyBounds(regional.value ? bounds.value : null, draftHeights.value)
}
function setRegion(r) {
  store.applyBounds(r, [...store.heights])
}
let disposed = false,
  initialized = false,
  operation = 0
const queryId = () =>
  route.query.importId == null
    ? undefined
    : typeof route.query.importId === 'string' && route.query.importId
    ? route.query.importId
    : 'invalid-import-id'
async function publish() {
  if (disposed || route.path !== '/analysis') return
  const query = { ...route.query }
  if (store.importId) query.importId = store.importId
  else delete query.importId
  await router.replace({ query })
}
async function chooseFile(id) {
  const pending = store.selectDataset(id)
  await publish()
  await pending
}
async function chooseTime(id) {
  const pending = store.selectImport(id)
  await publish()
  await pending
}
async function refresh() {
  const current = ++operation
  await store.initialize(queryId())
  if (!disposed && current === operation && !store.error) await publish()
}
watch(
  () => route.query.importId,
  async () => {
    const id = queryId(),
      first = !initialized,
      current = ++operation
    initialized = true
    if (first || catalog.loading) await store.initialize(id, first)
    else if (id !== store.importId || (!id && store.error)) await store.selectImport(id)
    if (!disposed && current === operation && first && !id && !store.error) await publish()
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  disposed = true
  operation++
  store.dispose()
})
</script>
