<template>
  <section class="overview-chart">
    <header>
      <h2>{{ titles[kind][0] }}</h2>
      <small>{{ titles[kind][1] }}</small>
    </header>
    <template v-if="kind === 'tec' && store.analysis?.range">
      <div class="tec-map" @click="pickTec">
        <canvas ref="canvas" role="img" aria-label="全球 TEC 分布，点击选择经纬度" />
        <span v-if="store.point" class="tec-point" :style="pointStyle"></span>
      </div>
      <div class="chart-ticks"><span>180°W</span><span>0°</span><span>180°E</span></div>
      <p>点击分布图选点 · {{ store.analysis.altitudeRange.join('–') }} km 区间电子含量 (TECU)</p>
    </template>
    <template v-else-if="kind === 'profile' && profile">
      <svg v-if="profileChart" viewBox="0 0 320 146" role="img" aria-label="电子密度随高度变化剖面">
        <path class="chart-axis" d="M48 12V112H306" />
        <path class="chart-line" :d="profileChart.path" />
        <text x="4" y="18">{{ profileChart.high }}</text>
        <text x="4" y="114">{{ profileChart.low }}</text>
        <text x="8" y="67">km</text>
        <text x="48" y="128">{{ profileChart.min }}</text>
        <text x="293" y="128">{{ profileChart.max }}</text>
        <text x="125" y="143">log₁₀ Ne (m⁻³)</text>
      </svg>
      <p v-else>当前廓线没有可绘制的正值，无法显示对数曲线。</p>
      <p>
        {{ store.point ? '选定位置' : '全球 F2 峰值所在柱' }} · {{ profile.longitude.toFixed(2) }}°,
        {{ profile.latitude.toFixed(2) }}°
      </p>
      <p>
        区间电子含量 {{ number(profile.tec) }} TECU · hmF2 {{ number(profile.peak?.hmF2) }} km ·
        foF2 {{ number(profile.peak?.foF2) }} MHz
      </p>
      <p>
        F2：{{ DERIVED_QUALITY_LABELS[profile.f2Quality] }} · 积分：{{
          DERIVED_QUALITY_LABELS[profile.contentQuality]
        }}
      </p>
    </template>
    <template v-else-if="kind === 'trend' && store.trend.length">
      <svg viewBox="0 0 320 140" role="img" aria-label="已加载时刻的全球平均柱 TEC 趋势">
        <path class="chart-axis" d="M42 14V108H308" />
        <text x="2" y="18">{{ number(trendChart.high) }}</text>
        <text x="2" y="108">{{ number(trendChart.low) }}</text>
        <text x="42" y="132">{{ clock(store.times[0]?.timestamp) }}</text>
        <text x="272" y="132">{{ clock(store.times.at(-1)?.timestamp) }}</text>
        <path class="chart-line" :d="trendChart.path" />
        <circle
          v-for="p in trendChart.points"
          :key="p.index"
          :cx="p.x"
          :cy="p.y"
          r="4"
          tabindex="0"
          role="button"
          :aria-label="`查看时刻 ${clock(p.timestamp)} UTC`"
          @click="store.selectTime(p.index)"
          @keydown.enter="store.selectTime(p.index)"
        >
          <title>{{ clock(p.timestamp) }} UTC · {{ number(p.meanTec) }} TECU</title>
        </circle>
      </svg>
      <p>全球平均柱 TEC · 已加载 {{ store.trend.length }} / {{ store.times.length }} 时刻</p>
      <p>仅显示实际加载结果，未加载时段不连线 · UTC</p>
    </template>
    <div v-else class="chart-empty">
      {{ store.loading ? '正在读取真实数据…' : '暂无有效数据，请选择数据集与时刻' }}
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { DERIVED_QUALITY_LABELS } from '@/models/ionosphere/Derived'
import { useOverviewStore } from '@/store/ionosphere/overview'
import {
  overviewProfile,
  overviewTimePosition,
  tecPosition,
  tecRaster,
} from '@/utils/ionosphere/overview'
const props = defineProps({ kind: { type: String, required: true } })
const titles = {
  tec: ['全球 TEC 分布', 'COLUMN TEC'],
  profile: ['电离层垂直剖面', 'ELECTRON DENSITY PROFILE'],
  trend: ['时间变化趋势', 'LOADED TIME SERIES'],
}
const store = useOverviewStore(),
  canvas = ref(null)
const number = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—')
const clock = (v) => (v ? new Date(v).toISOString().slice(11, 16) : '—')
const pointStyle = computed(() => ({
  left: `${((store.point.longitude + 180) / 360) * 100}%`,
  top: `${((90 - store.point.latitude) / 180) * 100}%`,
}))
const profile = computed(
  () =>
    store.profile ||
    (store.volume && store.analysis?.peak
      ? overviewProfile(store.volume, store.analysis.peak.longitude, store.analysis.peak.latitude)
      : null)
)
const profileChart = computed(() => {
  const p = profile.value
  if (!p) return null
  const logs = p.values.filter((v) => v !== null && v > 0).map(Math.log10)
  if (!logs.length) return null
  const min = Math.floor(Math.min(...logs)),
    max = Math.max(min + 1, Math.ceil(Math.max(...logs)))
  const low = p.altitudes[0],
    high = p.altitudes.at(-1)
  let path = '',
    connected = false
  p.values.forEach((v, i) => {
    if (v === null || v <= 0) {
      connected = false
      return
    }
    const x = 48 + ((Math.log10(v) - min) / (max - min)) * 258,
      y = 112 - ((p.altitudes[i] - low) / (high - low || 1)) * 100
    path += `${connected ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)} `
    connected = true
  })
  return { path, min, max, low, high }
})
const trendChart = computed(() => {
  const valid = store.trend.filter((t) => t.meanTec !== null),
    values = valid.map((t) => t.meanTec)
  const min = values.length ? Math.min(...values) : 0,
    max = values.length ? Math.max(...values) : 1
  const padding = Math.max((max - min) * 0.1, Math.abs(max) * 0.02, 0.1),
    low = Math.max(0, min - padding),
    high = max + padding
  const points = valid.map((p) => ({
    ...p,
    x:
      42 +
      overviewTimePosition(p.timestamp, store.times[0]?.timestamp, store.times.at(-1)?.timestamp) *
        266,
    y: 108 - ((p.meanTec - low) / (high - low)) * 94,
  }))
  const path = points
    .map((p, i) => `${i && points[i - 1].index === p.index - 1 ? 'L' : 'M'}${p.x},${p.y}`)
    .join(' ')
  return { points, path, low, high }
})
async function paint() {
  await nextTick()
  if (props.kind !== 'tec' || !canvas.value || !store.analysis) return
  const el = canvas.value,
    grid = store.analysis
  el.width = grid.longitude.count
  el.height = grid.latitude.count
  el.getContext('2d').putImageData(new ImageData(tecRaster(grid), el.width, el.height), 0, 0)
}
function pickTec(event) {
  const box = canvas.value?.getBoundingClientRect()
  if (!box || !store.analysis) return
  const p = tecPosition(
    store.analysis,
    (event.clientX - box.left) / box.width,
    (event.clientY - box.top) / box.height
  )
  if (p) store.pick(p.longitude, p.latitude)
}
watch(() => store.analysis, paint, { immediate: true, flush: 'post' })
watch(canvas, paint)
</script>
