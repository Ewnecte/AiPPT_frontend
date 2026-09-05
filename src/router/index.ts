import { createRouter, createWebHistory } from 'vue-router'

// 路由规划见 SRS 3.1：/input、/outline、/ppt、/editor、/screen（+ /settings）
const routes = [
  { path: '/', name: 'input', component: () => import('../views/Input.vue') },
  { path: '/outline', name: 'outline', component: () => import('../views/Outline.vue') },
  { path: '/ppt', name: 'template', component: () => import('../views/TemplateSelect.vue') },
  { path: '/generate', name: 'generate', component: () => import('../views/Generate.vue') },
  { path: '/editor', name: 'editor', meta: { wide: true }, component: () => import('../views/Editor.vue') },
  { path: '/screen', name: 'screen', meta: { fullscreen: true }, component: () => import('../views/Screen.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/Settings.vue') },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
