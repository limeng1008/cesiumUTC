<template>
  <div class="volume-legend" :aria-label="store.parameterLabel + '科学色标'">
    <div class="legend-title">
      <span
        >{{ store.parameterLabel }} <b>{{ store.parameter }}</b>
        <span>({{ store.unitLabel }})</span></span
      ><span
        >{{
          { global: '全数据 · 当前网格', region: '当前区域', manual: '手动' }[settings.rangeMode]
        }}
        · {{ settings.normalization === 'log' ? 'Log Scale · log₁₀' : 'Linear Scale' }}</span
      >
    </div>
    <div class="legend-gradient" :style="{ background: gradient }"></div>
    <div class="legend-ticks">
      <span v-for="(value, index) in ticks" :key="index">{{ scientific(value) }}</span>
    </div>
  </div>
</template>
<script setup>
import { computed } from 'vue'
import { colorLUT } from '@/cesium/ionosphere/shader/transferFunction'
import { scientific } from '@/utils/ionosphere/normalize'
import { useVolumeStore } from '@/store/ionosphere/volume'
const store = useVolumeStore()
const props = defineProps({ settings: { type: Object, required: true } })
const gradient = computed(
  () =>
    `linear-gradient(90deg,${colorLUT[props.settings.colorMap]
      .map((rgb) => `rgb(${rgb.map((c) => Math.round(c * 255)).join(',')})`)
      .join(',')})`
)
const ticks = computed(() =>
  [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const [lo, hi] = props.settings.valueRange
    return props.settings.normalization === 'log'
      ? 10 ** (Math.log10(lo) + t * (Math.log10(hi) - Math.log10(lo)))
      : lo + (hi - lo) * t
  })
)
</script>
