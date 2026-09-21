<template>
  <nav class="system-nav" aria-label="主导航">
    <router-link
      v-for="item in systemModules"
      :key="item.key"
      :to="item.path"
      class="system-nav-link"
      :class="{ 'is-active': route.meta.moduleKey === item.key }"
      :aria-current="route.meta.moduleKey === item.key ? 'page' : undefined"
      :title="item.title"
    >
      <component :is="moduleIcons[item.key]" class="nav-icon" aria-hidden="true" />
      <span>{{ item.title }}</span>
      <span
        v-if="route.meta.moduleKey === item.key"
        class="nav-active-mark"
        aria-hidden="true"
      ></span>
    </router-link>
  </nav>
</template>

<script setup>
import { useRoute } from 'vue-router'
import { systemModules } from '@/config/navigation'
import { moduleIcons } from '@/components/ionosphere/icons'
const route = useRoute()
</script>
