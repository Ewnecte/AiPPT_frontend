<script setup lang="ts">
// 全局左侧“会话/生成记录”侧边栏
// ------------------------------------------------------------------
// 常驻在应用左侧（放映全屏除外），可折叠。点会话行=继续编辑该会话的大纲；
// 行内提供「打开最新结果进编辑器」「删除」。归档写入/删除后自动刷新列表。
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGenerationStore } from '../store/generation'
import { useDraftStore } from '../store/slides'
import { useSessionsStore, listSessions, type SessionDoc } from '../store/sessions'
import { loadDeckTheme } from '../utils/theme'

const route = useRoute()
const router = useRouter()
const gen = useGenerationStore()
const draft = useDraftStore()
const sessions = useSessionsStore()

const LS_COLLAPSED = 'aippt.sidebar.collapsed'
const collapsed = ref(false)
try {
  collapsed.value = localStorage.getItem(LS_COLLAPSED) === '1'
} catch {
  /* noop */
}
const docs = ref<SessionDoc[]>([])
const loading = ref(false)
const busyId = ref('')

function persistCollapsed() {
  try {
    if (collapsed.value) localStorage.setItem(LS_COLLAPSED, '1')
    else localStorage.removeItem(LS_COLLAPSED)
  } catch {
    /* noop */
  }
}
function toggle() {
  collapsed.value = !collapsed.value
  persistCollapsed()
}

async function refresh() {
  loading.value = true
  try {
    const all = await listSessions()
    docs.value = all.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    /* 静默：读不到时不阻塞页面 */
  } finally {
    loading.value = false
  }
}

watch(
  () => sessions.revision,
  () => void refresh(),
)
watch(
  () => route.path,
  () => void refresh(),
)
onMounted(() => void refresh())

function fmtTime(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function loadContext(doc: SessionDoc) {
  sessions.setActive(doc.id)
  gen.setTopic(doc.topic)
  gen.setParams({
    language: doc.language || '中文',
    model: doc.model || gen.model,
    source: doc.source === 'file' ? 'file' : 'text',
  })
  gen.setMarkdown(doc.outline || '')
  if (doc.fileId) gen.setUploadedFile(doc.fileId, doc.fileName)
  else gen.clearUploadedFile()
}

/** 点行：继续编辑该会话的大纲 */
function openOutline(doc: SessionDoc) {
  loadContext(doc)
  router.push('/outline')
}

/** 打开该会话最新一版结果进编辑器 */
async function openLatest(doc: SessionDoc) {
  const run = doc.runs[doc.runs.length - 1]
  if (!run || busyId.value) return
  busyId.value = doc.id
  try {
    loadContext(doc)
    const theme = await loadDeckTheme(run.templateId)
    draft.reset()
    draft.setMeta({
      title: doc.title,
      outline: run.outline || doc.outline,
      templateId: run.templateId,
      templateTheme: theme,
      language: doc.language || '中文',
      source: run.kbSource || 'none',
    })
    draft.importSchemas(run.slides)
    router.push('/editor')
  } finally {
    busyId.value = ''
  }
}

function newSession() {
  gen.reset()
  draft.reset()
  sessions.newSession()
  router.push('/')
}

async function remove(doc: SessionDoc) {
  if (!window.confirm(`确认删除会话「${doc.title}」？其全部生成版本将一并删除，不可恢复。`)) return
  if (busyId.value) return
  busyId.value = doc.id
  try {
    await sessions.remove(doc.id)
  } finally {
    busyId.value = ''
  }
}
</script>

<template>
  <!-- 折叠态：窄条一键展开 -->
  <aside v-if="collapsed" class="sessions-rail" aria-label="会话">
    <button class="rail-btn" type="button" title="展开会话列表" @click="toggle">☰<span>会话</span></button>
  </aside>

  <aside v-else class="sessions">
    <header class="s-head">
      <div class="s-title">
        <span class="s-logo">🗂️</span>
        <strong>会话</strong>
      </div>
      <button class="icon-btn" type="button" title="收起" @click="toggle">⟨</button>
    </header>

    <button class="new-btn" type="button" @click="newSession">＋ 新建会话</button>

    <div class="s-list" role="list">
      <p v-if="loading && !docs.length" class="s-tip">加载中…</p>
      <p v-else-if="!docs.length" class="s-tip">还没有会话记录。<br />完成一次「大纲生成→PPT生成」后会自动出现在这里。</p>

      <article
        v-for="doc in docs"
        :key="doc.id"
        class="s-item"
        :class="{ active: doc.id === sessions.activeId }"
        role="listitem"
        @click="openOutline(doc)"
      >
        <div class="s-item-title">{{ doc.title }}</div>
        <div class="s-item-meta">
          <span>{{ fmtTime(doc.updatedAt) }}</span>
          <span v-if="doc.runs.length">· {{ doc.runs.length }} 版</span>
          <span v-else>· {{ doc.outline.length }} 字大纲</span>
        </div>
        <div class="s-item-ops" @click.stop>
          <button
            type="button"
            class="op-btn"
            title="编辑大纲"
            :disabled="busyId === doc.id"
            @click="openOutline(doc)"
          >✎</button>
          <button
            type="button"
            class="op-btn"
            title="打开最新结果进编辑器"
            :disabled="busyId === doc.id || !doc.runs.length"
            @click="openLatest(doc)"
          >▶</button>
          <button type="button" class="op-btn danger" title="删除会话" :disabled="busyId === doc.id" @click="remove(doc)">✕</button>
        </div>
      </article>
    </div>
  </aside>
</template>

<style scoped>
.sessions-rail {
  flex: 0 0 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 10px;
}
.rail-btn {
  writing-mode: vertical-rl;
  border: 1px solid #dfe3ef;
  background: #fff;
  color: #4f46e5;
  border-radius: 10px;
  padding: 10px 6px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}
.rail-btn:hover {
  background: #eef0ff;
}
.sessions {
  flex: 0 0 264px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #f8f9fe;
  border-right: 1px solid #e7eaf4;
  padding: 14px 12px;
  height: calc(100vh - 60px);
  position: sticky;
  top: 60px;
  overflow: hidden;
}
.s-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.s-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  color: #1f2430;
}
.s-logo {
  font-size: 16px;
}
.icon-btn {
  border: none;
  background: transparent;
  color: #8a94a6;
  font-size: 18px;
  cursor: pointer;
  padding: 2px 6px;
  line-height: 1;
  border-radius: 6px;
}
.icon-btn:hover {
  background: #eceefb;
  color: #4f46e5;
}
.new-btn {
  border: 1px dashed #c7d0f4;
  background: #fff;
  color: #4f46e5;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
}
.new-btn:hover {
  background: #eef0ff;
}
.s-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.s-tip {
  color: #9aa2b5;
  font-size: 12px;
  line-height: 1.8;
  text-align: center;
  padding: 18px 4px;
}
.s-item {
  position: relative;
  background: #fff;
  border: 1px solid #e7eaf4;
  border-radius: 12px;
  padding: 10px 12px;
  cursor: pointer;
  transition: 0.12s;
}
.s-item:hover {
  border-color: #c7d0f4;
}
.s-item.active {
  border-color: #8d9bee;
  background: #eef0ff;
  box-shadow: 0 2px 10px rgba(102, 126, 234, 0.18);
}
.s-item-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2430;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.s-item-meta {
  font-size: 12px;
  color: #8a94a6;
  margin-top: 3px;
}
.s-item-ops {
  position: absolute;
  right: 6px;
  top: 6px;
  display: none;
  gap: 2px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  padding: 2px;
}
.s-item:hover .s-item-ops,
.s-item:focus-within .s-item-ops {
  display: flex;
}
.op-btn {
  border: 1px solid transparent;
  background: transparent;
  color: #55627c;
  font-size: 12px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.op-btn:hover:not(:disabled) {
  background: #eef0ff;
  color: #4f46e5;
}
.op-btn.danger:hover:not(:disabled) {
  background: #fef2f2;
  color: #dc2626;
}
.op-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
@media (max-width: 860px) {
  .sessions {
    flex-basis: 220px;
  }
}
</style>
