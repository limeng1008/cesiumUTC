<template>
  <div class="temporal-charts">
    <div class="analysis-actions temporal-scale">
      <label
        >Ne 显示尺度<select v-model="scale">
          <option value="log">对数 log₁₀</option>
          <option value="linear">线性（包含零）</option>
        </select></label
      >
      <small>横轴为真实 UTC 时间；缺失不连线。对数模式不显示零值，精确数值见明细表。</small>
    </div>
    <section v-for="(chart, ci) in charts" :key="chart.title" class="analysis-panel temporal-chart">
      <header class="analysis-panel-head">
        <div>
          <h2>{{ chart.title }}</h2>
          <small>{{ chart.subtitle }}</small>
        </div>
      </header>
      <div class="analysis-chart-legend">
        <span v-for="idx in chart.indices" :key="idx" :class="idx === 2 ? 'point-key' : ''"
          >{{ labels[idx] }}{{ idx === 2 ? ' · 虚线' : ' · 实线' }}</span
        >
      </div>
      <svg
        viewBox="0 0 760 290"
        role="img"
        :aria-label="chart.title + '，UTC 时间横轴，Ne 纵轴，缺失留空'"
      >
        <g v-for="tick in plot.series[chart.indices[0]].ticks" :key="tick.y">
          <path :d="`M80 ${tick.y}H700`" class="analysis-gridline" />
          <text x="72" :y="tick.y + 4" text-anchor="end">{{ scientific(tick.value) }}</text>
        </g>
        <g v-for="tick in plot.timeTicks" :key="tick.x">
          <path :d="`M${tick.x} 40V220`" class="analysis-gridline" />
          <text :x="tick.x" y="242" text-anchor="middle">{{ utc(tick.value).slice(11) }}</text>
          <text :x="tick.x" y="260" text-anchor="middle">{{ utc(tick.value).slice(5, 10) }}</text>
        </g>
        <text x="80" y="22">Ne / m⁻³ · {{ scale === 'log' ? '对数轴' : '线性轴' }}</text>
        <text x="700" y="280" text-anchor="end">UTC</text>
        <g
          v-for="idx in chart.indices"
          :key="idx"
          :class="['analysis-series', idx === 2 ? 'point-series' : '']"
        >
          <path :d="plot.series[idx].path" />
          <circle v-for="(p, i) in plot.series[idx].points" :key="i" :cx="p.x" :cy="p.y" r="3.5">
            <title>
              {{ utc(p.timestamp) }} UTC · {{ labels[idx] }} {{ scientific(p.value) }} m⁻³
            </title>
          </circle>
        </g>
        <text
          v-if="!chart.indices.some((i) => plot.series[i].points.length)"
          x="390"
          y="135"
          text-anchor="middle"
        >
          {{ ci === 0 ? '该位置与高度暂无可绘制 Ne' : '当前区域暂无有效统计值' }}
        </text>
      </svg>
    </section>
    <section class="analysis-panel temporal-chart temporal-heat">
      <header class="analysis-panel-head">
        <div>
          <h2>时间—高度剖面</h2>
          <small>固定 {{ pointLabel }} · 64 个物理高度采样节点 · 全时段共享动态色标</small>
        </div>
      </header>
      <svg
        viewBox="0 0 760 285"
        role="img"
        aria-label="固定位置时间—高度电子密度分布，蓝色低值红色高值，未入库与缺失区域留空"
      >
        <rect x="80" y="40" width="620" height="180" fill="#07131f" />
        <g v-for="tick in plot.heightTicks" :key="tick.y">
          <path :d="`M80 ${tick.y}H700`" class="analysis-gridline" />
          <text x="72" :y="tick.y + 4" text-anchor="end">{{ tick.value.toFixed(0) }}</text>
        </g>
        <rect
          v-for="(c, i) in plot.cells"
          :key="i"
          :x="c.x"
          :y="c.y"
          :width="c.width"
          :height="c.height"
          :fill="c.color"
        >
          <title>
            {{ utc(c.timestamp) }} UTC · {{ c.altitude.toFixed(2) }} km ·
            {{ scientific(c.value) }} m⁻³
          </title>
        </rect>
        <g v-for="tick in plot.timeTicks" :key="tick.x">
          <text :x="tick.x" y="242" text-anchor="middle">{{ utc(tick.value).slice(11) }}</text>
          <text :x="tick.x" y="260" text-anchor="middle">{{ utc(tick.value).slice(5, 10) }}</text>
        </g>
        <text x="80" y="22">高度 / km</text>
        <text x="700" y="280" text-anchor="end">UTC</text>
        <text v-if="!plot.cells.length" x="390" y="135" text-anchor="middle">暂无有效剖面数据</text>
      </svg>
      <div v-if="plot.minimum !== null" class="temporal-colorbar">
        <div :style="{ background: gradient }" />
        <p>
          <span>{{ scientific(plot.colorMinimum) }}</span
          ><span>Ne / m⁻³ · {{ scale === 'log' ? 'log₁₀' : '线性' }}</span
          ><span>{{ scientific(plot.colorMaximum) }}</span>
        </p>
      </div>
      <p class="analysis-note">
        每列仅代表对应源时刻，列边界按相邻源时刻中点划分，不表示时间插值。空白表示未入库、读取失败或无有效
        Ne。
      </p>
      <details @toggle="detailsOpen = $event.target.open">
        <summary>查看时间—高度数值（键盘可访问）</summary>
        <div v-if="detailsOpen" class="temporal-profile-details">
          <label
            >剖面数据时刻（UTC）<select v-model="profileIndex">
              <option v-for="r in profileRows" :key="r.index" :value="r.index">
                {{ utc(r.timestamp) }}
              </option>
            </select></label
          >
          <p class="analysis-note">
            包含零值与缺失值，不受显示尺度筛选影响。“—” 表示该高度无有效数据。
          </p>
          <div class="analysis-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>UTC</th>
                  <th>高度 km</th>
                  <th>Ne / m⁻³</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(c, i) in selectedProfile" :key="i">
                  <th>{{ utc(c.timestamp) }}</th>
                  <td>{{ c.altitude.toFixed(2) }}</td>
                  <td>{{ scientific(c.value) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </section>
  </div>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import { temporalPlot } from '@/utils/ionosphere/temporalPlot'
import { colorAt } from '@/cesium/ionosphere/shader/transferFunction'
import { profileHeights } from '@/utils/ionosphere/temporal'
const props = defineProps({
  rows: { type: Array, required: true },
  heights: { type: Array, required: true },
  pointLabel: { type: String, default: '' },
  altitude: { type: Number, required: true },
})
const scale = ref('log'),
  labels = ['固定点 Ne', '区域平均 Ne', '区域最大 Ne']
const plot = computed(() => temporalPlot(props.rows, props.heights, scale.value))
const detailsOpen = ref(false),
  profileIndex = ref(null)
const profileRows = computed(() => props.rows.filter((r) => r.status === 'success'))
watch(
  profileRows,
  (rows) => {
    if (!rows.some((r) => r.index === profileIndex.value))
      profileIndex.value = rows[0]?.index ?? null
  },
  { immediate: true }
)
const selectedProfile = computed(() => {
  const row = profileRows.value.find((r) => r.index === profileIndex.value)
  const heights = profileHeights(props.heights)
  return row
    ? row.profile.map((value, i) => ({ value, altitude: heights[i], timestamp: row.timestamp }))
    : []
})
const charts = computed(() => [
  {
    title: '固定位置电子密度变化',
    subtitle: `${props.pointLabel} · ${props.altitude} km · 三线性采样`,
    indices: [0],
  },
  {
    title: '研究区域电子密度变化',
    subtitle: `${props.heights.join('–')} km · 有效网格中心算术均值 / 最大值`,
    indices: [1, 2],
  },
])
const scientific = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toExponential(2) : '—')
const utc = (v) => new Date(v).toISOString().slice(0, 19).replace('T', ' ')
const gradient = `linear-gradient(to right, ${Array.from(
  { length: 21 },
  (_, i) =>
    'rgb(' +
    colorAt(i / 20, 'blue-red')
      .map((v) => Math.round(v * 255))
      .join(',') +
    ')'
).join(',')})`
</script>
