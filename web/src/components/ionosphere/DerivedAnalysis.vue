<template>
  <section class="analysis-panel derived-panel" aria-label="Ne 派生分析">
    <header class="analysis-panel-head">
      <div>
        <h2>Ne 派生专题</h2>
        <small>区间电子含量 · F2 峰值参数 · 质量状态</small>
      </div>
      <label>
        派生专题量
        <select v-model="metric" aria-label="派生专题量" :disabled="!grid">
          <option v-for="(item, key) in definitions" :key="key" :value="key">
            {{ item.label }} / {{ item.unit }}
          </option>
        </select>
      </label>
    </header>
    <template v-if="grid">
      <div class="derived-body">
        <p class="analysis-note">{{ definition.description }}</p>
        <div class="derived-regional" aria-label="区域派生统计">
          <article v-for="item in regionalMetrics" :key="item.label">
            <span>{{ item.label }}</span>
            <strong>{{ format(item.value, item.metric) }}</strong>
            <small>{{ definitions[item.metric].unit }}</small>
          </article>
        </div>
        <p v-if="grid.peak" class="analysis-note">
          区域有效峰最大值所在柱：{{ grid.peak.longitude.toFixed(3) }}°,
          {{ grid.peak.latitude.toFixed(3) }}°；NmF2、hmF2、foF2 均来自该柱。
        </p>
        <p v-else class="analysis-note">无可靠 F2 峰；原因与柱数见质量统计。</p>
        <figure class="derived-figure">
          <div class="derived-map">
            <canvas
              ref="canvas"
              role="img"
              :aria-label="`${definition.label}经纬分布，北在上；可点击网格或使用指定位置剖面表单选点`"
              @click="pickCell"
            />
            <span v-if="marker" class="derived-point" :style="marker"></span>
          </div>
          <div class="derived-axis">
            <span>{{ grid.longitude.min }}° 经度</span>
            <span>{{ grid.longitude.max }}°</span>
          </div>
          <figcaption>
            纬度 {{ grid.latitude.min }}° 至 {{ grid.latitude.max }}°，北在上 · 点击网格中心选点，
            或使用“指定位置剖面”经纬度表单。透明区域表示无效结果或研究区域外。
          </figcaption>
        </figure>
        <div v-if="range" class="derived-legend" aria-label="线性色标">
          <div :style="{ background: legendGradient }" class="derived-colorbar"></div>
          <div class="derived-axis">
            <span>{{ format(range[0], metric) }}</span>
            <span>{{ definition.label }} / {{ definition.unit }} · 线性色标</span>
            <span>{{ format(range[1], metric) }}</span>
          </div>
          <p v-if="range[0] === range[1]" class="analysis-note">
            当前有效结果为同一值，使用色标中点颜色。
          </p>
        </div>
        <p v-else class="analysis-status" role="status">当前专题没有有效结果，分布图为空。</p>
        <div class="derived-quality" aria-label="派生质量统计">
          <section v-for="group in qualityGroups" :key="group.key">
            <h3>{{ group.label }}</h3>
            <p>
              有效 {{ group.valid }} / {{ grid.eligibleColumns }} · 无效
              {{ grid.eligibleColumns - group.valid }} 柱
            </p>
            <ul v-if="group.reasons.length">
              <li v-for="reason in group.reasons" :key="reason.code">
                {{ qualityLabels[reason.code] }}：{{ reason.count }} 柱
              </li>
            </ul>
          </section>
        </div>
        <section class="derived-selected" aria-label="采样位置派生量" aria-live="polite">
          <h3>采样位置派生量</h3>
          <template v-if="point">
            <p>{{ point.longitude.toFixed(4) }}°, {{ point.latitude.toFixed(4) }}° · Ne 廓线采样</p>
            <dl class="derived-point-metrics">
              <div v-for="(item, key) in definitions" :key="key">
                <dt>{{ item.label }} / {{ item.unit }}</dt>
                <dd>{{ format(pointValue(key), key) }}</dd>
              </div>
            </dl>
            <p>
              区间电子含量：{{ qualityLabels[point.content.quality] }} · 有效高度覆盖
              {{ (point.content.coverage * 100).toFixed(1) }}%
            </p>
            <p>F2：{{ qualityLabels[point.f2.quality] }}</p>
          </template>
          <p v-else class="analysis-note">尚未选择采样位置。点击分布图、地球，或输入经纬度。</p>
        </section>
        <details class="derived-provenance" open>
          <summary>数据来源与算法说明</summary>
          <p>
            来源：{{ metadata?.sourceName || metadata?.source || '—' }} · 文件：{{
              sourceFile || metadata?.sourceFile || '—'
            }}
          </p>
          <p>importId：{{ importId || '—' }} · {{ utc(metadata?.timestamp) }} UTC</p>
          <p v-if="metadata">
            网格：{{ metadata.longitude.count }} × {{ metadata.latitude.count }} ×
            {{ metadata.altitude.count }}； Δ经度 {{ metadata.longitude.step }}°，Δ纬度
            {{ metadata.latitude.step }}°，Δ高度 {{ metadata.altitude.step }} km。
          </p>
          <p>
            积分范围 {{ grid.integrationRange.join('–') }} km · F2 搜索窗
            {{ grid.f2Window.join('–') }} km · {{ grid.algorithm }}
          </p>
          <p>仅模型 Ne 推导，foF2 不是测高仪观测。区间电子含量不代表完整顶部 VTEC 或 GNSS STEC。</p>
          <p>
            相邻有效样本线性插值并作梯形积分：Σ(Ne₁ + Ne₂) / 2 × Δh[km] × 10⁻¹³
            TECU；缺测不跨越，缺测段不计为完整积分。元数据有效边缘至首末网格中心使用最近中心延拓，不向有效域外延伸。
          </p>
          <p>
            F2 默认搜索窗 200–600 km
            是初始算法窗口。完整覆盖、无缺测、唯一正内部峰才有效；并列峰相对容差
            10⁻⁶，不做平滑或亚网格拟合。foF2[MHz] = 8.98 × 10⁻⁶ × √NmF2[m⁻³]。
          </p>
          <p>
            区域按网格中心选柱；面积加权均值使用球面单元 Δ经度 × (sin北界 −
            sin南界)，纬度单元截至有效边界，研究框不做部分单元裁切。区域最大有效峰同值取 Y/X
            顺序首柱。
          </p>
        </details>
      </div>
    </template>
    <p v-else class="analysis-empty" role="status">暂无派生结果，请选择已入库 Ne 数据。</p>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { DERIVED_METRICS, DERIVED_QUALITY_LABELS } from '../../models/ionosphere/Derived'
import { derivedRaster } from '../../utils/ionosphere/derived'
import { wrapLongitude } from '../../utils/ionosphere/interpolation'
import { colorAt } from '../../cesium/ionosphere/shader/transferFunction'
const props = defineProps({
  grid: { type: Object, default: null },
  point: { type: Object, default: null },
  metadata: { type: Object, default: null },
  importId: { type: String, default: '' },
  sourceFile: { type: String, default: '' },
})
const emit = defineEmits(['point'])
const definitions = DERIVED_METRICS,
  qualityLabels = DERIVED_QUALITY_LABELS,
  metric = ref('content'),
  canvas = ref(null)
const definition = computed(() => definitions[metric.value])
const range = computed(() => props.grid?.ranges[metric.value])
const format = (value, key) =>
  typeof value === 'number' && Number.isFinite(value)
    ? key === 'nmF2'
      ? value.toExponential(4)
      : value.toFixed(2)
    : '—'
const utc = (value) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString().slice(0, 19).replace('T', ' ')
    : '—'
const regionalMetrics = computed(() => [
  { label: '区间电子含量 · 面积加权均值', metric: 'content', value: props.grid?.meanContent },
  { label: '最大有效 NmF2', metric: 'nmF2', value: props.grid?.peak?.nmF2 },
  { label: '同柱 hmF2', metric: 'hmF2', value: props.grid?.peak?.hmF2 },
  { label: '同柱 foF2', metric: 'foF2', value: props.grid?.peak?.foF2 },
])
const qualityGroups = computed(() =>
  props.grid
    ? ['content', 'f2'].map((key) => ({
        key,
        label: key === 'content' ? '区间电子含量质量' : 'F2 峰值质量',
        valid: key === 'content' ? props.grid.validContentColumns : props.grid.validF2Columns,
        reasons: Object.entries(props.grid.qualityCounts[key])
          .filter(([code, count]) => code !== 'valid' && count > 0)
          .map(([code, count]) => ({ code, count })),
      }))
    : []
)
function pointValue(key) {
  if (!props.point) return null
  if (key === 'content')
    return props.point.content.quality === 'valid' ? props.point.content.value : null
  return props.point.f2.quality === 'valid' ? props.point.f2.peak?.[key] : null
}
const legendGradient = computed(() => {
  const stops = Array.from({ length: 21 }, (_, i) => {
    const t = range.value?.[0] === range.value?.[1] ? 0.5 : i / 20
    return `rgb(${colorAt(t, 'blue-red')
      .map((c) => Math.round(c * 255))
      .join(',')}) ${i * 5}%`
  })
  return `linear-gradient(to right, ${stops.join(',')})`
})
const marker = computed(() => {
  if (!props.grid || !props.point) return null
  const { longitude: x, latitude: y } = props.grid
  const longitude =
    props.point.longitude + 360 * Math.round(((x.min + x.max) / 2 - props.point.longitude) / 360)
  if (
    longitude < x.min ||
    longitude > x.max ||
    props.point.latitude < y.min ||
    props.point.latitude > y.max
  )
    return null
  return {
    left: `${((longitude - x.min) / (x.max - x.min)) * 100}%`,
    top: `${((y.max - props.point.latitude) / (y.max - y.min)) * 100}%`,
  }
})
function pickCell(event) {
  const grid = props.grid
  if (!grid || !canvas.value) return
  const rect = canvas.value.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const x = Math.min(
    grid.longitude.count - 1,
    Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * grid.longitude.count))
  )
  const row = Math.min(
    grid.latitude.count - 1,
    Math.max(0, Math.floor(((event.clientY - rect.top) / rect.height) * grid.latitude.count))
  )
  const longitude = grid.longitude.min + (x + 0.5) * grid.longitude.step
  emit('point', {
    longitude: wrapLongitude(longitude),
    latitude: grid.latitude.min + (grid.latitude.count - row - 0.5) * grid.latitude.step,
  })
}
watch(
  () => [props.grid, metric.value],
  async () => {
    await nextTick()
    const el = canvas.value,
      grid = props.grid
    if (!el || !grid) return
    el.width = grid.longitude.count
    el.height = grid.latitude.count
    const context = el.getContext('2d')
    if (!context) return
    const image = context.createImageData(el.width, el.height)
    image.data.set(derivedRaster(grid, metric.value))
    context.putImageData(image, 0, 0)
  },
  { immediate: true }
)
</script>

<style scoped>
.derived-body {
  display: grid;
  gap: 16px;
  padding: 0 16px 16px;
  min-width: 0;
}
.derived-panel .analysis-panel-head {
  flex-wrap: wrap;
}
.derived-panel .analysis-panel-head label {
  min-width: 185px;
}
.derived-regional,
.derived-point-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.derived-regional article {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--an-border);
  border-radius: 4px;
}
.derived-regional span,
.derived-point-metrics dt {
  color: var(--an-muted);
  font-size: 12px;
}
.derived-regional strong,
.derived-point-metrics dd {
  font: 600 20px/1.4 ui-monospace, monospace;
  overflow-wrap: anywhere;
}
.derived-figure {
  margin: 0;
  min-width: 0;
}
.derived-map {
  position: relative;
  background: #07121e;
  border: 1px solid var(--an-border);
}
.derived-map canvas {
  display: block;
  width: 100%;
  height: clamp(200px, 24vw, 340px);
  image-rendering: pixelated;
  cursor: crosshair;
}
.derived-point {
  position: absolute;
  width: 12px;
  height: 12px;
  transform: translate(-50%, -50%);
  border: 2px solid white;
  background: #07121e;
  border-radius: 50%;
  pointer-events: none;
}
.derived-axis {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--an-muted);
  margin-top: 6px;
}
.derived-figure figcaption {
  font-size: 12px;
  color: var(--an-muted);
  line-height: 1.7;
  margin-top: 8px;
}
.derived-colorbar {
  height: 12px;
  border-radius: 2px;
}
.derived-quality {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.derived-quality section,
.derived-selected {
  padding: 14px;
  background: #0d253b;
  border-radius: 4px;
}
.derived-quality p,
.derived-selected p {
  font-size: 13px;
  color: var(--an-muted);
}
.derived-quality ul {
  margin: 8px 0 0;
  padding-left: 20px;
  font-size: 12px;
  color: #edbd77;
  line-height: 1.8;
}
.derived-point-metrics {
  margin: 12px 0;
}
.derived-point-metrics dd {
  margin: 6px 0 0;
}
.derived-provenance {
  border-top: 1px solid var(--an-border);
  font-size: 12px;
  color: var(--an-muted);
  overflow-wrap: anywhere;
}
.derived-provenance summary {
  padding-left: 0;
}
.derived-provenance p + p {
  margin-top: 7px;
}
@media (max-width: 1200px) {
  .derived-regional,
  .derived-point-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 540px) {
  .derived-quality {
    grid-template-columns: 1fr;
  }
  .derived-body {
    padding: 0 12px 12px;
  }
}
</style>
