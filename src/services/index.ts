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
 */
export async function AIPPT_Content(
  markdown: string,
  options: { language?: string; generateFromWebSearch?: boolean; generateFromUploadedFile?: boolean } = {},
  onSlide: (slide: SlideSchema) => void,
): Promise<void> {
  const res = await fetch(toUrl('/tools/aippt'), {
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
 *  对应后端网关 POST /tools/aippt_by_id。 */
export async function AIPPTByID(
  fileId: string,
  options: { userId?: string; generateFromWebSearch?: boolean } = {},
  onSlide: (slide: SlideSchema) => void,
): Promise<void> {
  const res = await fetch(toUrl('/tools/aippt_by_id'), {
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
