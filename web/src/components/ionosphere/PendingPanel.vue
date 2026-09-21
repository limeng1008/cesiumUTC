<template>
  <section class="data-panel">
    <header>
      <h2>{{ title }}</h2>
      <span class="panel-code">{{ code }}</span>
    </header>
    <div class="data-panel-empty technical-grid">
      <component :is="moduleIcons[icon]" class="empty-panel-icon" aria-hidden="true" />
      <span>暂未开发</span>
      <small>{{ description }}</small>
    </div>
  </section>
</template>
<script setup>
import { moduleIcons } from './icons'
defineProps({ title: String, code: String, icon: String, description: String })
</script>
