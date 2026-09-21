<template>
  <aside class="volume-controls" aria-label="体参数控制">
    <div class="panel-heading">
      <h2>参数控制</h2>
      <button @click="store.reset">重置</button>
    </div>
    <ManagedVolumeSource />
    <fieldset :disabled="store.loading || !store.metadata">
      <section class="region-controls" aria-label="区域选择">
        <h3>研究区域</h3>
        <div class="region-actions">
          <button
            aria-label="绘制矩形研究区域"
            :disabled="store.drawingRegion"
            @click="store.drawRegion"
          >
            绘制矩形
          </button>
          <button
            aria-label="取消区域绘制"
            :disabled="!store.drawingRegion"
            @click="store.cancelRegion"
          >
            取消
          </button>
          <button aria-label="清除研究区域" :disabled="!s.region" @click="store.clearRegion">
            清除
          </button>
          <button aria-label="聚焦研究区域" :disabled="!s.region" @click="store.focusRegion">
            聚焦
          </button>
          <button :disabled="!s.region" @click="store.useScientificSlices">科研切片预设</button>
        </div>
        <p class="volume-note">
          在地球表面依次点击两个角点，按 Esc
          取消。选区自动显示局部包络；科研切片预设仅调整显示，不更换数据。
        </p>
        <p v-if="store.regionHint" class="region-hint" role="status">{{ store.regionHint }}</p>
        <p class="region-summary">{{ regionSummary }}</p>
      </section>
      <label
        >显示模式<select
          :value="s.displayMode"
          aria-label="显示模式"
          @change="store.setMode($event.target.value)"
        >
          <option value="volume">三维体渲染</option>
          <option value="height-slice">高度切片</option>
          <option value="multi-height-slice">多高度切片</option>
          <option disabled>等值面 · 暂未开发</option>
          <option value="latitude-section">纬向剖面 · 固定纬度</option>
          <option value="longitude-section">经向剖面 · 固定经度</option>
          <option value="path-section">路径剖面 · 地图画线</option>
        </select></label
      >
      <div class="volume-checks">
        <label><input v-model="s.volumeVisible" type="checkbox" />显示体数据</label
        ><label><input v-model="s.sliceVisible" type="checkbox" />显示切片</label>
      </div>
      <SectionControls />
      <label
        >色标范围<select v-model="s.rangeMode" aria-label="色标范围模式">
          <option value="global">全数据 · 当前时刻网格</option>
          <option value="region">当前区域 · 含高度裁剪</option>
          <option value="manual">手动范围</option>
        </select></label
      >
      <p v-if="store.rangeEmpty" class="volume-note" role="status">当前区域无有效数据</p>
      <label class="range-title"
        >高度裁剪 <output>{{ s.altitudeRange[0] }}–{{ s.altitudeRange[1] }} km</output></label
      >
      <n-slider
        v-model:value="s.altitudeRange"
        range
        :min="store.altitudeBounds[0]"
        :max="store.altitudeBounds[1]"
        :step="5"
        aria-label="高度裁剪范围"
      />
      <div class="range-inputs">
        <input
          :value="s.altitudeRange[0]"
          aria-label="最低高度 km"
          type="number"
          :min="store.altitudeBounds[0]"
          :max="s.altitudeRange[1] - 1"
          @change="commitHeight('altitudeRange', 0, $event)"
        /><span>—</span
        ><input
          :value="s.altitudeRange[1]"
          aria-label="最高高度 km"
          type="number"
          :min="s.altitudeRange[0] + 1"
          :max="store.altitudeBounds[1]"
          @change="commitHeight('altitudeRange', 1, $event)"
        />
      </div>
      <button class="preset" @click="s.altitudeRange = [200, 500]">F 区 · 200–500 km</button>
      <label v-if="s.sliceVisible"
        >切片层数<select v-model="s.sliceMode" aria-label="切片层数">
          <option value="single">单层</option>
          <option value="multiple">多层 · 最多 4 层</option>
        </select></label
      >
      <label v-if="s.sliceVisible && s.sliceMode === 'single'"
        >切片高度 · {{ s.sliceAltitude }} km<input
          v-model.number="s.sliceAltitude"
          aria-label="切片高度"
          type="range"
          :min="store.altitudeBounds[0]"
          :max="store.altitudeBounds[1]"
          step="5" /><input
          :value="s.sliceAltitude"
          aria-label="切片高度 km"
          type="number"
          :min="store.altitudeBounds[0]"
          :max="store.altitudeBounds[1]"
          @change="commitHeight('sliceAltitude', null, $event)"
      /></label>
      <section
        v-if="s.sliceVisible && s.sliceMode === 'multiple'"
        class="slice-heights"
        aria-label="多层切片高度"
      >
        <div v-for="(height, index) in s.sliceAltitudes" :key="index" class="slice-height-row">
          <label :for="`slice-height-${index}`">第 {{ index + 1 }} 层 · km</label>
          <input
            :id="`slice-height-${index}`"
            :value="height"
            :aria-label="`第 ${index + 1} 层切片高度 km`"
            type="number"
            :min="store.altitudeBounds[0]"
            :max="store.altitudeBounds[1]"
            @change="commitSliceHeight(index, $event)"
          />
          <button
            :aria-label="`删除第 ${index + 1} 层切片`"
            :disabled="s.sliceAltitudes.length <= 1"
            @click="removeSliceHeight(index)"
          >
            −
          </button>
        </div>
        <button
          class="preset"
          aria-label="添加高度切片"
          :disabled="s.sliceAltitudes.length >= 4"
          @click="addSliceHeight"
        >
          添加一层
        </button>
      </section>
      <template v-if="s.sliceVisible">
        <small class="slice-range-note">高度裁剪范围外的切片暂时隐藏，配置仍保留。</small>
        <label
          ><input
            v-model="s.sliceLabels"
            type="checkbox"
            aria-label="显示切片高度标签"
          />显示高度标签</label
        >
      </template>
      <label class="range-title"
        >{{ store.parameterLabel }}范围 <span>{{ store.unitLabel }}</span></label
      >
      <div class="range-inputs">
        <input
          :value="s.valueRange[0].toExponential(3)"
          :aria-label="'最低' + store.parameterLabel"
          type="number"
          :min="s.normalization === 'log' ? 1e-30 : 0"
          :max="s.valueRange[1]"
          step="any"
          @change="commitValue(0, $event)"
        /><span>—</span
        ><input
          :value="s.valueRange[1].toExponential(3)"
          :aria-label="'最高' + store.parameterLabel"
          type="number"
          :min="s.valueRange[0]"
          step="any"
          @change="commitValue(1, $event)"
        />
      </div>
      <small>{{ scientific(s.valueRange[0]) }} — {{ scientific(s.valueRange[1]) }}</small>
      <label
        >归一化<select v-model="s.normalization" aria-label="归一化">
          <option value="log">Log Scale · log₁₀ {{ store.parameter }}</option>
          <option value="linear">Linear Scale · {{ store.parameter }}</option>
        </select></label
      >
      <label
        >科学色带<select v-model="s.colorMap" aria-label="科学色带">
          <option value="viridis">Viridis</option>
          <option value="scientific">Scientific · Turbo-like</option>
          <option value="blue-red">蓝–青–绿–黄–红</option>
        </select></label
      >
      <label
        >全局透明度 <output>{{ Math.round(s.opacity * 100) }}%</output
        ><input
          v-model.number="s.opacity"
          aria-label="全局透明度"
          type="range"
          min="0"
          max="1"
          step="0.01"
      /></label>
      <label
        >低值不透明度 <output>{{ Math.round(s.lowValueOpacity * 100) }}%</output
        ><input
          v-model.number="s.lowValueOpacity"
          aria-label="低值不透明度"
          type="range"
          min="0"
          max="1"
          step="0.01"
      /></label>
      <small>相对于全局不透明度；低于低值阈值的数据始终隐藏。</small>
      <label
        >低值阈值 <output>{{ scientific(thresholdValue(s.thresholdLow)) }}</output
        ><input
          v-model.number="s.thresholdLow"
          aria-label="低值阈值"
          type="range"
          min="0"
          :max="s.thresholdHigh - 0.01"
          step="0.01"
      /></label>
      <label
        >透明度满值阈值 <output>{{ scientific(thresholdValue(s.thresholdHigh)) }}</output
        ><input
          v-model.number="s.thresholdHigh"
          aria-label="透明度满值阈值"
          type="range"
          :min="s.thresholdLow + 0.01"
          max="1"
          step="0.01"
      /></label>
      <label
        >渲染质量<select v-model="s.quality" aria-label="渲染质量">
          <option value="performance">性能 · step 2 / SSE 8</option>
          <option value="standard">标准 · step 1 / SSE 4</option>
          <option value="high">高质量 · step 0.5 / SSE 1</option>
        </select></label
      >
    </fieldset>
    <label
      >数据网格<select
        v-model="store.resolution"
        aria-label="数据网格"
        :disabled="store.loading || !store.metadata"
        @change="store.reload"
      >
        <option value="standard">72 × 36 × 32</option>
        <option value="fine">144 × 72 × 64</option>
      </select></label
    >
    <p v-if="store.metadata?.source === 'sami3-model'" class="volume-note">
      SAMI3 模型数据 · 单时刻 {{ store.parameterLabel }}模拟，不代表实测电离层。
    </p>
    <p v-else-if="store.metadata" class="volume-note">
      确定性模拟数据，仅用于算法与可视化验证，不代表实测电离层。
    </p>
  </aside>
</template>
<script setup>
import { NSlider } from 'naive-ui'
import SectionControls from './SectionControls.vue'
import ManagedVolumeSource from './ManagedVolumeSource.vue'
import { useVolumeStore } from '@/store/ionosphere/volume'
import { scientific } from '@/utils/ionosphere/normalize'
import { computed, toRaw } from 'vue'
import { sanitizeSettings } from '@/models/ionosphere/IonosphereVolume'
const store = useVolumeStore(),
  s = store.settings
const regionSummary = computed(() => {
  const r = s.region
  return r
    ? `经度 ${r.west.toFixed(1)}° → ${r.east.toFixed(1)}°，纬度 ${r.south.toFixed(
        1
      )}°–${r.north.toFixed(1)}°${r.east < r.west ? ' · 跨日期变更线' : ''}`
    : '全球 · 未设置区域'
})
function thresholdValue(t) {
  const [lo, hi] = s.valueRange
  return s.normalization === 'log'
    ? 10 ** (Math.log10(lo) + (Math.log10(hi) - Math.log10(lo)) * t)
    : lo + (hi - lo) * t
}
function fixRanges() {
  Object.assign(s, sanitizeSettings(toRaw(s), store.metadata))
}
function commitValue(index, event) {
  const value = event.target.valueAsNumber
  if (Number.isFinite(value)) {
    s.rangeMode = 'manual'
    s.valueRange[index] = value
  }
  fixRanges()
  event.target.value = s.valueRange[index].toExponential(3)
}
function commitHeight(key, index, event) {
  const value = event.target.valueAsNumber
  if (Number.isFinite(value)) {
    if (index === null) s[key] = value
    else s[key][index] = value
  }
  fixRanges()
  event.target.value = index === null ? s[key] : s[key][index]
}
function commitSliceHeight(index, event) {
  const value = event.target.valueAsNumber
  if (Number.isFinite(value)) s.sliceAltitudes[index] = value
  fixRanges()
  event.target.value = s.sliceAltitudes[index] ?? ''
}
function addSliceHeight() {
  if (s.sliceAltitudes.length >= 4) return
  const [min, max] = store.altitudeBounds
  const previous = s.sliceAltitudes.at(-1) ?? min
  let next = Math.min(max, Math.max(min, previous + 100))
  if (s.sliceAltitudes.includes(next)) {
    const candidates = [min, ...s.sliceAltitudes, max].sort((a, b) => a - b)
    next = candidates.find((height) => !s.sliceAltitudes.includes(height))
    if (next === undefined) {
      const gap = candidates.findIndex((height, index) => candidates[index + 1] > height)
      if (gap < 0) return
      next = (candidates[gap] + candidates[gap + 1]) / 2
    }
  }
  s.sliceAltitudes.push(next)
  fixRanges()
}
function removeSliceHeight(index) {
  if (s.sliceAltitudes.length <= 1) return
  s.sliceAltitudes.splice(index, 1)
}
</script>
