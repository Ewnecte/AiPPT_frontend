<script setup lang="ts">
// P05 幻灯片编辑器 —— PPTist 编辑器包装器
// ------------------------------------------------------------------
// 本页不再自研编辑器，而是把 vendored 的 PPTist 内核全套能力挂到 /editor：
// 缩略图栏 + 画布 + 顶部工具栏 + 右侧样式面板 + 撤销/重做 + 自带导出/放映。
//
// 数据流：
//   /generate 页把后端 SSE 生成的 SlideSchema[] 存在外层 draft store（仅供流式预览）
//   → 进入本页后由 draft.exportSchemas() 还原成 SlideSchema[]
//   → 经 utils/schemaToPptist.ts 排版为 PPTist Slide[]（1000×562.5 坐标系）
//   → 灌入 PPTist 的 slides store，之后完全交给 PPTist 编辑。
//
// PPTist 内核是单例 store：离开本页再回来时，若外层草稿没变则沿用 PPTist 中
// 已编辑的 deck（不重复覆盖），只有重新生成（草稿数组引用变化）才重新装载。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import { useDraftStore } from '../store/slides'
import type { SlideSchema } from '../types/AIPPT'
import { SAMPLE_OUTLINE, parseOutline, schemasFromOutline } from '../utils/aippt'
import { getTemplateData } from '../services'
import { makeBlankCover, schemasToPptistSlides, type DeckTheme } from '../utils/schemaToPptist'
import type { Slide } from '../pptist/types/slides'

import PptEditor from '@ppt/views/Editor/index.vue'
import PptScreen from '@ppt/views/Screen/index.vue'
import { useMainStore, useSlidesStore, useSnapshotStore } from '@ppt/store'
import { useScreenStore } from '@ppt/store/screen'
import { db } from '@ppt/utils/database'

const router = useRouter()
const draftStore = useDraftStore()
const slidesStore = useSlidesStore()
const mainStore = useMainStore()
const snapshotStore = useSnapshotStore()
const screenStore = useScreenStore()

const { screening } = storeToRefs(screenStore)

// 本页三态：loading（初始化中）/ empty（无内容引导）/ ready（编辑或放映）
const phase = ref<'loading' | 'empty' | 'ready'>('loading')

// 记录上一次装载的来源，避免导航往返时重复覆盖用户已在 PPTist 里的编辑。
// 'demo' = 载入过内置演示数据；否则为对应的一次性外层草稿数组引用。
let lastLoadedSource: unknown = null

// 模板主题缓存（按 templateId），避免每次进入编辑器重复拉取
const themeCache = new Map<string, DeckTheme | null>()

/** 依据模板选择页存下的 templateId 拉取模板 theme；无模板/失败返回 null（用内置紫蓝）。 */
async function resolveTheme(): Promise<DeckTheme | null> {
  const id = draftStore.meta.templateId?.trim()
  if (!id) return null
  const cached = themeCache.get(id)
  if (cached !== undefined) return cached
  let theme: DeckTheme | null = null
  try {
    const deck = await getTemplateData(id)
    const t = deck.theme
    if (t && Array.isArray(t.themeColors) && t.themeColors.length) {
      theme = {
        name: deck.name || t.name,
        themeColors: t.themeColors,
        backgroundColor: t.backgroundColor,
        fontColor: t.fontColor,
        fontName: t.fontName,
      }
    }
  } catch {
    theme = null // 拉取失败不影响进入编辑器，回落默认主题
  }
  themeCache.set(id, theme)
  return theme
}

// ---------------------------------------------------------------- 装载
function titleFromDraft(): string {
  const t = draftStore.meta.title?.trim()
  return t || '未命名演示文稿'
}

async function installDeck(slides: Slide[], title: string) {
  // 放入 PPTist 画布；deck 为空的兜底一页空白封面，保证画布始终可编辑
  slidesStore.setSlides(slides.length ? slides : [makeBlankCover(title)])
  slidesStore.setTitle(title)
  // 强制 16:9 画布（防上次被改动比例），并把当前页定位到第一页
  slidesStore.setViewportSize(1000)
  slidesStore.setViewportRatio(0.5625)
  slidesStore.updateSlideIndex(0)

  mainStore.setDisableHotkeysState(false)
  mainStore.setAIPPTDialogState(false)
  mainStore.setDialogForExport('')
  mainStore.setActiveElementIdList([])

  // 撤销/重做历史是 indexedDB 快照、且跨 deck 共享 —— 换 deck 必须先清空再重建基线
  await db.snapshots.clear()
  await snapshotStore.initSnapshotDatabase()
}

async function installSchemas(schemas: SlideSchema[], title: string, theme?: DeckTheme | null) {
  const slides = schemasToPptistSlides(schemas, theme ?? null)
  await installDeck(slides, title)
}

/** 由外层 draft store 还原并装载（重新生成后才触发），并应用所选模板主题色 */
async function loadFromDraft() {
  const schemas = draftStore.exportSchemas()
  const theme = await resolveTheme()
  await installSchemas(schemas, titleFromDraft(), theme)
}

/** 无草稿时载入内置演示大纲，快速体验编辑器 */
async function loadDemo() {
  const md = SAMPLE_OUTLINE
  const schemas = schemasFromOutline(md)
  const title = parseOutline(md).title?.trim() || '演示文稿'
  await installSchemas(schemas, title, null)
  lastLoadedSource = 'demo'
  phase.value = 'ready'
}

function goGenerate() {
  // 新的四步流程以「大纲生成」为第一步，从这里重新开始生成
  router.push('/')
}

onMounted(async () => {
  screenStore.setScreening(false)

  const hasDraft = draftStore.slides.length > 0

  if (hasDraft) {
    if (lastLoadedSource !== draftStore.slides) {
      await loadFromDraft()
      lastLoadedSource = draftStore.slides
    }
    // 即便已装过同源 deck，也清一次活动元素等瞬态，避免残留选中态
    mainStore.setActiveElementIdList([])
    phase.value = 'ready'
  } else {
    // 从未装过任何 deck → 空态引导；已装过（演示数据 / 上次的 deck）→ 沿用
    phase.value = lastLoadedSource === null ? 'empty' : 'ready'
  }
})

onBeforeUnmount(() => {
  screenStore.setScreening(false)
  mainStore.setDisableHotkeysState(false)
  mainStore.setAIPPTDialogState(false)
  mainStore.setDialogForExport('')
  mainStore.setActiveElementIdList([])
})
</script>

<template>
  <div class="aippt-editor-shell">
    <!-- PPTist 全屏放映（screenStore.screening 置真时接管整页） -->
    <PptScreen v-if="screening" class="host" />
    <!-- PPTist 编辑器主界面 -->
    <PptEditor v-else-if="phase === 'ready'" class="host" />

    <!-- 加载态 -->
    <div v-else-if="phase === 'loading'" class="state">
      <div class="spinner"></div>
      <p>正在装配编辑器…</p>
    </div>

    <!-- 空态：还没有可编辑的内容 -->
    <div v-else class="state">
      <div class="empty-card">
        <div class="empty-icon">✍️</div>
        <h2>还没有可编辑的幻灯片</h2>
        <p class="empty-tip">
          按「大纲生成 → 大纲编辑 → 选择模板 → PPT生成」走完流程后进入本编辑器，
          可逐页精修、添加图文图表并导出；也可用内置演示数据先快速体验。
        </p>
        <div class="empty-actions">
          <button class="btn primary" type="button" @click="goGenerate">去生成演示文稿</button>
          <button class="btn ghost" type="button" @click="loadDemo">载入内置演示数据</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aippt-editor-shell {
  width: 100%;
  /* 外层顶栏高 60px（见 App.vue .topbar），编辑器占满其余视口 */
  height: calc(100vh - 60px);
  overflow: hidden;
  background: #f2f4f8;
}
.host {
  width: 100%;
  height: 100%;
}
.state {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #6b7280;
  font-size: 14px;
}
.spinner {
  width: 30px;
  height: 30px;
  border: 3px solid #e2e6f0;
  border-top-color: #667eea;
  border-radius: 50%;
  animation: rot 0.8s linear infinite;
}
@keyframes rot {
  to {
    transform: rotate(360deg);
  }
}
.empty-card {
  background: #fff;
  border-radius: 18px;
  padding: 44px 52px;
  max-width: 480px;
  text-align: center;
  box-shadow: 0 18px 50px rgba(30, 40, 80, 0.08);
}
.empty-icon {
  font-size: 44px;
  margin-bottom: 10px;
}
.empty-card h2 {
  font-size: 20px;
  color: #1d2140;
  margin-bottom: 10px;
}
.empty-tip {
  font-size: 13px;
  line-height: 1.8;
  color: #7b8499;
  margin-bottom: 22px;
}
.empty-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}
.btn {
  border: none;
  cursor: pointer;
  border-radius: 10px;
  padding: 11px 20px;
  font-size: 14px;
  font-weight: 700;
  transition: 0.15s;
}
.btn.primary {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.btn.ghost {
  background: #f3f4fb;
  color: #4b5563;
}
.btn:hover {
  opacity: 0.92;
  transform: translateY(-1px);
}
</style>
