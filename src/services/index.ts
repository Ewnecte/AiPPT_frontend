// API 封装（对应复现计划第 9.2 节）
//
// 后端主 API 网关地址：默认直连 http://127.0.0.1:6800。
// 说明：
//  1. 后端各服务均开启了 CORS(allow_origins="*")，前端可跨域直连，无需经过任何代理。
//  2. 若希望改走 vite 代理（同源 /api），启动时设置环境变量即可：
//        VITE_API_BASE=/api   npm run dev
//  3. 若后端跑在其它机器/端口：
//        VITE_API_BASE=http://<host>:<port>   npm run dev
// 业务逻辑全部在后端执行：前端只负责把输入交给后端、流式接收后端结果。
import type { SlideSchema, TemplateInfo } from '../types/AIPPT'

// 去掉尾部斜杠，便于拼接
const API_BASE = String(import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:6800').replace(/\/+$/, '')

/** 把后端返回的“接口路径”拼成完整 URL（兼容相对 /api 与绝对地址两种模式）。 */
function toUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  // 相对模式（如 /api/...）直接原样返回，交给同源服务器/代理处理
  if (/^https?:\/\//.test(API_BASE)) return `${API_BASE}${p}`
  return p
}

/**
 * 把 /templates 返回的封面相对路径（/api/data/xxx.svg）转成可访问 URL。
 * 直连后端时去掉 /api 前缀；相对代理模式下原样保留。
 */
function toAssetUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  if (/^https?:\/\//.test(API_BASE)) {
    return path.replace(/^\/api/, `${API_BASE}`)
  }
  return path
}

/** 获取模板列表 */
export async function getTemplates(): Promise<TemplateInfo[]> {
  const res = await fetch(toUrl('/templates'))
  if (!res.ok) throw new Error('获取模板失败')
  const data = await res.json()
  const items: TemplateInfo[] = data.data ?? []
  return items.map((t) => ({ ...t, cover: t.cover ? toAssetUrl(t.cover) : t.cover }))
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
  const res = await fetch(toUrl(`/files/${userId}`))
  if (!res.ok) throw new Error('获取文件列表失败')
  const data = await res.json()
  return Array.isArray(data.files) ? data.files : []
}

/** 从失败的 fetch 响应中尽量提取后端错误文案（兼容 {"error": "..."} / {"detail": "..."}）。 */
async function errMessage(res: Response, fallback: string): Promise<Error> {
  try {
    const data = await res.json()
    const msg =
      typeof data?.error === 'string'
        ? data.error
        : typeof data?.detail === 'string'
          ? data.detail
          : ''
    if (msg) return new Error(msg)
  } catch {
    // 非 JSON 响应体，忽略
  }
  return new Error(fallback)
}

/** 生成本次入库会话的唯一 fileId（后端按 userId + fileId 入库 / 检索）。 */
export function nextKbFileId(): string {
  return `file_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** personaldb /upload/ 的入库结果（chunks=0 表示未能解析出可向量化文本）。 */
export interface KbUploadResult {
  file_id: string
  file_name: string
  file_type: string
  chunks: number
  markdown_content: string
}

/**
 * 上传本地文件入库知识库（POST /files/upload，main_api 透传 personaldb /upload/）。
 * 成功后文件会进入个人知识库（分块 + 向量化 + 完整 Markdown 落盘）。
 */
export async function uploadKbFile(
  file: File,
  options: { userId?: string; fileId?: string } = {},
): Promise<KbUploadResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('userId', options.userId ?? '1')
  form.append('fileId', options.fileId ?? nextKbFileId())
  const res = await fetch(toUrl('/files/upload'), { method: 'POST', body: form })
  if (!res.ok) throw await errMessage(res, `上传失败(${res.status})`)
  return (await res.json()) as KbUploadResult
}

/** 通过 URL 入库知识库（需后端可解析的网页 / 文档直链）。 */
export async function uploadKbUrl(
  url: string,
  options: { userId?: string; fileId?: string } = {},
): Promise<KbUploadResult> {
  if (!/^https?:\/\//i.test(url)) throw new Error('链接需以 http(s):// 开头')
  const form = new FormData()
  form.append('url', url)
  form.append('userId', options.userId ?? '1')
  form.append('fileId', options.fileId ?? nextKbFileId())
  const res = await fetch(toUrl('/files/upload'), { method: 'POST', body: form })
  if (!res.ok) throw await errMessage(res, `链接入库失败(${res.status})`)
  return (await res.json()) as KbUploadResult
}

/** 读取某用户某文件的完整 Markdown 内容（用于预览 / 内容展示）。 */
export async function getKbFileMarkdown(userId: string, fileId: string): Promise<string> {
  const res = await fetch(toUrl(`/file/${userId}/${fileId}`))
  if (!res.ok) throw await errMessage(res, '获取文件内容失败')
  const data = await res.json()
  return typeof data?.markdown_content === 'string' ? data.markdown_content : ''
}

/** 删除某用户下某文件（Chroma 分块 + 完整原文一并删除）。 */
export async function deleteKbFile(userId: string, fileId: string): Promise<void> {
  const res = await fetch(toUrl(`/file/${userId}/${fileId}`), { method: 'DELETE' })
  if (!res.ok) throw await errMessage(res, `删除失败(${res.status})`)
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
  const res = await fetch(toUrl('/tools/aippt_outline'), {
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
 * model：显式指定生成模型（与后端 env 的 PPT_WRITER_MODEL 一致时最省事；
 *       传了即以它为准，与「大纲生成」保持同一个模型配置）
 */
export async function AIPPT_Content(
  markdown: string,
  options: {
    language?: string
    generateFromWebSearch?: boolean
    generateFromUploadedFile?: boolean
    model?: string
  } = {},
  onSlide: (slide: SlideSchema) => void,
): Promise<void> {
  const res = await fetch(toUrl('/tools/aippt'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      content: markdown,
      language: options.language ?? 'zh',
      generateFromWebSearch: options.generateFromWebSearch ?? false,
      generateFromUploadedFile: options.generateFromUploadedFile ?? false,
      ...(options.model ? { model: options.model } : {}),
    }),
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
    model?: string
    signal?: AbortSignal
  } = {},
  handlers: StreamHandlers,
): Promise<void> {
  const res = await fetch(toUrl('/tools/aippt'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      content: markdown,
      language: options.language ?? 'zh',
      generateFromWebSearch: options.generateFromWebSearch ?? false,
      generateFromUploadedFile: options.generateFromUploadedFile ?? false,
      ...(options.model ? { model: options.model } : {}),
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
  const res = await fetch(toUrl('/tools/aippt_outline_from_file'), { method: 'POST', body: form })
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
 *  对应后端网关 POST /tools/aippt_by_id。model 可显式指定生成模型。 */
export async function AIPPTByID(
  fileId: string,
  options: { userId?: string; generateFromWebSearch?: boolean; model?: string } = {},
  onSlide: (slide: SlideSchema) => void,
): Promise<void> {
  const res = await fetch(toUrl('/tools/aippt_by_id'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      fileId,
      userId: options.userId ?? '1',
      generateFromWebSearch: options.generateFromWebSearch ?? false,
      ...(options.model ? { model: options.model } : {}),
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

/** 拉取某套模板的完整 JSON（main_api /data/{id}.json），含 theme 主题色/字体等。 */
export interface TemplateTheme {
  name?: string
  themeColors?: string[]
  fontColor?: string
  fontName?: string
  backgroundColor?: string
}
export interface TemplateDeckData {
  name?: string
  title?: string
  theme?: TemplateTheme
}
export async function getTemplateData(id: string): Promise<TemplateDeckData> {
  const res = await fetch(toUrl(`/data/${encodeURIComponent(id)}.json`))
  if (!res.ok) throw new Error('模板数据获取失败')
  return (await res.json()) as TemplateDeckData
}
