<template>
  <details v-if="grid && store.settings.section.visible" class="section-plot" open>
    <summary>
      二维剖面 · {{ store.parameterLabel }} · {{ title }} <span>点击与三维联动</span>
    </summary>
    <p class="section-plot-meta">
      {{ store.sourceLabel }} · {{ store.metadata?.timestamp || '确定性模拟' }} ·
      {{ grid.columns }} × {{ grid.rows }} 插值采样
    </p>
    <div class="section-plot-body">
      <div class="section-y-labels">
        <span>{{ grid.altitudes[0].toFixed(0) }}</span
        ><span>高度 km</span><span>{{ grid.altitudes[grid.rows - 1].toFixed(0) }}</span>
      </div>
      <div class="section-plot-field">
        <div class="section-canvas-wrap">
          <canvas
            ref="canvas"
            width="800"
            height="220"
            :aria-label="'二维' + store.parameterLabel + '剖面，点击取样'"
            role="img"
            @click="pick"
          ></canvas>
          <svg
            v-if="point"
            viewBox="0 0 800 220"
            preserveAspectRatio="none"
            class="section-crosshair"
            aria-hidden="true"
          >
            <path
              :d="`M ${point.sectionU * 800} 0 V 220 M 0 ${point.sectionV * 220} H 800`"
              stroke="white"
              stroke-width="1"
              stroke-dasharray="4 3"
            />
            <circle
              :cx="point.sectionU * 800"
              :cy="point.sectionV * 220"
              r="4"
              fill="none"
              stroke="white"
            />
          </svg>
        </div>
        <div class="section-x-labels">
          <span v-for="(label, i) in ticks" :key="i">{{ label }}</span>
        </div>
        <div class="section-axis-title">
          {{
            grid.kind === 'longitude'
              ? '纬度 °N · 南 → 北'
              : grid.kind === 'latitude'
              ? '经度 ° · 西 → 东'
              : '沿线距离 km · 起点 → 终点'
          }}
        </div>
      </div>
    </div>
    <p class="section-plot-meta">
      {{
        point
          ? `${point.longitude.toFixed(3)}° / ${point.latitude.toFixed(
              3
            )}° · ${point.altitude.toFixed(2)} km · ${store.parameter} ${scientific(point.value)} ${
              store.unitLabel
            }`
          : '点击彩色有效区域取值；无数据透明。数值来自当前网格，不从颜色反算。'
      }}
    </p>
  </details>
</template>
<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { useVolumeStore } from '@/store/ionosphere/volume'
import { createSectionRaster, sampleSectionGrid } from '@/utils/ionosphere/sections'
import { scientific } from '@/utils/ionosphere/normalize'
import './section-plot.scss'
const store = useVolumeStore(),
  canvas = ref(null)
const grid = computed(() => store.sectionGrid)
const point = computed(() =>
  store.selectedPoint?.source === 'vertical-section' ? store.selectedPoint : null
)
const title = computed(
  () => ({ longitude: '固定经度', latitude: '固定纬度', path: '沿线剖切' }[grid.value?.kind] || '')
)
const ticks = computed(() =>
  grid.value
    ? [0, 0.25, 0.5, 0.75, 1].map((u) => {
        const g = grid.value,
          x = u * (g.columns - 1),
          i = Math.min(Math.floor(x), g.columns - 2),
          t = x - i
        if (g.kind === 'path')
          return (g.distances[i] + t * (g.distances[i + 1] - g.distances[i])).toFixed(1)
        // Positions are already sampled along the same path as the curtain.
        const p = sampleSectionGrid(
          { ...g, values: new Float32Array(g.values.length).fill(1) },
          u,
          0
        )
        return (g.kind === 'longitude' ? p.latitude : p.longitude).toFixed(2)
      })
    : []
)
async function paint() {
  await nextTick()
  if (!canvas.value || !grid.value) return
  const g = grid.value,
    source = document.createElement('canvas')
  source.width = g.columns
  source.height = g.rows
  const ctx = source.getContext('2d'),
    pixels = ctx.createImageData(g.columns, g.rows)
  pixels.data.set(createSectionRaster(g, store.settings))
  for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] > 0) pixels.data[i] = 255
  ctx.putImageData(pixels, 0, 0)
  const target = canvas.value.getContext('2d')
  target.clearRect(0, 0, 800, 220)
  target.drawImage(source, 0.5, 0.5, g.columns - 1, g.rows - 1, 0, 0, 800, 220)
}
watch(
  [
    grid,
    () => store.settings.valueRange,
    () => store.settings.colorMap,
    () => store.settings.normalization,
    () => store.settings.opacity,
    () => store.settings.thresholdLow,
    () => store.settings.thresholdHigh,
    () => store.settings.lowValueOpacity,
  ],
  paint,
  { deep: true, immediate: true }
)
function pick(event) {
  const box = canvas.value.getBoundingClientRect()
  store.sampleSection(
    (event.clientX - box.left) / box.width,
    (event.clientY - box.top) / box.height
  )
}
</script>
