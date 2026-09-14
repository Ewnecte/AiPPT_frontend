// 会话（生成记录）存储：把「一次从大纲到 PPT 的生成」归档为一个会话
// ------------------------------------------------------------------
// 数据分层：
//  - localStorage：仅记录“当前正在编辑的会话 id”（aippt.session.active），跨刷新记住；
//  - IndexedDB   ：保存会话正文（大纲 + 每版生成结果 SlideSchema[]），可长期保存大文件。
// 一个会话里的「每次 PPT 生成完成」追加一个 run（历史版本），会话内可回看/重新打开任意一版。
import { defineStore } from 'pinia'
import type { SlideSchema } from '../types/AIPPT'
import { uid } from '../utils/aippt'

const LS_ACTIVE = 'aippt.session.active'
const DB_NAME = 'aippt-sessions'
const DB_STORE = 'docs'

// ------------------------------------------------------------------ 类型
/** 会话来源：none=纯文本 / web=联网 / file=上传资料 / kb=知识库 */
export type KbSource = 'none' | 'web' | 'file' | 'kb'
/** 会话进行到哪一步（用于列表提示与“是否可续写”判断） */
export type SessionStep = 'outline' | 'template' | 'done'

export interface SessionRun {
  id: string
  createdAt: number
  templateId: string
  templateName?: string
  kbSource: KbSource
  outline: string
  slides: SlideSchema[]
}

export interface SessionDoc {
  id: string
  title: string // 会话标题（主题 / 大纲一级标题 / 文件名）
  topic: string // 录入的主题文本
  createdAt: number
  updatedAt: number
  step: SessionStep
  source: 'text' | 'file' // 录入来源（上传文件 or 文本）
  language: string
  model: string
  fileId: string
  fileName: string
  templateId: string
  templateName?: string
  kbSource: KbSource
  outline: string // 最新大纲 markdown
  runs: SessionRun[] // 每版 PPT 生成结果（历史记录）
}

export interface SessionCtxPatch {
  topic?: string
  title?: string
  source?: 'text' | 'file'
  language?: string
  model?: string
  fileId?: string
  fileName?: string
  templateId?: string
  templateName?: string
  kbSource?: KbSource
  outline?: string
}

// ------------------------------------------------------------------ IndexedDB
let _dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        _dbPromise = null
        reject(req.error)
      }
    })
  }
  return _dbPromise
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(DB_STORE, mode)
    const req = fn(t.objectStore(DB_STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    t.oncomplete = () => db.close()
    t.onerror = () => reject(t.error)
  })
}

export async function loadSession(id: string): Promise<SessionDoc | null> {
  return (await tx('readonly', (s) => s.get(id))) as SessionDoc | null
}

export async function saveSession(doc: SessionDoc): Promise<void> {
  await tx('readwrite', (s) => s.put(doc))
}

export async function deleteSession(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}

export async function listSessions(): Promise<SessionDoc[]> {
  return (await tx('readonly', (s) => s.getAll())) as SessionDoc[]
}

// ------------------------------------------------------------------ 会话 id
function readActive(): string {
  try {
    return localStorage.getItem(LS_ACTIVE) ?? ''
  } catch {
    return ''
  }
}
function writeActive(id: string) {
  try {
    if (id) localStorage.setItem(LS_ACTIVE, id)
    else localStorage.removeItem(LS_ACTIVE)
  } catch {
    /* noop */
  }
}

function emptyDoc(id: string): SessionDoc {
  const now = Date.now()
  return {
    id,
    title: '未命名会话',
    topic: '',
    createdAt: now,
    updatedAt: now,
    step: 'outline',
    source: 'text',
    language: '中文',
    model: 'deepseek-chat',
    fileId: '',
    fileName: '',
    templateId: '',
    kbSource: 'none',
    outline: '',
    runs: [],
  }
}

function firstHeading(md: string): string {
  const m = /^#\s+(.+)$/m.exec(md.trim())
  return m ? m[1].trim() : ''
}

export const useSessionsStore = defineStore('sessions', {
  state: () => ({
    activeId: readActive(),
    revision: 0, // 每次归档/删除 +1，侧边栏据此刷新列表
  }),
  actions: {
    setActive(id: string) {
      this.activeId = id
      writeActive(id)
    },
    /** 新建一个空会话并切换过去（返回新 id）。 */
    newSession(): string {
      const id = uid()
      this.setActive(id)
      return id
    },
    clearActive() {
      this.activeId = ''
      writeActive('')
    },

    /**
     * 流程检查点：把当前步骤的产物写入“活动会话”。
     * 规则：无活动会话或上一次已完成(done)时自动开新会话，避免覆盖历史；
     *       outline 发生变化视为开启新版（清空旧模板选择），templateId 变化仅推进 step。
     */
    async checkpoint(patch: SessionCtxPatch): Promise<string> {
      let doc: SessionDoc | null = this.activeId ? await loadSession(this.activeId) : null
      // 大纲变化才算“新一次生成”：上一次已完成时开新会话；
      // 仅换模板/来源则继续沿用当前会话（生成时会在会话里追加新版本）。
      if (doc && doc.step === 'done' && patch.outline !== undefined) {
        doc = null
      }
      if (!doc) {
        // 复用「新建会话」预留的 activeId；没有则新生成
        const id = this.activeId || uid()
        doc = emptyDoc(id)
        this.setActive(id)
      }

      const patchOutline = patch.outline !== undefined
      if (patchOutline) {
        // 大纲更新 = 开启新版：模板选择与旧版结果作废
        doc.outline = patch.outline ?? ''
        doc.step = 'outline'
        doc.templateId = ''
        doc.templateName = ''
        doc.runs = []
        if (patch.title !== undefined) doc.title = patch.title
      }
      if (patch.topic !== undefined) doc.topic = patch.topic
      if (patch.source !== undefined) doc.source = patch.source
      if (patch.language !== undefined) doc.language = patch.language
      if (patch.model !== undefined) doc.model = patch.model
      if (patch.fileId !== undefined) doc.fileId = patch.fileId
      if (patch.fileName !== undefined) doc.fileName = patch.fileName
      if (patch.templateId !== undefined) {
        doc.templateId = patch.templateId
        doc.templateName = patch.templateName ?? doc.templateName
        if (doc.step !== 'done') doc.step = 'template'
      }
      if (patch.kbSource !== undefined) doc.kbSource = patch.kbSource
      if (!doc.title || doc.title === '未命名会话') {
        doc.title =
          firstHeading(doc.outline) || doc.topic.trim() || doc.fileName || '未命名会话'
      }
      doc.updatedAt = Date.now()
      await saveSession(doc)
      this.revision++
      return doc.id
    },

    /** PPT 生成完成：在活动会话里追加一个“生成版本（run）”。 */
    async addRun(meta: {
      topic?: string
      title?: string
      source?: 'text' | 'file'
      language?: string
      model?: string
      fileId?: string
      fileName?: string
      templateId?: string
      templateName?: string
      kbSource?: KbSource
      outline: string
      slides: SlideSchema[]
    }): Promise<string> {
      let doc: SessionDoc | null = this.activeId ? await loadSession(this.activeId) : null
      const run: SessionRun = {
        id: uid(),
        createdAt: Date.now(),
        templateId: meta.templateId ?? doc?.templateId ?? '',
        templateName: meta.templateName ?? doc?.templateName,
        kbSource: meta.kbSource ?? doc?.kbSource ?? 'none',
        outline: meta.outline || doc?.outline || '',
        slides: meta.slides,
      }
      if (!doc) {
        const id = this.activeId || uid()
        doc = emptyDoc(id)
        this.setActive(id)
      }
      // 通用字段回填（历史记录需要：语言/模型/来源/文件）
      if (meta.topic !== undefined) doc.topic = meta.topic
      if (meta.source !== undefined) doc.source = meta.source
      if (meta.language !== undefined) doc.language = meta.language
      if (meta.model !== undefined) doc.model = meta.model
      if (meta.fileId !== undefined) doc.fileId = meta.fileId
      if (meta.fileName !== undefined) doc.fileName = meta.fileName
      if (meta.templateId !== undefined) {
        doc.templateId = meta.templateId
        doc.templateName = meta.templateName ?? doc.templateName
      }
      if (meta.kbSource !== undefined) doc.kbSource = meta.kbSource
      if (meta.outline) doc.outline = meta.outline
      doc.runs.push(run)
      doc.step = 'done'
      doc.updatedAt = run.createdAt
      if (meta.title !== undefined) doc.title = meta.title
      if (!doc.title || doc.title === '未命名会话') {
        doc.title = firstHeading(doc.outline) || doc.topic.trim() || doc.fileName || '未命名会话'
      }
      await saveSession(doc)
      this.revision++
      return doc.id
    },

    /** 删除一个会话（含全部生成版本）。 */
    async remove(id: string): Promise<void> {
      await deleteSession(id)
      if (this.activeId === id) this.clearActive()
      this.revision++
    },
  },
})
