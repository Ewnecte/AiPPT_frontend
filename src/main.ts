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
// 全局页面滚动/滚动条样式：必须在 PPTist 的 global.scss 之后引入，
// 用于覆盖它对 html/body 的 overflow:hidden 锁定，恢复整页滚动。
import './global.css'

import Directive from '@ppt/directive'

createApp(App).use(createPinia()).use(router).use(Directive).mount('#app')
