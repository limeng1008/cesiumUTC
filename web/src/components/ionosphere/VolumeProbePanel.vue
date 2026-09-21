<template>
  <aside class="volume-probe" aria-label="空间数据探针">
    <h2>空间探针</h2>
    <label class="probe-switch"
      ><input
        v-model="store.settings.probeEnabled"
        type="checkbox"
        aria-label="开启空间探针"
      />开启点击取样</label
    >
    <p class="volume-note">
      竖直剖面优先拾取并联动二维图；水平切片取视线中最近的可见层，可降低最高高度访问下层。{{
        store.parameter
      }}
      来自当前网格插值，不由屏幕颜色反算。
    </p>
    <dl aria-live="polite">
      <dt>经度</dt>
      <dd>{{ point?.longitude.toFixed(3) ?? '—' }}<small>°</small></dd>
      <dt>纬度</dt>
      <dd>{{ point?.latitude.toFixed(3) ?? '—' }}<small>°</small></dd>
      <dt>高度</dt>
      <dd>{{ point?.altitude.toFixed(2) ?? '—' }}<small>km</small></dd>
      <dt>{{ store.parameterLabel }} {{ store.parameter }}</dt>
      <dd class="probe-value">
        {{ scientific(point?.value) }}<small>{{ store.unitLabel }}</small>
      </dd>
      <template
        v-if="point?.source === 'vertical-section' && store.settings.section.kind === 'path'"
        ><dt>沿线距离</dt>
        <dd>{{ point.distance?.toFixed(2) }}<small>km</small></dd></template
      >
    </dl>
    <label
      >插值方式<select v-model="store.settings.interpolation" aria-label="插值方式">
        <option value="trilinear">Trilinear · 三线性</option>
        <option value="nearest">Nearest · 最近邻</option>
      </select></label
    >
    <details>
      <summary>指定坐标采样</summary>
      <form @submit.prevent="store.sample(coordinate)">
        <label
          >经度 °<input
            v-model.number="coordinate.longitude"
            type="number"
            step="any"
            min="-180"
            max="180"
            required
            aria-label="采样经度" /></label
        ><label
          >纬度 °<input
            v-model.number="coordinate.latitude"
            type="number"
            step="any"
            :min="store.metadata?.validDomain?.latitudeMin ?? -90"
            :max="store.metadata?.validDomain?.latitudeMax ?? 90"
            required
            aria-label="采样纬度" /></label
        ><label
          >高度 km<input
            v-model.number="coordinate.altitude"
            type="number"
            step="any"
            :min="store.altitudeBounds[0]"
            :max="store.altitudeBounds[1]"
            required
            aria-label="采样高度" /></label
        ><button :disabled="!store.metadata || store.loading">采样</button>
      </form>
    </details>
    <div v-if="store.metadata" class="grid-information">
      <h2>网格信息</h2>
      <strong>{{ dimensions }}</strong>
      <p>经度 × 纬度 × 高度</p>
      <p>
        {{ count.toLocaleString() }} voxels ·
        {{ (store.metadata.byteLength / 1048576).toFixed(2) }} MiB
      </p>
      <p>WGS84 · {{ store.altitudeBounds.join('–') }} km</p>
      <p>数据：{{ store.sourceLabel }}</p>
      <p v-if="store.metadata.sourceVariable">
        源变量：{{ store.metadata.sourceVariable }} · {{ store.metadata.sourceUnit }} →
        {{ store.unitLabel }}
      </p>
      <p v-if="store.metadata.species">离子物种：{{ store.metadata.species }}</p>
      <p v-if="store.metadata.timestamp">模型时刻：{{ store.metadata.timestamp }}</p>
      <p v-if="store.metadata.validDomain">
        有效纬度：{{ store.metadata.validDomain.latitudeMin }}° 至
        {{ store.metadata.validDomain.latitudeMax }}°
      </p>
    </div>
    <details class="volume-limitations">
      <summary>精度与兼容性说明</summary>
      <p v-if="store.source === 'shandong-mock'" class="volume-note">
        当前为确定性模拟演示，采用真实高度的网格切片，不使用体素体渲染。颜色叠加仅供定性观察，请以探针
        {{ store.parameter }} 为准。省界为 DataV
        示意边界，不用于测绘。在线影像不可用时回退本地底图。
      </p>
      <p v-else class="volume-note">
        Cesium Voxel 为实验性 API，需要 WebGL2。体渲染的椭球等高面采用 Cesium
        近似，不宜用像素位置量测精密高度。体探针采用有限步长视线采样，原生拾取漏选时取可见范围内最大透明度贡献的样点，并非透明体唯一表面；极薄结构可能漏选。切片曲面以
        0.5° 三角网格近似等高面。数值查询基于当前体数据网格，导入模型经过重采样，不以屏幕颜色反算。
      </p>
    </details>
    <details v-if="debug" open class="volume-debug">
      <summary>开发诊断</summary>
      <p>数据加载 {{ store.loadMs.toFixed(0) }} ms</p>
      <p>活动渲染 {{ store.diagnostics?.fps?.toFixed(1) ?? '—' }} fps</p>
      <p>CPU 提交 {{ store.diagnostics?.renderMs?.toFixed(1) ?? '—' }} ms</p>
      <p>
        step / SSE {{ store.diagnostics?.stepSize ?? '—' }} /
        {{ store.diagnostics?.screenSpaceError ?? '—' }}
      </p>
      <p>
        纹理数据下限 {{ ((store.diagnostics?.gpuBytesEstimate || 0) / 1048576).toFixed(2) }} MiB
      </p>
      <p>GPU 总显存：浏览器未提供</p>
      <p>体数据网格索引 {{ point?.voxelIndex ?? '—' }}</p>
      <p>插值 {{ store.parameter }} {{ scientific(point?.value) }} {{ store.unitLabel }}</p>
      <p v-if="store.metadata">
        min/max {{ scientific(store.metadata.minValue) }} /
        {{ scientific(store.metadata.maxValue) }}
      </p>
    </details>
  </aside>
</template>
<script setup>
import { computed, reactive } from 'vue'
import { useVolumeStore } from '@/store/ionosphere/volume'
import { scientific } from '@/utils/ionosphere/normalize'
defineProps({ debug: Boolean })
const store = useVolumeStore(),
  point = computed(() => store.selectedPoint)
const coordinate = reactive({ longitude: 116.391, latitude: 39.907, altitude: 300 })
const dimensions = computed(() => {
  const m = store.metadata
  return m ? `${m.longitude.count} × ${m.latitude.count} × ${m.altitude.count}` : '—'
})
const count = computed(() => {
  const m = store.metadata
  return m ? m.longitude.count * m.latitude.count * m.altitude.count : 0
})
</script>
