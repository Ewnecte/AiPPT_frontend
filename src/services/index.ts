// API 封装（对应复现计划第 9.2 节）
// 所有请求走 /api 前缀，由 vite 代理到 http://127.0.0.1:6800（后端主 API 网关）。
// 业务逻辑全部在后端执行：前端只负责把输入交给后端、流式接收后端结果。
import type { SlideSchema, TemplateInfo } from '../types/AIPPT'

const BASE = '/api'

/** 获取模板列表 */
export async function getTemplates(): Promise<TemplateInfo[]> {
  const res = await fetch(`${BASE}/templates`)
  if (!res.ok) throw new Error('获取模板失败')
  const data = await res.json()
  return data.data ?? []
}

/** 知识库文件信息（GET /files/{user_id}，透传 personaldb） */
export interface KbFileInfo {
  file_id: string
  file_name: string
  file_type: string
  folder_id?: string
  url?: string
}

/** 获取某用户已入库的知识库文件列表 */
export async function getFiles(userId = '1'): Promise<KbFileInfo[]> {
  const res = await fetch(`${BASE}/files/${userId}`)
  if (!res.ok) throw new Error('获取文件列表失败')
  const data = await res.json()
  return Array.isArray(data.files) ? data.files : []
}

/** 消费一段 SSE 响应：按行解析 `data: <payload>`，遇到 `data: [DONE]` 即止。 */
async function consumeSSE(res: Response, onData: (payload: string) => void): Promise<void> {
  if (!res.body) throw new Error('响应无流')
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
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return
      onData(payload)
    }
  }
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
  if (!res.ok) throw new Error('大纲生成请求失败')
  const reader = res.body!.getReader()
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
  if (!res.ok) throw new Error('内容生成请求失败')
  await consumeSSE(res, (payload) => {
    try {
      onSlide(JSON.parse(payload) as SlideSchema)
    } catch {
      // 忽略无法解析的行
    }
  })
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

/** 依据上传文件生成大纲（multipart/form-data）。userId/fileId 由前端生成并随表单提交，
 *  使后端把同一份文件按 (userId, fileId) 存入知识库，供后续 /tools/aippt_by_id 检索生成。 */
export async function AIPPT_Outline_From_File(
  file: File,
  options: { userId?: string; fileId?: string; language?: string } = {},
  onChunk: (text: string) => void,
): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  if (options.userId) form.append('userId', options.userId)
  if (options.fileId) form.append('fileId', options.fileId)
  if (options.language) form.append('language', options.language)
  const res = await fetch(`${BASE}/tools/aippt_outline_from_file`, { method: 'POST', body: form })
  if (!res.ok) throw new Error('文件大纲请求失败')
  const reader = res.body!.getReader()
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

/** 按文件 id 生成 PPT（SSE）：后端从知识库取回该文件文档，走检索增强生成。
 *  对应后端网关 POST /tools/aippt_by_id。 */
export async function AIPPTByID(
  fileId: string,
  options: { userId?: string; generateFromWebSearch?: boolean } = {},
  onSlide: (slide: SlideSchema) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/tools/aippt_by_id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      fileId,
      userId: options.userId ?? '1',
      generateFromWebSearch: options.generateFromWebSearch ?? false,
    }),
  })
  if (!res.ok) throw new Error('文档内容生成请求失败')
  await consumeSSE(res, (payload) => {
    try {
      onSlide(JSON.parse(payload) as SlideSchema)
    } catch {
      // 忽略无法解析的行
    }
  })
}
