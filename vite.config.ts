import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'
import { FileSystemIconLoader } from 'unplugin-icons/loaders'
import IconsResolver from 'unplugin-icons/resolver'
import Components from 'unplugin-vue-components/vite'

// PPTist(vendor@src/pptist)：模板内以 <i-xxx/> 使用图标（主题目录 icons + icon-park）
export default defineConfig({
  plugins: [
    vue(),
    Components({
      dirs: [],
      resolvers: [
        IconsResolver({
          prefix: 'i',
          customCollections: ['custom'],
        }),
      ],
    }),
    Icons({
      compiler: 'vue3',
      autoInstall: false,
      customCollections: {
        custom: FileSystemIconLoader(fileURLToPath(new URL('./src/pptist/assets/icons', import.meta.url))),
      },
      scale: 1,
      defaultClass: 'i-icon',
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // 默认指向真实主 API(6800)；无 Key 联调 mock 时可用 VITE_API_TARGET=http://127.0.0.1:6801 覆盖
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:6800',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `
          @import '@ppt/assets/styles/variable.scss';
          @import '@ppt/assets/styles/mixin.scss';
        `,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@ppt': fileURLToPath(new URL('./src/pptist', import.meta.url)),
    },
  },
})
