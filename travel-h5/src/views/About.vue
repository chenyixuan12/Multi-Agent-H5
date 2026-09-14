<template>
  <div class="page">
    <van-nav-bar title="关于我们" left-arrow fixed safe-area-inset-top @click-left="goBack" />

    <div class="content">
      <van-cell-group inset>
        <van-cell title="项目名称" value="AI智能旅游规划助手" />
        <van-cell title="技术栈" value="Vue3 + Vite + Vant + Node.js" />
        <van-cell title="功能说明" label="支持行程规划、AI对话、快捷入口导航" />
      </van-cell-group>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()
const goBack = () => router.back()
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding-top: calc(46px + env(safe-area-inset-top));
  background: transparent;
}
.content {
  padding: 12px;
}
</style>
