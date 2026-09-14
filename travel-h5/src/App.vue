<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const active = computed(() => {
  const map = { '/': 0, '/chat': 1, '/profile': 2 }
  return map[route.path] ?? 0
})


</script>

<template>
  <div class="app-container">
    
    <router-view />
    <van-tabbar v-model="active" safe-area-inset-bottom>
      <van-tabbar-item to="/" icon="home-o">首页</van-tabbar-item>
      <van-tabbar-item to="/chat" icon="chat-o">对话</van-tabbar-item>
      <van-tabbar-item to="/profile" icon="user-o">我的</van-tabbar-item>
    </van-tabbar>

  </div>
</template>

<style scoped>
html, body, #app {
  min-height: 100%;
}
.app-container {
  min-height: 100dvh;
  min-height: -webkit-fill-available; /* 老 iOS 兜底 */
  width: 100%;
  max-width: 100vw;
  padding-bottom: calc(56px + env(safe-area-inset-bottom));
  overflow-x: hidden;
}

:deep(router-view) {
  flex: 1;
  overflow-y: auto;
}
</style>
