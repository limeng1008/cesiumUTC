<template>
  <section
    v-if="s.displayMode.endsWith('-section') || s.section.visible"
    class="section-controls"
    aria-label="竖直剖面控制"
  >
    <h3>竖直剖面</h3>
    <label><input v-model="s.section.visible" type="checkbox" />显示竖直剖面</label>
    <template v-if="s.section.kind !== 'path'">
      <p class="volume-note">
        {{ longitude ? '固定经度，沿南北方向展开' : '固定纬度，沿东西方向展开' }}
      </p>
      <label
        >{{ longitude ? '固定经度 °E' : '固定纬度 °N' }}
        <input
          :value="position"
          :aria-label="longitude ? '剖面经度' : '剖面纬度'"
          type="range"
          :min="bounds[0]"
          :max="bounds[1]"
          step="0.05"
          @input="commit($event)"
        />
        <input
          :value="position"
          :aria-label="longitude ? '剖面经度数值' : '剖面纬度数值'"
          type="number"
          :min="bounds[0]"
          :max="bounds[1]"
          step="0.05"
          @change="commit($event)"
        />
      </label>
    </template>
    <template v-else>
      <div class="region-actions">
        <button :disabled="store.drawingSection" @click="store.drawSection">绘制剖切线</button>
        <button :disabled="!store.drawingSection" @click="store.cancelSection">取消画线</button>
        <button :disabled="!s.section.path" @click="store.clearSection">清除剖切线</button>
      </div>
      <p v-if="s.section.path" class="volume-note">
        起点 {{ coordinate(s.section.path[0]) }}<br />终点 {{ coordinate(s.section.path[1]) }}
      </p>
      <p v-else class="volume-note">在地面点击起点、终点。沿 WGS84 最短测地线展开。</p>
      <p class="region-hint" role="status">{{ store.sectionHint }}</p>
    </template>
    <p class="volume-note">
      高度跟随裁剪范围 · 当前网格插值<br />可同时显示水平切片，点击剖面取值。
    </p>
    <button :disabled="!s.section.visible || !store.sectionGrid" @click="store.focusRegion">
      聚焦剖面
    </button>
  </section>
</template>
<script setup>
import { computed } from 'vue'
import { useVolumeStore } from '@/store/ionosphere/volume'
import { displayRegion, longitudeSpan } from '@/utils/ionosphere/region'
const store = useVolumeStore(),
  s = store.settings
const longitude = computed(() => s.section.kind === 'longitude')
const region = computed(() => (store.metadata ? displayRegion(s.region, store.metadata) : null))
const bounds = computed(() => {
  const r = region.value
  return longitude.value
    ? r
      ? [r.west, r.west + longitudeSpan(r)]
      : [-180, 180]
    : r
    ? [r.south, r.north]
    : [-90, 90]
})
const position = computed(() => {
  const n = longitude.value ? s.section.longitude : s.section.latitude
  return longitude.value && n < bounds.value[0] ? n + 360 : n
})
function commit(event) {
  const n = event.target.valueAsNumber
  if (Number.isFinite(n)) {
    const v = Math.max(bounds.value[0], Math.min(bounds.value[1], n))
    if (longitude.value) s.section.longitude = ((((v + 180) % 360) + 360) % 360) - 180
    else s.section.latitude = v
  }
  event.target.value = position.value
}
function coordinate(p) {
  return `${p.longitude.toFixed(2)}° / ${p.latitude.toFixed(2)}°`
}
</script>
