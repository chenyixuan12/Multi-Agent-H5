import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import pxToViewport from 'postcss-px-to-viewport-8-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    // Cloudflare Tunnel uses a temporary *.trycloudflare.com Host header.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3300',
        changeOrigin: true,
        allowedHosts: true,
      },
    },
  },
  css: {
    postcss: {
      plugins: [
        pxToViewport({
          viewportWidth: 375,        // 设计稿宽度（看你的 px 值，如 10px padding、44px 高度，像 375 设计稿）
          unitPrecision: 5,          // 换算精度
          viewportUnit: 'vw',
          minPixelValue: 1,          // 1px 及以下不转，保住边框、1px 细线
          mediaQuery: false,
          exclude: [/node_modules/], // 只转你自己的代码，不动 vant 组件库
        }),
      ],
    },
  },
})
