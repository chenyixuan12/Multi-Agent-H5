import { createApp } from 'vue'
import App from './App.vue'
import Vant from 'vant'
import router from './router'
import 'vant/lib/index.css'
import './style.css'
import { createPinia } from 'pinia'

// vConsole 的 fetch 劫持会破坏 SSE 流式响应（读取中抛 TypeError），仅在显式调试时启用
const enableVConsole = new URLSearchParams(window.location.search).has('vconsole')
if (import.meta.env.DEV && enableVConsole) {
    import('vconsole').then(({ default: VConsole }) => new VConsole())
}
const app = createApp(App)

app.use(router)
app.use(Vant)
app.use(createPinia())
app.mount('#app')
