<template>
  <section class="analysis-panel analysis-profile" aria-label="电子密度高度剖面">
    <header class="analysis-panel-head">
      <div>
        <h2>电子密度高度剖面</h2>
        <small>ALTITUDE PROFILE · Ne</small>
      </div>
      <label
        >横轴<select v-model="scale" aria-label="剖面横轴">
          <option value="log">对数 log₁₀</option>
          <option value="linear">线性 Ne</option>
        </select></label
      >
    </header>
    <div class="analysis-chart-legend">
      <span>━━ 区域均值</span><span class="point-key">┄┄ 选定位置</span>
    </div>
    <svg
      v-if="plot"
      viewBox="0 0 620 314"
      role="img"
      aria-label="横轴电子密度，纵轴高度；实线区域均值，虚线选定位置"
    >
      <g v-for="tick in plot.yTicks" :key="tick.y">
        <path class="analysis-gridline" :d="`M72 ${tick.y}H568`" />
        <text x="58" :y="tick.y + 4" text-anchor="end">{{ tick.value.toFixed(0) }}</text>
      </g>
      <g v-for="tick in plot.xTicks" :key="tick.x">
        <path class="analysis-gridline" :d="`M${tick.x} 30V258`" />
        <text :x="tick.x" y="278" text-anchor="middle">
          {{ scale === 'log' ? tick.value.toFixed(1) : tick.value.toExponential(1) }}
        </text>
      </g>
      <text x="16" y="20">km</text>
      <text x="320" y="306" text-anchor="middle">
        {{ scale === 'log' ? 'log₁₀ Ne (m⁻³)' : 'Ne (m⁻³)' }}
      </text>
      <g
        v-for="(path, index) in plot.paths"
        :key="index"
        :class="['analysis-series', { 'point-series': index === 1 }]"
      >
        <path :d="path" />
        <circle v-for="p in plot.points[index]" :key="p.altitude" :cx="p.x" :cy="p.y" r="3">
          <title>{{ p.altitude.toFixed(2) }} km · {{ p.value.toExponential(6) }} m⁻³</title>
        </circle>
      </g>
    </svg>
    <p v-else class="analysis-empty">
      {{ loading ? '正在读取入库网格…' : '暂无可绘制数据。零值请切换线性坐标；也可调整研究范围。' }}
    </p>
    <p class="analysis-note">
      缺失值不连线；对数坐标不显示零值。数值明细（5 位有效数字）见下方表格。
    </p>
  </section>
</template>
<script setup>
import { computed, ref } from 'vue'
import { profilePlot } from '@/utils/ionosphere/profilePlot'
const props = defineProps({
  layers: { type: Array, default: () => [] },
  profile: { type: Object, default: null },
  loading: { type: Boolean, default: false },
})
const scale = ref('log')
const plot = computed(() =>
  profilePlot(
    [
      { altitudes: props.layers.map((l) => l.altitude), values: props.layers.map((l) => l.mean) },
      props.profile || { altitudes: [], values: [] },
    ],
    scale.value
  )
)
</script>
