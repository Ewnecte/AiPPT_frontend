<script setup lang="ts">
// P07 演示放映页（顶层导航「放映」→ /screen）
// ------------------------------------------------------------------
// 复用 PPTist 自带的放映内核（src/pptist/views/Screen），自带：
// 画笔 / 激光笔 / 计时器 / 演讲者视图 / 观众视图 / 结束放映 等能力，
// 与编辑器里编辑后的最终版所见即所得（同一份 PPTist deck）。
//
// 数据源优先级：
//   1. PPTist store 已有 deck（通常是刚从编辑器/放映链路进来）→ 直接放映；
//   2. 无 deck 但有 draft（生成结果尚未打开过编辑器）→ exportSchemas() 还原并装载；
//   3. 都没有 → 提示先去「生成」页创建内容。
//
// 退出：PPTist 结束放映会把 screenStore.screening 置回 false，本页监听后返回编辑器。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDraftStore } from '../store/slides'
import { useMainStore, useSlidesStore } from '@ppt/store'
import { useScreenStore } from '@ppt/store/screen'
import { makeBlankCover, schemasToPptistSlides } from '../utils/schemaToPptist'
import type { Slide } from '@ppt/types/slides'
import PptScreen from '@ppt/views/Screen/index.vue'

const router = useRouter()
const draftStore = useDraftStore()
const slidesStore = useSlidesStore()
const mainStore = useMainStore()
const screenStore = useScreenStore()

// 是否已有可放映内容（有则挂 PPTist 放映，无则显示空态引导）
const ready = ref(false)

function titleFromDraft(): string {
  const t = draftStore.meta.title?.trim()
  return t || '未命名演示文稿'
}

function installDeck(slides: Slide[], title: string) {
  slidesStore.setSlides(slides.length ? slides : [makeBlankCover(title)])
  slidesStore.setTitle(title)
  slidesStore.setViewportSize(1000)
  slidesStore.setViewportRatio(0.5625)
  slidesStore.updateSlideIndex(0)

  // 清掉上一处可能残留的瞬态，避免拖进放映页
  mainStore.setDisableHotkeysState(false)
  mainStore.setAIPPTDialogState(false)
  mainStore.setDialogForExport('')
  mainStore.setActiveElementIdList([])
}

function ensureDeck(): boolean {
  // 已在 PPTist 中的 deck（含编辑器里的修改）优先，从头开始放映
  if (slidesStore.slides.length) {
    slidesStore.updateSlideIndex(0)
    return true
  }
  // 尚未打开过编辑器：由外层 draft 还原
  const schemas = draftStore.exportSchemas()
  if (!schemas.length) return false
  installDeck(schemasToPptistSlides(schemas), titleFromDraft())
  return true
}

// 监听 PPTist 结束放映（screening → false）后返回编辑器
watch(
  () => screenStore.screening,
  (v) => {
    if (!v && ready.value) router.push('/editor')
  },
)

onMounted(() => {
  if (ensureDeck()) {
    ready.value = true
    screenStore.setScreening(true)
  }
})

onBeforeUnmount(() => {
  screenStore.setScreening(false)
})

function goGenerate() {
  router.push('/generate')
}
</script>

<template>
  <div class="screen-page">
    <PptScreen v-if="ready" />
    <!-- 无可放映内容时的空态引导 -->
    <div v-else class="empty">
      <div class="empty-icon">🎬</div>
      <h2>暂无可放映的幻灯片</h2>
      <p>先去「生成」页根据大纲/文件生成 PPT，再回来放映。</p>
      <button class="btn primary" type="button" @click="goGenerate">去生成内容</button>
    </div>
  </div>
</template>

<style scoped>
.screen-page {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #0b0d16;
}
.screen-page :deep(.pptist-screen) {
  width: 100%;
  height: 100%;
}
.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #cfd6ec;
  text-align: center;
  padding: 24px;
}
.empty-icon {
  font-size: 52px;
}
.empty h2 {
  font-size: 20px;
  color: #fff;
}
.empty p {
  font-size: 13px;
  color: #9aa4c8;
}
.btn {
  border: none;
  cursor: pointer;
  border-radius: 10px;
  padding: 11px 22px;
  font-size: 14px;
  font-weight: 700;
  transition: 0.15s;
}
.btn.primary {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  margin-top: 6px;
}
.btn.primary:hover {
  opacity: 0.92;
}
</style>
