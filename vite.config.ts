import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 参考复现计划第 9.2 节：/api → http://127.0.0.1:6800，rewrite 去掉 /api 前缀
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:6800',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
