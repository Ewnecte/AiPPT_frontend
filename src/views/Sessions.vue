<script setup lang="ts">
// P09 会话 / 生成记录页（路由 /sessions）
// ------------------------------------------------------------------
// 每次「大纲生成 → … → PPT 生成」自动归档为一个会话；会话内每次 PPT 生成完成
// 追加一个“生成版本(run)”，可随时重新打开进编辑器 / 按该版大纲再生成 / 继续编辑大纲。
// 数据：localStorage 记当前会话 id，IndexedDB 存会话正文（大纲 + SlideSchema[]）。
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDraftStore } from '../store/slides'
import { useGenerationStore } from '../store/generation'
import { useSessionsStore, listSessions, deleteSession, type SessionDoc, type SessionRun } from '../store/sessions'
import { loadDeckTheme } from '../utils/theme'

const router = useRouter()
const gen = useGenerationStore()
const draft = useDraftStore()
const sessions = useSessionsStore()

const docs = ref<SessionDoc[]>([])
const loading = ref(false)
const busyId = ref('')
const notice = ref('')

const STEP_LABEL: Record<string, string> = {
  outline: '大纲阶段',
  template: '模板选择后',
  done: '已完成',
}

async function refresh() {
  loading.value = true
  try {
    const all = await listSessions()
    docs.value = all.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (e) {
    notice.value = `读取会话失败：${(e as Error).message}`
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

function fmtTime(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 把会话上下文灌回 generation store，并切为当前会话。 */
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

function goOutline(doc: SessionDoc) {
  loadContext(doc)
  router.push('/outline')
}

/** 重新打开某个生成版本：直接载入编辑器（结果即所存即所见）。 */
async function openRun(doc: SessionDoc, run: SessionRun) {
  if (busyId.value) return
  busyId.value = run.id
  try {
    sessions.setActive(doc.id)
    loadContext(doc)
    const theme = await loadDeckTheme(run.templateId)
    draft.reset()
    draft.setMeta({
      title: run.outline ? run.outline.split('\n')[0]?.replace(/^#\s*/, '').trim() || doc.title : doc.title,
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

/** 按某版大纲重新生成 PPT（跳到 PPT 生成页自动开始）。 */
async function rerun(doc: SessionDoc, run: SessionRun) {
  if (busyId.value) return
  busyId.value = run.id
  try {
    sessions.setActive(doc.id)
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
    router.push('/generate')
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
  if (!window.confirm(`确认删除会话「${doc.title}」？其全部生成版本将被移除，不可恢复。`)) return
  if (busyId.value) return
  busyId.value = doc.id
  try {
    await deleteSession(doc.id)
    if (sessions.activeId === doc.id) sessions.clearActive()
    await refresh()
  } catch (e) {
    notice.value = `删除失败：${(e as Error).message}`
  } finally {
    busyId.value = ''
  }
}
</script>

<template>
  <section class="page">
    <div class="head">
      <div>
        <h1>会话 · 生成记录</h1>
        <p class="hint">每次「大纲生成 → PPT生成」自动归档为一个会话；会话内每版结果都可重新打开进编辑器。</p>
      </div>
      <button class="btn primary" type="button" @click="newSession">＋ 新建会话</button>
    </div>

    <p v-if="notice" class="error">{{ notice }}</p>

    <!-- 加载态 -->
    <div v-if="loading" class="state">正在读取会话记录…</div>

    <!-- 空态 -->
    <div v-else-if="!docs.length" class="state empty">
      <div class="empty-emoji">🗂️</div>
      <p>还没有会话记录。走一遍「大纲生成 → 编辑 → 选择模板 → PPT生成」后，结果会自动保存到这里。</p>
      <button class="btn primary" type="button" @click="newSession">去创建第一个会话</button>
    </div>

    <!-- 会话列表 -->
    <div v-else class="list">
      <article v-for="doc in docs" :key="doc.id" class="card" :class="{ current: doc.id === sessions.activeId }">
        <header class="card-head">
          <div class="titles">
            <h2>{{ doc.title }}</h2>
            <p class="meta">
              {{ fmtTime(doc.updatedAt) }}
              · {{ doc.runs.length ? `${doc.runs.length} 版生成结果` : '尚未生成' }}
              · 大纲 {{ doc.outline.length }} 字
            </p>
          </div>
          <div class="ops">
            <span class="tag">{{ STEP_LABEL[doc.step] || doc.step }}</span>
            <button class="btn ghost sm" type="button" :disabled="busyId === doc.id" @click="goOutline(doc)">编辑大纲</button>
            <button class="btn danger sm" type="button" :disabled="busyId === doc.id" @click="remove(doc)">删除</button>
          </div>
        </header>

        <div v-if="doc.runs.length" class="runs">
          <div v-for="(run, i) in [...doc.runs].reverse()" :key="run.id" class="run">
            <div class="run-info">
              <span class="run-no">第 {{ doc.runs.length - i }} 版</span>
              <span class="run-time">{{ fmtTime(run.createdAt) }}</span>
              <span v-if="run.templateId" class="run-tpl">模板 {{ run.templateId }}</span>
              <span class="run-count">{{ run.slides.length }} 页</span>
            </div>
            <div class="run-ops">
              <button class="btn primary sm" type="button" :disabled="busyId === run.id" @click="openRun(doc, run)">打开进编辑器</button>
              <button class="btn ghost sm" type="button" :disabled="busyId === run.id" @click="rerun(doc, run)">按此版再生成</button>
            </div>
          </div>
        </div>
        <p v-else class="none">（该会话还没有完成过 PPT 生成）</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
h1 {
  font-size: 22px;
}
.hint {
  color: #8a94a6;
  font-size: 13px;
  margin-top: 6px;
}
.btn {
  border: none;
  cursor: pointer;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 18px;
}
.btn.sm {
  padding: 6px 12px;
  font-size: 13px;
  border-radius: 8px;
}
.btn.primary {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.btn.primary:hover:not(:disabled) {
  filter: brightness(1.06);
}
.btn.ghost {
  background: #fff;
  color: #4f46e5;
  border: 1px solid #c7d0f4;
}
.btn.danger {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.error {
  color: #dc2626;
  font-size: 13px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 10px 12px;
}
.state {
  text-align: center;
  color: #8a94a6;
  font-size: 14px;
  padding: 40px 0;
}
.empty-emoji {
  font-size: 40px;
  margin-bottom: 10px;
}
.state.empty {
  background: #fff;
  border-radius: 14px;
  padding: 44px 24px;
  box-shadow: 0 10px 30px rgba(30, 40, 80, 0.06);
}
.state.empty .btn {
  margin-top: 16px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.card {
  background: #fff;
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: 0 10px 30px rgba(30, 40, 80, 0.07);
  border: 2px solid transparent;
}
.card.current {
  border-color: #a7b4f7;
}
.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.titles h2 {
  font-size: 17px;
}
.meta {
  color: #8a94a6;
  font-size: 12px;
  margin-top: 4px;
}
.ops {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.tag {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  background: #eef0ff;
  color: #6366f1;
}
.runs {
  margin-top: 12px;
  border-top: 1px dashed #e6e8ef;
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.run {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  background: #f7f8fc;
  border-radius: 10px;
  padding: 10px 12px;
}
.run-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13px;
  color: #55627c;
}
.run-no {
  font-weight: 700;
  color: #4f46e5;
}
.run-time,
.run-tpl,
.run-count {
  font-size: 12px;
  color: #8a94a6;
}
.run-ops {
  display: flex;
  gap: 8px;
}
.none {
  margin-top: 10px;
  font-size: 13px;
  color: #b6bcc9;
}
</style>
