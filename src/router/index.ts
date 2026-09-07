import { createRouter, createWebHistory } from 'vue-router'
import { useGenerationStore } from '../store/generation'

// 路由规划见 SRS 3.1：/input、/outline、/ppt、/editor、/screen（+ /settings）
const routes = [
  { path: '/', name: 'input', component: () => import('../views/Input.vue') },
  { path: '/outline', name: 'outline', component: () => import('../views/Outline.vue') },
  { path: '/ppt', name: 'template', component: () => import('../views/TemplateSelect.vue') },
  { path: '/editor', name: 'editor', component: () => import('../views/Editor.vue') },
  { path: '/screen', name: 'screen', component: () => import('../views/Screen.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/Settings.vue') },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 全局前置守卫：generation.busy（大纲/内容正在流式生成）期间禁止跳转到其它页面。
// 顶栏导航、步骤条、浏览器前进/后退都经过这里，统一在此拦截，避免离开后
// 流式结果丢失或与当前页状态不同步。点击当前页自身的链接（path 相同）不受影响。
router.beforeEach((to, from) => {
  if (useGenerationStore().busy && to.path !== from.path) return false
  return true
})

export default router
