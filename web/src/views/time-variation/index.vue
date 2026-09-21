<template>
  <section
    class="analysis-page temporal-page"
    :aria-busy="store.running || store.loading || catalog.loading"
  >
    <header class="analysis-heading">
      <div>
        <h1>电离层时空变化</h1>
        <p>SPATIOTEMPORAL ANALYSIS · 已入库数据 · UTC</p>
      </div>
      <div class="analysis-actions">
        <router-link to="/analysis">单时刻分析 ↗</router-link
        ><router-link to="/data-management">数据管理 ↗</router-link>
      </div>
    </header>
    <div class="analysis-workspace">
      <aside class="analysis-panel analysis-controls" aria-label="时空分析条件">
        <h2>分析条件</h2>
        <label
          >数据文件<select
            :value="catalog.datasetId"
            :disabled="catalog.loading"
            aria-label="时空数据文件"
            @change="chooseFile($event.target.value)"
          >
            <option value="" disabled>请选择数据管理中的文件</option>
            <option v-for="d in catalog.items" :key="d.id" :value="d.id">
              {{ d.name || d.originalName }} · {{ d.id.slice(0, 8) }}
            </option>
          </select></label
        >
        <button :disabled="catalog.loading || store.loading" @click="refresh">刷新入库目录</button>
        <form @submit.prevent="store.run">
          <fieldset :disabled="!store.dataset || store.loading">
            <legend>UTC 时间窗口</legend>
            <label
              >开始时间（UTC）<input v-model="store.start" type="datetime-local" step="1" required
            /></label>
            <label
              >结束时间（UTC）<input v-model="store.end" type="datetime-local" step="1" required
            /></label>
            <p class="analysis-note">
              {{ store.windowSlots.length }} 个源时刻 · {{ store.available }} 个成功入库。单次最多
              256 个源时刻。
            </p>
            <legend>固定位置与高度</legend>
            <div class="analysis-input-grid">
              <label
                >经度 °<input
                  v-model.number="store.conditions.longitude"
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  required /></label
              ><label
                >纬度 °<input
                  v-model.number="store.conditions.latitude"
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  required
              /></label>
            </div>
            <label
              >固定高度 km<input
                v-model.number="store.conditions.altitude"
                type="number"
                min="0"
                step="any"
                required
            /></label>
            <div class="analysis-input-grid">
              <label
                >最低高度 km<input
                  v-model.number="store.conditions.heights[0]"
                  type="number"
                  min="0"
                  step="any"
                  required /></label
              ><label
                >最高高度 km<input
                  v-model.number="store.conditions.heights[1]"
                  type="number"
                  min="0"
                  step="any"
                  required
              /></label>
            </div>
            <p class="analysis-note">
              区域统计与时间—高度图共用高度范围。点采样独立于区域选框，可在地图上点选。
            </p>
            <label
              >区域统计范围<select
                :value="store.conditions.region ? 'regional' : 'all'"
                @change="changeRegion($event.target.value)"
              >
                <option value="all">全数据范围</option>
                <option value="regional">指定经纬度范围</option>
              </select></label
            >
            <div v-if="store.conditions.region" class="analysis-input-grid">
              <label v-for="(name, key) in boundaryLabels" :key="key"
                >{{ name }} °<input
                  v-model.number="store.conditions.region[key]"
                  type="number"
                  step="any"
                  required
              /></label>
            </div>
            <p v-if="store.conditions.region" class="analysis-note">
              西界大于东界表示跨日期变更线。
            </p>
            <div class="analysis-actions">
              <button class="analysis-primary" type="submit" :disabled="store.running">
                {{ store.running ? '正在分析…' : '开始分析' }}</button
              ><button v-if="store.running" type="button" @click="store.cancel">取消</button>
            </div>
          </fieldset>
        </form>
        <p class="analysis-note">
          修改条件将清空旧结果并取消读取，请重新开始分析。不会自动创建入库任务。
        </p>
      </aside>
      <div class="analysis-results">
        <p v-if="catalog.loading || store.loading" class="analysis-status" role="status">
          正在读取文件目录与完整时间索引…
        </p>
        <div v-if="store.error" class="analysis-error" role="alert">{{ store.error }}</div>
        <p
          v-if="!catalog.loading && !store.loading && !store.dataset"
          class="analysis-panel analysis-empty"
        >
          请从数据管理选择已检查的数据文件。没有文件时，请先上传并完成入库。
        </p>
        <div class="analysis-metrics">
          <article class="analysis-panel">
            <span>当前窗口源时刻</span><strong>{{ store.windowSlots.length }}</strong
            ><small>完整时间索引</small>
          </article>
          <article class="analysis-panel">
            <span>成功入库时刻</span><strong>{{ store.available }}</strong
            ><small>仅这些时刻参与读取</small>
          </article>
          <article class="analysis-panel">
            <span>已计算 / 待读取</span><strong>{{ successful }} / {{ store.available }}</strong
            ><small>{{
              store.running
                ? '串行读取中'
                : store.cancelled
                ? '已取消 · 部分结果'
                : store.rows.length
                ? '本轮读取结束'
                : '等待开始分析'
            }}</small>
          </article>
          <article class="analysis-panel">
            <span>未入库 / 读取失败</span><strong>{{ gaps }} / {{ failures }}</strong
            ><small>保持缺口，不补零</small>
          </article>
        </div>
        <p v-if="store.running" class="analysis-status" role="status">
          正在读取 {{ store.completed + 1 }} / {{ store.available }} 个入库时刻…可随时取消。
        </p>
        <p v-else-if="store.cancelled" class="analysis-status" role="status">
          已取消。当前仅显示已完成时刻，其余留空；点击“开始分析”重新计算。
        </p>
        <AnalysisMap
          :region="mapRegion"
          :point="mapPoint"
          :enabled="!!store.dataset"
          @region="(r) => (store.conditions.region = r)"
          @point="pick"
        />
        <p v-if="store.rows.length && successful < 2" class="analysis-status">
          有效读取不足两个时刻，仅展示单点或空结果，不能据此判断变化趋势。
        </p>
        <p v-else-if="store.rows.length && gaps" class="analysis-status">
          当前窗口有
          {{ gaps }}
          个源时刻未成功入库，曲线断开、剖面留白属于正常结果。需要连续趋势时，请先在数据管理入库相邻时刻。
        </p>
        <TemporalCharts
          v-if="store.rows.length"
          :rows="store.rows"
          :heights="store.conditions.heights"
          :altitude="store.conditions.altitude"
          :point-label="pointLabel"
        />
        <p v-if="store.rows.some((r) => r.coverage)" class="analysis-status">
          本轮使用入库标准网格，实际高度覆盖：{{ coverageLabel }}
          km。源文件范围可能更大；超出入库网格的高度留空，不外推。区域统计仅包含高度窗口内实际有效网格中心。
        </p>
        <div v-if="!store.rows.length" class="analysis-panel analysis-empty">
          选择 UTC 时间范围及采样位置，点击“开始分析”生成两组变化曲线和时间—高度图。
        </div>
        <section v-if="store.rows.length" class="analysis-panel">
          <header class="analysis-panel-head">
            <div>
              <h2>逐时刻结果与数据来源</h2>
              <small>Ne / m⁻³ · “—” 表示无有效数据；均值为非面积/体积加权的网格点算术均值。</small>
            </div>
          </header>
          <div class="analysis-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>UTC 时间</th>
                  <th>状态</th>
                  <th>固定点 Ne</th>
                  <th>区域平均 Ne</th>
                  <th>区域最大 Ne</th>
                  <th>有效点数</th>
                  <th>网格高度 km</th>
                  <th>查看</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in store.rows" :key="r.index">
                  <th>{{ utc(r.timestamp) }}</th>
                  <td>
                    {{ statusLabels[r.status] || r.status
                    }}<span v-if="r.error" class="temporal-row-error">{{ r.error }}</span>
                  </td>
                  <td>{{ scientific(r.point) }}</td>
                  <td>{{ scientific(r.mean) }}</td>
                  <td>{{ scientific(r.maximum) }}</td>
                  <td>{{ r.status === 'success' ? r.count : '—' }}</td>
                  <td>{{ r.coverage ? r.coverage.join('–') : '—' }}</td>
                  <td>
                    <router-link
                      v-if="r.task"
                      :to="{ path: '/analysis', query: { importId: r.task.id } }"
                      >单时刻 ↗</router-link
                    ><span v-else>—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTemporalStore } from '@/store/ionosphere/temporal'
import { sanitizeRegion } from '@/utils/ionosphere/region'
import AnalysisMap from '@/components/ionosphere/AnalysisMap.vue'
import TemporalCharts from '@/components/ionosphere/TemporalCharts.vue'
import '../analysis/analysis.scss'
import './temporal.scss'
const store = useTemporalStore(),
  catalog = store.catalog,
  route = useRoute(),
  router = useRouter()
const boundaryLabels = { west: '西界', east: '东界', south: '南界', north: '北界' }
const statusLabels = {
  unimported: '未入库',
  queued: '排队中',
  processing: '入库中',
  failed: '入库失败',
  waiting: '等待读取',
  loading: '读取中',
  success: '已计算',
  error: '读取失败',
  cancelled: '已取消',
}
const mapRegion = computed(() => sanitizeRegion(store.conditions.region))
const mapPoint = computed(() => {
  const { longitude, latitude } = store.conditions
  return Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    Math.abs(longitude) <= 180 &&
    Math.abs(latitude) <= 90
    ? { longitude, latitude }
    : null
})
const pointLabel = computed(() =>
  mapPoint.value
    ? `${mapPoint.value.longitude.toFixed(3)}°, ${mapPoint.value.latitude.toFixed(3)}°`
    : '无效位置'
)
const successful = computed(() => store.rows.filter((r) => r.status === 'success').length)
const failures = computed(() => store.rows.filter((r) => r.status === 'error').length)
const gaps = computed(() => store.windowSlots.length - store.available)
const coverageLabel = computed(() =>
  [...new Set(store.rows.filter((r) => r.coverage).map((r) => r.coverage.join('–')))].join('；')
)
const scientific = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toExponential(4) : '—')
const utc = (v) => new Date(v).toISOString().slice(0, 19).replace('T', ' ')
function pick(p) {
  store.conditions.longitude = p.longitude
  store.conditions.latitude = p.latitude
}
function changeRegion(value) {
  store.conditions.region =
    value === 'all' ? null : { west: -180, east: 180, south: -90, north: 90 }
}
let disposed = false,
  initialized = false,
  operation = 0
const requested = () =>
  route.query.datasetId == null
    ? undefined
    : typeof route.query.datasetId === 'string' && route.query.datasetId
    ? route.query.datasetId
    : 'invalid-dataset-id'
async function chooseFile(id) {
  await router.replace({ query: { datasetId: id } })
}
async function refresh() {
  await store.initialize(requested())
  if (!disposed) applyQueryWindow()
}
function applyQueryWindow() {
  if (route.query.start == null && route.query.end == null) return
  store.applyTimeWindow(
    typeof route.query.start === 'string' ? route.query.start : '',
    typeof route.query.end === 'string' ? route.query.end : ''
  )
}
watch(
  () => [route.query.datasetId, route.query.start, route.query.end],
  async () => {
    const current = ++operation,
      id = requested(),
      first = !initialized
    initialized = true
    if (first || catalog.loading) await store.initialize(id)
    else await store.selectDataset(id || catalog.datasetId)
    if (!disposed && current === operation && store.dataset) applyQueryWindow()
    if (!disposed && current === operation && !id && store.dataset)
      await router.replace({ query: { ...route.query, datasetId: store.dataset.id } })
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  disposed = true
  operation++
  store.dispose()
})
</script>
