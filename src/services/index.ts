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
