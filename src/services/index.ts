// API 封装（对应复现计划第 9.2 节）
// 所有请求走 /api 前缀，由 vite 代理到 http://127.0.0.1:6800
import type { SlideSchema, TemplateInfo } from '../types/AIPPT'

const BASE = '/api'

/** 获取模板列表 */
export async function getTemplates(): Promise<TemplateInfo[]> {
  const res = await fetch(`${BASE}/templates`)
  if (!res.ok) throw new Error('获取模板失败')
  const data = await res.json()
  return data.data ?? []
}

/**
 * 大纲生成（text/plain 流式）
 * onChunk 每次收到一段文本时回调，最终返回完整大纲
 */
export async function AIPPT_Outline(
  content: string,
  language: string,
  model: string,
  onChunk: (text: string) => void,
): Promise<string> {
  const res = await fetch(`${BASE}/tools/aippt_outline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, language, model, stream: true }),
  })
  if (!res.ok || !res.body) throw new Error('大纲生成请求失败')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    full += text
    onChunk(text)
  }
  return full
}

/**
 * 逐页内容生成（SSE，末尾 data: [DONE]）
 * onSlide 每收到一页 JSON 时回调一次
 */
export async function AIPPT_Content(
  markdown: string,
  options: { language?: string; generateFromWebSearch?: boolean; generateFromUploadedFile?: boolean } = {},
  onSlide: (slide: SlideSchema) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/tools/aippt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ content: markdown, language: options.language ?? 'zh', ...options }),
  })
  if (!res.ok || !res.body) throw new Error('内容生成请求失败')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        onSlide(JSON.parse(payload) as SlideSchema)
      } catch {
        // 忽略无法解析的行
      }
    }
  }
}

/**
 * 逐页内容生成（SSE，流式事件版本）
 * 兼容两种返回风格：
 *  - 标准 SSE：`data: {payload}` 之间以空行分隔，`: ` 为心跳；
 *  - 参考实现：整行直接返回 JSON（`data:` 前缀可选）。
 * 解析时识别三类帧：状态(status/progress) -> onStatus；SlideSchema -> onSlide；[DONE] -> onDone。
 * 可通过 signal 取消。
 */
const SLIDE_TYPES_SET = new Set(['cover', 'contents', 'transition', 'content', 'reference', 'end'])

export interface StreamHandlers {
  onSlide: (slide: SlideSchema) => void
  onStatus?: (text: string) => void
  onDone?: () => void
}

export async function AIPPT_StreamEvents(
  markdown: string,
  options: {
    language?: string
    generateFromWebSearch?: boolean
    generateFromUploadedFile?: boolean
    signal?: AbortSignal
  } = {},
  handlers: StreamHandlers,
): Promise<void> {
  const res = await fetch(`${BASE}/tools/aippt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      content: markdown,
      language: options.language ?? 'zh',
      generateFromWebSearch: options.generateFromWebSearch ?? false,
      generateFromUploadedFile: options.generateFromUploadedFile ?? false,
    }),
    signal: options.signal,
  })
  if (!res.ok || !res.body) throw new Error(`内容生成请求失败(${res.status})`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')

  const emitJSON = (payload: unknown) => {
    if (Array.isArray(payload)) {
      payload.forEach((p) => emitJSON(p))
      return
    }
    if (!payload || typeof payload !== 'object') return
    const obj = payload as Record<string, unknown>
    const tp = obj.type
    const statusText = obj.status ?? obj.message ?? obj.progressText
    if (typeof tp === 'string' && (tp === 'status' || tp === 'progress')) {
      handlers.onStatus?.(typeof statusText === 'string' ? statusText : '生成中…')
      return
    }
    if (typeof tp === 'string' && SLIDE_TYPES_SET.has(tp)) {
      const slide = obj as unknown as SlideSchema
      if (!slide.data) slide.data = {}
      handlers.onSlide(slide)
      return
    }
    if (typeof statusText === 'string') {
      handlers.onStatus?.(statusText)
      return
    }
    // 其余帧忽略（如 keep-alive / meta）
  }

  let buf = ''
  let sseOpen = false
  let sseData: string[] = []
  const flushSSE = () => {
    if (!sseData.length) return
    const payload = sseData.join('\n').trim()
    sseData = []
    sseOpen = false
    if (!payload) return
    if (payload === '[DONE]') {
      handlers.onDone?.()
      return
    }
    try {
      emitJSON(JSON.parse(payload))
    } catch {
      // 忽略不完整/无法解析的行
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    const chunk = done ? '' : decoder.decode(value, { stream: true })
    if (chunk) {
      buf += chunk.replace(/\r\n/g, '\n')
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line === '') {
          flushSSE()
        } else if (line.startsWith('data:')) {
          sseOpen = true
          sseData.push(line.slice(5).trim())
        } else if (line.startsWith(':')) {
          // SSE 心跳注释行
        } else if (line.startsWith('{')) {
          flushSSE()
          try {
            emitJSON(JSON.parse(line))
          } catch {
            // 忽略
          }
        } else if (line === '[DONE]') {
          handlers.onDone?.()
        }
        // 其他行忽略
      }
    }
    if (done) {
      flushSSE()
      break
    }
  }
}

/** 依据上传文件生成大纲（multipart/form-data） */
export async function AIPPT_Outline_From_File(file: File, onChunk: (text: string) => void): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  // 传唯一 fileId，避免后端 doc_store（key = user_id_file_id）重复覆盖
  form.append('userId', '1')
  form.append('fileId', `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const res = await fetch(`${BASE}/tools/aippt_outline_from_file`, { method: 'POST', body: form })
  if (!res.ok || !res.body) throw new Error('文件大纲请求失败')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    full += text
    onChunk(text)
  }
  return full
}

/** 按文件 id 生成 PPT（走知识库检索） */
export async function AIPPTByID(fileId: string, _onSlide: (slide: SlideSchema) => void): Promise<void> {
  // TODO: 参考 AIPPT_Content 的 SSE 解析实现
  throw new Error(`TODO: 实现 AIPPTByID(fileId=${fileId})`)
}
