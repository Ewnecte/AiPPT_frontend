import { createRouter, createWebHistory } from 'vue-router'

// 路由规划见 SRS 3.1：/、/ppt、/editor、/screen（+ /settings）
const routes = [
  { path: '/', name: 'outline', component: () => import('../views/Outline.vue') },
  { path: '/ppt', name: 'template', component: () => import('../views/TemplateSelect.vue') },
  { path: '/editor', name: 'editor', component: () => import('../views/Editor.vue') },
  { path: '/screen', name: 'screen', component: () => import('../views/Screen.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/Settings.vue') },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
