<template>
  <section class="pending-page">
    <header class="module-heading">
      <div>
        <span class="eyebrow">{{ module.english }}</span>
        <h1>{{ module.title }}</h1>
      </div>
      <span class="pending-tag">暂未开发</span>
    </header>
    <div class="pending-surface technical-grid">
      <div class="panel-coordinate">MODULE / {{ moduleIndex }}</div>
      <div class="pending-message">
        <div class="pending-icon">
          <component :is="moduleIcons[module.key]" aria-hidden="true" />
        </div>
        <span class="eyebrow">{{ module.english }}</span>
        <h2>暂未开发</h2>
        <p>{{ module.title }}功能尚未开发。</p>
        <n-button secondary type="primary" @click="router.push('/globe')">
          <template #icon><icon-mdi-arrow-left /></template>返回三维地球
        </n-button>
      </div>
      <div class="pending-surface-foot">
        <span>{{ module.title }}</span
        ><span>功能状态 <i></i> 暂未开发</span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton } from 'naive-ui'
import { systemModules } from '@/config/navigation'
import { moduleIcons } from '@/components/ionosphere/icons'
const route = useRoute()
const router = useRouter()
const module = computed(
  () => systemModules.find((item) => item.key === route.meta.moduleKey) || systemModules[1]
)
const moduleIndex = computed(() => String(systemModules.indexOf(module.value) + 1).padStart(2, '0'))
</script>
