import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

// PPTist(编辑器) 全局样式：prosemirror 富文本 / 动画 / 主题变量已在 vite scss additionalData 注入
import 'prosemirror-view/style/prosemirror.css'
import 'animate.css'
import '@ppt/assets/styles/prosemirror.scss'
import '@ppt/assets/styles/global.scss'
import '@ppt/assets/styles/font.scss'

import Directive from '@ppt/directive'

createApp(App).use(createPinia()).use(router).use(Directive).mount('#app')
