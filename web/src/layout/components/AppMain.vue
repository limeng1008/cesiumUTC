<template>
  <router-view v-slot="{ Component, route }">
    <KeepAlive :include="keepAliveRouteNames">
      <component
        :is="Component"
        v-if="appStore.reloadFlag"
        :key="
          appStore.aliveKeys[route.name] ||
          (route.path === '/time-variation'
            ? route.path
            : route.path === '/analysis'
            ? route.path
            : route.path === '/ionosphere'
            ? route.path
            : route.fullPath)
        "
      />
    </KeepAlive>
  </router-view>
</template>

<script setup>
import { useAppStore } from '@/store'
import { useRouter } from 'vue-router'
const appStore = useAppStore()
const router = useRouter()

const allRoutes = router.getRoutes()
const keepAliveRouteNames = computed(() => {
  return allRoutes.filter((route) => route.meta?.keepAlive).map((route) => route.name)
})
</script>
