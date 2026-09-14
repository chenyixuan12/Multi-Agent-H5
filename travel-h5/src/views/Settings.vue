<template>
  <div class="page">
    <van-nav-bar title="设置" left-arrow fixed safe-area-inset-top @click-left="goBack" />

    <div class="content">
      <van-cell-group inset>
        <van-cell title="消息通知" :value="notifyText" is-link @click="toggleNotify" />
        <van-cell title="深色模式" :value="themeText" is-link @click="toggleTheme" />
        <van-cell title="清除缓存" is-link @click="clearCache" />
      </van-cell-group>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { showToast } from 'vant'
import { useRouter } from 'vue-router'

const router = useRouter()
const notify = ref(true)
const darkMode = ref(false)

const notifyText = computed(() => (notify.value ? '已开启' : '已关闭'))
const themeText = computed(() => (darkMode.value ? '已开启' : '已关闭'))

const goBack = () => router.back()
const toggleNotify = () => {
  notify.value = !notify.value
  showToast(notify.value ? '已开启消息通知' : '已关闭消息通知')
}
const toggleTheme = () => {
  darkMode.value = !darkMode.value
  showToast(darkMode.value ? '已开启深色模式' : '已关闭深色模式')
}
const clearCache = () => showToast('缓存已清理')
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding-top:calc(46px + env(safe-area-inset-top));
  background: transparent;
}
.content {
  padding: 12px;
}
</style>
