// AIPPT 排版引擎
// ------------------------------------------------------------------
// SlideSchema（生成契约） -> 1920×1080 坐标系里的可定位元素(EditorSlide)
// 元素文本通过 `ref` 字段与 SlideSchema 双向同步，可随时还原为 SlideSchema。
import type {
  ChartItem,
  ContentItem,
  SlideData,
  SlideSchema,
  SlideType,
} from '../types/AIPPT'
import type {
  ChartEl,
  EditorSlide,
  RectEl,
  SlideBackground,
  SlideElement,
  TextEl,
} from '../types/editor'
import { SLIDE_W, SLIDE_H } from '../types/editor'

export const SLIDE_TYPE_LABELS: Record<SlideType, string> = {
  cover: '封面',
  contents: '目录',
  transition: '过渡',
  content: '内容',
  reference: '引用',
  end: '结束',
}

export const SLIDE_TYPES: SlideType[] = [
  'cover',
  'contents',
  'transition',
  'content',
  'reference',
  'end',
]

/** 一套可用的版式主色（与品牌紫蓝一致的家族） */
export const ACCENTS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#0ea5e9', '#14b8a6', '#10b981', '#f59e0b', '#ef4444',
]

export function accentAt(i: number): string {
  return ACCENTS[((i % ACCENTS.length) + ACCENTS.length) % ACCENTS.length]
}

// ------------------------------------------------------------------
// 模板主题（用于生成页实时预览 + 编辑器成稿，统一走这里）
// ------------------------------------------------------------------
/** 模板主题：来自后端 template_*.json 的 theme 节点 + 各类页面背景色采样 */
export interface DeckTheme {
  name?: string
  themeColors?: string[]
  backgroundColor?: string
  fontColor?: string
  fontName?: string
  /** 模板 deck 里各类页面的背景色（solid hex，按 type 采样） */
  backgrounds?: Partial<Record<SlideType, string>>
}

function hexToRgb(hex: string): [number, number, number] | null {
  let h = String(hex).trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${((c(r) << 16) | (c(g) << 8) | c(b)).toString(16).padStart(6, '0')}`
}

/** 把颜色按比例往 target 混合（t=0 保持原色，t=1 变成 target） */
export function mixColor(hex: string, target: string, t: number): string {
  const a = hexToRgb(hex)
  const b = hexToRgb(target)
  if (!a || !b) return hex
  return rgbToHex(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  )
}

/** 感知亮度 0-1，用于判断深浅底并决定文字颜色 */
export function luminance(hex: string): number {
  const c = hexToRgb(hex)
  if (!c) return 1
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
}

function themeColors(theme?: DeckTheme | null): string[] {
  return (theme?.themeColors || []).filter((c) => hexToRgb(c) !== null)
}

/** 每页强调色：有模板则按模板 themeColors 循环，否则用内置色板 */
export function themeAccentAt(theme: DeckTheme | null | undefined, i: number): string {
  const colors = themeColors(theme)
  if (!colors.length) return accentAt(i)
  return colors[i % colors.length]
}

/** 有模板时按模板主色生成各类页面的背景（无模板返回 null，回落内置背景） */
export function themeBackgroundFor(
  type: SlideType,
  theme?: DeckTheme | null,
): SlideBackground | null {
  const colors = themeColors(theme)
  if (!colors.length) return null
  const c0 = theme?.backgrounds?.cover || colors[0]
  const c1 = theme?.backgrounds?.end || colors[1] || colors[0]
  const page = theme?.backgroundColor || '#ffffff'

  switch (type) {
    case 'cover':
      return { css: `linear-gradient(135deg, ${c0} 0%, ${c1} 100%)`, dark: luminance(c0) < 0.6 }
    case 'end':
      return { css: `linear-gradient(135deg, ${mixColor(c0, '#000000', 0.35)} 0%, ${c0} 120%)`, dark: true }
    case 'transition':
      // 过渡页保持深底（白字可读），用模板主/次色压暗
      return {
        css: `linear-gradient(150deg, ${mixColor(c0, '#000000', 0.55)} 0%, ${mixColor(c1, '#000000', 0.45)} 120%)`,
        dark: true,
      }
    case 'reference':
      return { css: `linear-gradient(170deg, ${page}, ${mixColor(c1, '#ffffff', 0.9)})`, dark: false }
    default:
      // 内容/目录页：模板底色 + 极淡主色染
      return { css: `linear-gradient(165deg, ${page}, ${mixColor(c0, '#ffffff', 0.88)})`, dark: luminance(page) < 0.5 }
  }
}

let _k = 0
export function uid(): string {
  const c = typeof crypto !== 'undefined' && crypto.randomUUID
  return c ? crypto.randomUUID().replace(/-/g, '').slice(0, 10) : `e${Date.now().toString(36)}${(_k++).toString(36)}`
}

export function cloneSchema(s: SlideSchema): SlideSchema {
  return JSON.parse(JSON.stringify(s)) as SlideSchema
}

export function cloneSlide(es: EditorSlide): EditorSlide {
  return JSON.parse(JSON.stringify(es)) as EditorSlide
}

// ------------------------------------------------------------------
// 页面背景预设
// ------------------------------------------------------------------
const DARK_COVER =
  'radial-gradient(1100px 520px at 82% -6%, rgba(255,255,255,.22), rgba(255,255,255,0) 60%), radial-gradient(900px 620px at -6% 108%, rgba(45,212,191,.30), rgba(0,0,0,0) 55%), linear-gradient(135deg, #4338ca 0%, #6d28d9 55%, #9d174d 135%)'
const DARK_TRANS =
  'radial-gradient(1000px 500px at 88% -10%, rgba(255,255,255,.20), rgba(255,255,255,0) 55%), linear-gradient(150deg, #312e81 0%, #4c1d95 60%, #6b21a8 120%)'
const DARK_END =
  'radial-gradient(900px 460px at 50% -4%, rgba(255,255,255,.18), rgba(255,255,255,0) 55%), linear-gradient(135deg, #312e81 0%, #5b21b6 100%)'
const LIGHT =
  'radial-gradient(760px 420px at 96% 0%, rgba(124,58,237,.10), rgba(124,58,237,0) 60%), radial-gradient(680px 420px at 0% 100%, rgba(59,130,246,.12), rgba(59,130,246,0) 55%), linear-gradient(165deg, #ffffff, #f6f5ff)'
const LIGHT2 =
  'radial-gradient(700px 380px at 100% 0%, rgba(236,72,153,.08), rgba(236,72,153,0) 60%), linear-gradient(170deg, #ffffff, #f4f7ff)'

export function backgroundFor(type: SlideType): SlideBackground {
  switch (type) {
    case 'cover':
      return { css: DARK_COVER, dark: true }
    case 'contents':
      return { css: LIGHT, dark: false }
    case 'transition':
      return { css: DARK_TRANS, dark: true }
    case 'content':
      return { css: LIGHT, dark: false }
    case 'reference':
      return { css: LIGHT2, dark: false }
    default:
      return { css: DARK_END, dark: true }
  }
}

/** 编辑器里可切换的背景预设 */
export const BACKGROUND_PRESETS: { label: string; bg: SlideBackground }[] = [
  { label: '深蓝紫', bg: { css: DARK_COVER, dark: true } },
  { label: '深紫章节', bg: { css: DARK_TRANS, dark: true } },
  { label: '深紫结束', bg: { css: DARK_END, dark: true } },
  { label: '亮紫罗兰', bg: { css: LIGHT, dark: false } },
  { label: '亮白粉紫', bg: { css: LIGHT2, dark: false } },
]

// ------------------------------------------------------------------
// 元素工厂
// ------------------------------------------------------------------
function mkText(p: Partial<TextEl> & { id?: string }): TextEl {
  return {
    id: p.id || uid(),
    type: 'text',
    left: 0,
    top: 0,
    width: 400,
    height: 120,
    text: '',
    fontSize: 28,
    color: '#1f2340',
    align: 'left',
    valign: 'top',
    lineHeight: 1.4,
    ...p,
  } as TextEl
}

function mkRect(p: Partial<RectEl> & { id?: string }): RectEl {
  return {
    id: p.id || uid(),
    type: 'rect',
    left: 0,
    top: 0,
    width: 100,
    height: 40,
    bg: '#6366f1',
    radius: 8,
    ...p,
  } as RectEl
}

function mkChart(p: Partial<ChartEl> & { id?: string }): ChartEl {
  return {
    id: p.id || uid(),
    type: 'chart',
    left: 0,
    top: 0,
    width: 800,
    height: 400,
    chart: { kind: 'chart', title: '', text: '', chartType: 'bar', labels: [], series: [] },
    ...p,
  } as ChartEl
}

// ------------------------------------------------------------------
// ref 读写：把元素文本同步到 SlideSchema
// ------------------------------------------------------------------
export function getSchemaText(schema: SlideSchema, ref?: string): string {
  if (!ref || !schema.data) return ''
  const d = schema.data
  const getItem = (idx: number): ContentItem | string | undefined => {
    const items = d.items as (ContentItem | string)[] | undefined
    return items ? items[idx] : undefined
  }
  if (ref === 'title') return typeof d.title === 'string' ? d.title : ''
  if (ref === 'text') return typeof d.text === 'string' ? d.text : ''
  const m = /^items\.(\d+)(\.(title|text))?$/.exec(ref)
  if (m) {
    const it = getItem(Number(m[1]))
    if (it === undefined) return ''
    if (typeof it === 'string') return m[3] === 'title' ? it : ''
    return m[3] === 'title' ? (it.title ?? '') : (it.text ?? '')
  }
  const r = /^references\.(\d+)$/.exec(ref)
  if (r) {
    const refs = d.references as string[] | undefined
    return refs ? (refs[Number(r[1])] ?? '') : ''
  }
  return ''
}

export function setSchemaText(schema: SlideSchema, ref: string, value: string): void {
  if (!schema.data) schema.data = {}
  const d = schema.data
  if (ref === 'title') {
    d.title = value
    return
  }
  if (ref === 'text') {
    d.text = value
    return
  }
  const m = /^items\.(\d+)(\.(title|text))?$/.exec(ref)
  if (m) {
    if (!d.items) d.items = []
    const idx = Number(m[1])
    const it = d.items[idx] as ContentItem | string | undefined
    if (m[3]) {
      const obj: ContentItem = typeof it === 'string' || !it ? { title: typeof it === 'string' ? it : '', text: '' } : it
      if (m[3] === 'title') obj.title = value
      else obj.text = value
      d.items[idx] = obj
    } else {
      d.items[idx] = value
    }
    return
  }
  const r = /^references\.(\d+)$/.exec(ref)
  if (r) {
    if (!d.references) d.references = []
    d.references[Number(r[1])] = value
  }
}

/** 供元素文字改动时同步回 schema（decorative/rect/chart 忽略） */
export function syncElementToSchema(schema: SlideSchema, el: SlideElement): void {
  if (el.type === 'text' && el.ref && !el.decorative) {
    setSchemaText(schema, el.ref, el.text)
  }
}

// ------------------------------------------------------------------
// 空 schema / 空白页
// ------------------------------------------------------------------
export function blankSchemaFor(type: SlideType): SlideSchema {
  switch (type) {
    case 'cover':
      return { type: 'cover', data: { title: '主标题', text: '副标题（双击右侧面板修改文字）' } }
    case 'contents':
      return { type: 'contents', data: { items: ['目录项 1', '目录项 2', '目录项 3'] } }
    case 'transition':
      return { type: 'transition', data: { title: '章节标题', text: '' } }
    case 'content':
      return {
        type: 'content',
        data: {
          title: '内容页标题',
          items: [
            { title: '要点一', text: '在这里输入正文…' },
            { title: '要点二', text: '在这里输入正文…' },
          ],
        },
      }
    case 'reference':
      return { type: 'reference', data: { title: '参考资料', references: ['1. 参考文献一', '2. 参考文献二'] } }
    default:
      return { type: 'end', data: {} }
  }
}

export function createBlankSlide(
  type: SlideType,
  opts?: { accent?: string; theme?: DeckTheme | null },
): EditorSlide {
  const schema = blankSchemaFor(type)
  return schemaToSlide(schema, opts)
}

// ------------------------------------------------------------------
// 排版引擎：SlideSchema -> 元素
// ------------------------------------------------------------------
export interface LayoutCtx {
  accent?: string
  /** 该过渡页在全篇中是第几个过渡页(从 0 计)，用于显示章节号 */
  transitionIndex?: number
  /** 模板主题：提供时背景/强调色按模板走（生成页预览与编辑器成稿一致） */
  theme?: DeckTheme | null
}

/** 深/浅底页面上的前景色组（模板换色后按底色自动切黑/白，保证可读） */
export interface SlideForeground {
  text: string
  sub: string
  faint: string
  watermark: string
}
const FG_ON_DARK: SlideForeground = {
  text: '#ffffff',
  sub: 'rgba(255,255,255,.85)',
  faint: 'rgba(255,255,255,.72)',
  watermark: 'rgba(255,255,255,.12)',
}
const FG_ON_LIGHT: SlideForeground = {
  text: '#1f2340',
  sub: 'rgba(31,35,64,.78)',
  faint: 'rgba(31,35,64,.6)',
  watermark: 'rgba(31,35,64,.08)',
}
function foregroundFor(bg: SlideBackground): SlideForeground {
  return bg.dark ? FG_ON_DARK : FG_ON_LIGHT
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// ------------------------------------------------------------------
// 文本自适应（防重叠）：估算行数 → 缩字号 → 截断加省略号
// ------------------------------------------------------------------
function charWeight(ch: string): number {
  return ch.charCodeAt(0) > 0x2e80 ? 1 : 0.56
}
function weightedLen(text: string): number {
  let n = 0
  for (const ch of text) n += charWeight(ch)
  return n
}
function estimateLines(text: string, fontSize: number, width: number): number {
  if (!text) return 0
  const perLine = Math.max(1, width / fontSize)
  return Math.max(1, Math.ceil(weightedLen(text) / perLine))
}
function truncateToLines(text: string, fontSize: number, width: number, maxLines: number): string {
  const perLine = Math.max(1, Math.floor(width / fontSize)) * maxLines
  let n = 0
  let out = ''
  for (const ch of text) {
    n += charWeight(ch)
    if (n > perLine - 1) return `${out.replace(/\s+$/, '')}…`
    out += ch
  }
  return text
}
function pickTitleSize(text: string, width: number, sizes: number[]): number {
  for (const s of sizes) {
    if (estimateLines(text, s, width) <= 2) return s
  }
  return sizes[sizes.length - 1]
}

function coverLayout(
  schema: SlideSchema,
  accent: string,
  fg: SlideForeground = FG_ON_DARK,
): SlideElement[] {
  const d = (schema.data || {}) as SlideData
  const els: SlideElement[] = []
  // 顶部品牌角标（装饰）
  els.push(
    mkText({
      decorative: true,
      text: 'AiPPT · 智能演示',
      left: 1500, top: 52, width: 380, height: 40,
      fontSize: 22, color: fg.faint, align: 'right',
    }),
  )

  // 标题/副标题自适应：按实际高度整体居中，长标题不会压住副标题
  const width = 1600
  const title = ((d.title as string) || '演示文稿标题').trim() || '演示文稿标题'
  const subRaw = d.text ? String(d.text) : ''
  const size = pickTitleSize(title, width, [96, 80, 68, 56, 46])
  const titleH = Math.round(estimateLines(title, size, width) * size * 1.2)
  const subSize = subRaw && estimateLines(subRaw, 34, 1300) > 1 ? 28 : 34
  const subText = subRaw ? truncateToLines(subRaw, subSize, 1300, 2) : ''
  const subH = subText ? Math.round(estimateLines(subText, subSize, 1300) * subSize * 1.5) : 0
  const totalH = titleH + (subText ? subH + 64 : 0)
  const top = Math.max(300, Math.round((SLIDE_H - totalH) / 2))

  els.push(
    mkText({
      ref: 'title',
      text: title,
      left: 160, top, width, height: titleH,
      fontSize: size, fontWeight: 800, color: fg.text, align: 'center', valign: 'top',
      lineHeight: 1.15,
    }),
  )
  // 标题下装饰短线
  els.push(mkRect({ decorative: true, left: 860, top: top + titleH + 22, width: 200, height: 10, bg: accent, radius: 5 }))
  if (subText) {
    els.push(
      mkText({
        ref: 'text',
        text: subText,
        left: 310, top: top + titleH + 64, width: 1300, height: subH,
        fontSize: subSize, color: fg.sub, align: 'center', valign: 'top',
        lineHeight: 1.5,
      }),
    )
  }
  return els
}

function transitionLayout(
  schema: SlideSchema,
  accent: string,
  ctx: LayoutCtx,
  fg: SlideForeground = FG_ON_DARK,
): SlideElement[] {
  const d = (schema.data || {}) as SlideData
  const no = (ctx.transitionIndex ?? 0) + 1
  const els: SlideElement[] = []
  // 巨型水印章节号（装饰，在底层）
  els.push(
    mkText({
      decorative: true,
      text: pad2(no),
      left: 1080, top: 120, width: 720, height: 380,
      fontSize: 340, fontWeight: 800, color: fg.watermark, align: 'right',
      lineHeight: 1,
    }),
  )
  els.push(
    mkText({
      decorative: true,
      text: `PART ${pad2(no)}`,
      left: 150, top: 240, width: 500, height: 44,
      fontSize: 26, fontWeight: 700, color: accent, letterSpacing: 4, align: 'left',
    }),
  )
  els.push(mkRect({ decorative: true, left: 152, top: 306, width: 76, height: 12, bg: accent, radius: 6 }))

  const width = 1380
  const title = ((d.title as string) || '章节标题').trim() || '章节标题'
  const size = pickTitleSize(title, width, [88, 72, 60, 50, 42])
  const titleH = Math.round(estimateLines(title, size, width) * size * 1.25)
  els.push(
    mkText({
      ref: 'title',
      text: title,
      left: 150, top: 360, width, height: titleH,
      fontSize: size, fontWeight: 800, color: fg.text, align: 'left', valign: 'top',
      lineHeight: 1.2,
    }),
  )
  const subRaw = d.text ? String(d.text) : ''
  if (subRaw) {
    const subSize = estimateLines(subRaw, 30, 1260) > 1 ? 24 : 30
    const subText = truncateToLines(subRaw, subSize, 1260, 2)
    els.push(
      mkText({
        ref: 'text',
        text: subText,
        left: 154, top: 360 + titleH + 26, width: 1260,
        height: Math.round(estimateLines(subText, subSize, 1260) * subSize * 1.5),
        fontSize: subSize, color: fg.sub, align: 'left', valign: 'top',
        lineHeight: 1.5,
      }),
    )
  }
  return els
}

function contentsLayout(schema: SlideSchema, accent: string): SlideElement[] {
  const d = (schema.data || {}) as SlideData
  const items = (d.items as (ContentItem | string)[] | undefined) ?? []
  const els: SlideElement[] = []
  els.push(
    mkText({
      decorative: true,
      text: '目录',
      left: 150, top: 66, width: 320, height: 110,
      fontSize: 62, fontWeight: 800, color: '#1d2140', align: 'left', valign: 'middle',
    }),
  )
  els.push(
    mkText({
      decorative: true,
      text: 'CONTENTS',
      left: 150, top: 178, width: 360, height: 34,
      fontSize: 22, fontWeight: 700, color: accent, align: 'left', letterSpacing: 6,
    }),
  )
  els.push(mkRect({ decorative: true, left: 153, top: 226, width: 70, height: 10, bg: accent, radius: 5 }))

  if (!items.length) {
    els.push(
      mkText({
        decorative: true,
        text: '（空目录：在右侧面板增删目录项）',
        left: 300, top: 560, width: 1000, height: 80,
        fontSize: 30, color: '#9aa0b4', align: 'center',
      }),
    )
    return els
  }

  const areaL = 150
  const areaR = SLIDE_W - 150
  const y0 = 300
  const y1 = SLIDE_H - 70
  const gapX = 44
  const gapY = 34
  const MIN_ROW_H = 150 // 卡片最小高度：低于它就会压字，改为减少显示条目

  let cols = items.length <= 3 ? 1 : items.length <= 8 ? 2 : 3
  let shown: (ContentItem | string)[] = items.slice()
  let rows = Math.ceil(shown.length / cols)
  let rowH = (y1 - y0 - gapY * (rows - 1)) / rows
  while (rowH < MIN_ROW_H && shown.length > 1) {
    shown = shown.slice(0, shown.length - 1)
    cols = shown.length <= 3 ? 1 : shown.length <= 8 ? 2 : 3
    rows = Math.ceil(shown.length / cols)
    rowH = (y1 - y0 - gapY * (rows - 1)) / rows
  }

  const colW = (areaR - areaL - gapX * (cols - 1)) / cols
  shown.forEach((raw, i) => {
    const s = typeof raw === 'string' ? raw : raw?.title ?? raw?.text ?? ''
    const c = i % cols
    const r = Math.floor(i / cols)
    const x = areaL + c * (colW + gapX)
    const y = y0 + r * (rowH + gapY)
    // 卡片底
    els.push(
      mkRect({
        decorative: true,
        left: x, top: y, width: colW, height: rowH,
        bg: 'rgba(255,255,255,.78)', radius: 20, borderColor: 'rgba(99,102,241,.16)',
      }),
    )
    // 序号徽标
    els.push(
      mkText({
        decorative: true,
        text: String(i + 1),
        left: x + 30, top: y + (rowH - 66) / 2, width: 66, height: 66,
        fontSize: 40, fontWeight: 800, color: accent, align: 'center', valign: 'middle',
      }),
    )
    // 字号随卡片高度自适应；文字按可用行数截断，避免溢出压到相邻卡片
    const fontSize = rowH > 230 ? 27 : rowH > 170 ? 24 : 21
    const textW = colW - 150
    const maxLines = Math.max(1, Math.floor((rowH - 28) / (fontSize * 1.5)))
    els.push(
      mkText({
        ref: `items.${i}`,
        text: truncateToLines(s, fontSize, textW, maxLines),
        left: x + 118, top: y + 14, width: textW, height: rowH - 28,
        fontSize, color: '#2a3152', align: 'left', valign: 'middle', lineHeight: 1.5,
      }),
    )
  })
  if (shown.length < items.length) {
    els.push(
      mkText({
        decorative: true,
        text: `…… 共 ${items.length} 个目录项，已省略 ${items.length - shown.length} 个`,
        left: areaL, top: y1 + 6, width: areaR - areaL, height: 40,
        fontSize: 22, color: '#9aa0b4', align: 'right',
      }),
    )
  }
  return els
}

function contentLayout(schema: SlideSchema, accent: string): SlideElement[] {
  const d = (schema.data || {}) as SlideData
  const rawItems = (d.items as (ContentItem | string)[] | undefined) ?? []
  const blocks: { title: string; text: string; chart?: ChartItem }[] = rawItems.map((raw) => {
    if (typeof raw === 'string') return { title: raw, text: '' }
    if (raw?.kind === 'chart') {
      const c = raw as unknown as ChartItem
      return { title: c.title ?? '', text: c.text ?? '', chart: c }
    }
    return { title: raw?.title ?? '', text: raw?.text ?? '' }
  })

  const els: SlideElement[] = []

  // 页面标题：长标题自动缩字号并向下顺延，避免压到装饰线与正文
  const titleText = ((d.title as string) || '内容页标题').trim() || '内容页标题'
  const titleW = 1600
  const titleSize = pickTitleSize(titleText, titleW, [54, 46, 40, 34, 28])
  const titleH = Math.round(estimateLines(titleText, titleSize, titleW) * titleSize * 1.24)
  const areaL = 150
  const areaW = SLIDE_W - 300
  const y0 = Math.max(230, Math.round(58 + titleH + 52))
  const y1 = SLIDE_H - 60
  const gap = 28

  els.push(
    mkText({
      ref: 'title',
      text: titleText,
      left: areaL, top: 58, width: titleW, height: titleH,
      fontSize: titleSize, fontWeight: 800, color: '#1d2140', align: 'left', valign: 'top',
      lineHeight: 1.2,
    }),
  )
  els.push(mkRect({ decorative: true, left: 153, top: 58 + titleH + 14, width: 96, height: 12, bg: accent, radius: 6 }))

  if (!blocks.length) {
    els.push(
      mkText({
        decorative: true,
        text: '（空内容页：在右侧面板增删内容项）',
        left: areaL, top: 520, width: areaW, height: 80,
        fontSize: 30, color: '#9aa0b4', align: 'center',
      }),
    )
    return els
  }

  const onlyChart = blocks.length === 1 && blocks[0].chart
  if (onlyChart) {
    const c = blocks[0].chart as ChartItem
    const bx = areaL
    const by = y0 + 20
    const bw = areaW
    const bh = Math.min(640, y1 - by)
    els.push(mkRect({ decorative: true, left: bx, top: by, width: bw, height: bh, bg: 'rgba(255,255,255,.9)', radius: 22, borderColor: 'rgba(99,102,241,.16)' }))
    if (c.title) {
      els.push(mkText({ decorative: true, text: c.title, left: bx + 48, top: by + 32, width: bw - 96, height: 56, fontSize: 34, fontWeight: 700, color: '#1d2140' }))
    }
    els.push(mkChart({ decorative: true, left: bx + 60, top: by + (c.title ? 120 : 60), width: bw - 120, height: bh - (c.title ? 170 : 100), chart: c }))
    return els
  }

  // 行高保底：条目过多时按最小行高减少显示数量，而不是把卡片压扁压字
  const MIN_ROW_H = 168
  let shown = blocks.slice()
  let count = shown.length
  let rowH = (y1 - y0 - gap * (count - 1)) / count
  while (rowH < MIN_ROW_H && shown.length > 1) {
    shown = shown.slice(0, shown.length - 1)
    count = shown.length
    rowH = (y1 - y0 - gap * (count - 1)) / count
  }
  const cappedRowH = Math.min(236, rowH)

  shown.forEach((b, i) => {
    const y = y0 + i * (cappedRowH + gap)
    if (b.chart) {
      els.push(mkRect({ decorative: true, left: areaL, top: y, width: areaW, height: cappedRowH, bg: 'rgba(255,255,255,.9)', radius: 18, borderColor: 'rgba(99,102,241,.16)' }))
      els.push(mkChart({ decorative: true, left: areaL + 40, top: y + 24, width: areaW - 80, height: cappedRowH - 48, chart: b.chart }))
      return
    }
    // 序号
    els.push(
      mkText({
        decorative: true,
        text: pad2(i + 1),
        left: areaL + 36, top: y + (cappedRowH - 54) / 2, width: 54, height: 54,
        fontSize: 30, fontWeight: 800, color: accent, align: 'center', valign: 'middle',
      }),
    )
    els.push(
      mkRect({
        decorative: true,
        left: areaL, top: y, width: areaW, height: cappedRowH,
        bg: 'rgba(255,255,255,.82)', radius: 18, borderColor: 'rgba(99,102,241,.14)',
      }),
    )
    // 标题（要点）/ 正文：字号随行高自适应，并按可用行数截断
    const textW = areaW - 170
    const hasBody = !!b.text
    const titleFont = cappedRowH > 200 ? 34 : cappedRowH > 168 ? 30 : 26
    const titleH = hasBody ? Math.round(estimateLines(b.title, titleFont, textW) * titleFont * 1.3) : 0
    if (b.title) {
      els.push(
        mkText({
          ref: `items.${i}.title`,
          text: truncateToLines(b.title, titleFont, textW, hasBody ? 1 : Math.max(1, Math.floor((cappedRowH - 24) / (titleFont * 1.3)))),
          left: areaL + 118,
          top: hasBody ? y + 16 : y + (cappedRowH - 40) / 2,
          width: textW,
          height: hasBody ? titleH : 52,
          fontSize: titleFont, fontWeight: 700, color: '#232850', align: 'left',
          valign: 'top', lineHeight: 1.3,
        }),
      )
    }
    if (hasBody) {
      const bodyFont = cappedRowH > 200 ? 24 : cappedRowH > 168 ? 22 : 20
      const bodyTop = y + 16 + titleH + 10
      const bodyAvail = y + cappedRowH - 16 - bodyTop
      const maxLines = Math.max(1, Math.floor(bodyAvail / (bodyFont * 1.5)))
      els.push(
        mkText({
          ref: `items.${i}.text`,
          text: truncateToLines(b.text, bodyFont, textW, maxLines),
          left: areaL + 122, top: bodyTop, width: textW, height: Math.max(30, bodyAvail),
          fontSize: bodyFont, color: '#5c6480', align: 'left',
          valign: 'top', lineHeight: 1.5,
        }),
      )
    }
  })
  if (shown.length < blocks.length) {
    els.push(
      mkText({
        decorative: true,
        text: `…… 共 ${blocks.length} 条要点，已省略 ${blocks.length - shown.length} 条`,
        left: areaL, top: y1 + 2, width: areaW, height: 40,
        fontSize: 22, color: '#9aa0b4', align: 'right',
      }),
    )
  }
  return els
}

function referenceLayout(schema: SlideSchema, accent: string): SlideElement[] {
  const d = (schema.data || {}) as SlideData
  const refs = (d.references as string[] | undefined) ?? []
  const els: SlideElement[] = []
  els.push(
    mkText({
      ref: 'title',
      text: d.title || '参考资料',
      left: 150, top: 60, width: 1400, height: 90,
      fontSize: 56, fontWeight: 800, color: '#1d2140', align: 'left', valign: 'middle',
    }),
  )
  els.push(mkRect({ decorative: true, left: 153, top: 164, width: 96, height: 12, bg: accent, radius: 6 }))
  if (!refs.length) {
    els.push(
      mkText({
        decorative: true, text: '（空引用）', left: 300, top: 520, width: 1000, height: 80,
        fontSize: 30, color: '#9aa0b4', align: 'center',
      }),
    )
    return els
  }
  // 参考文献：定高行距排布，超长条目截断，超出数量的给出省略提示（不越界压字）
  const refFont = 26
  const rowGap = 148
  const maxRows = Math.max(1, Math.floor((SLIDE_H - 80 - 320) / rowGap) + 1)
  const shown = refs.slice(0, maxRows)
  shown.forEach((s, i) => {
    const y = 320 + i * rowGap
    els.push(
      mkText({
        decorative: true,
        text: pad2(i + 1),
        left: 200, top: y - 4, width: 56, height: 56,
        fontSize: 26, fontWeight: 800, color: accent, align: 'center', valign: 'middle',
      }),
    )
    els.push(
      mkText({
        ref: `references.${i}`,
        text: truncateToLines(s, refFont, 1420, 1),
        left: 300, top: y - 6, width: 1420, height: 90,
        fontSize: refFont, color: '#39405f', align: 'left', valign: 'top', lineHeight: 1.5,
      }),
    )
  })
  if (shown.length < refs.length) {
    els.push(
      mkText({
        decorative: true,
        text: `…… 共 ${refs.length} 条参考文献，已省略 ${refs.length - shown.length} 条`,
        left: 300, top: 320 + shown.length * rowGap + 6, width: 1420, height: 40,
        fontSize: 22, color: '#9aa0b4', align: 'left',
      }),
    )
  }
  return els
}

function endLayout(
  schema: SlideSchema,
  accent: string,
  fg: SlideForeground = FG_ON_DARK,
): SlideElement[] {
  const d = (schema.data || {}) as SlideData
  const els: SlideElement[] = []
  const title = ((d.title as string) || '感谢聆听').trim() || '感谢聆听'
  const width = 1400
  const size = pickTitleSize(title, width, [96, 80, 66, 54, 44])
  const titleH = Math.round(estimateLines(title, size, width) * size * 1.2)
  const top = Math.max(340, Math.round((SLIDE_H - titleH) / 2) - 40)
  els.push(
    mkText({
      decorative: true,
      text: title,
      left: 260, top, width, height: titleH,
      fontSize: size, fontWeight: 800, color: fg.text, align: 'center', valign: 'top',
      lineHeight: 1.15,
    }),
  )
  els.push(mkRect({ decorative: true, left: 860, top: top + titleH + 24, width: 200, height: 10, bg: accent, radius: 5 }))
  els.push(
    mkText({
      decorative: true,
      text: 'THANKS FOR WATCHING',
      left: 360, top: top + titleH + 66, width: 1200, height: 50,
      fontSize: 26, fontWeight: 700, color: fg.faint, align: 'center', letterSpacing: 8,
    }),
  )
  return els
}

export function schemaToSlide(schema: SlideSchema, opts?: LayoutCtx): EditorSlide {
  const type = schema.type
  const theme = opts?.theme ?? null
  const accent = opts?.accent ?? themeAccentAt(theme, 0)
  const background = themeBackgroundFor(type, theme) ?? backgroundFor(type)
  const fg = foregroundFor(background)
  const els: SlideElement[] = (() => {
    switch (type) {
      case 'cover':
        return coverLayout(schema, accent, fg)
      case 'contents':
        return contentsLayout(schema, accent)
      case 'transition':
        return transitionLayout(schema, accent, opts ?? {}, fg)
      case 'content':
        return contentLayout(schema, accent)
      case 'reference':
        return referenceLayout(schema, accent)
      default:
        return endLayout(schema, accent, fg)
    }
  })()
  return {
    id: uid(),
    type,
    background,
    elements: els,
    schema: cloneSchema(schema),
    accent,
  }
}

/** 整篇还原：依据已生成 SlideSchema[] 依次排版（demo / 导入用）；theme 用于套模板配色 */
export function schemasToSlides(schemas: SlideSchema[], theme?: DeckTheme | null): EditorSlide[] {
  let transitionCount = 0
  return schemas.map((s, i) => {
    const isTrans = s.type === 'transition'
    const slide = schemaToSlide(s, {
      accent: themeAccentAt(theme, i),
      transitionIndex: isTrans ? transitionCount : undefined,
      theme: theme ?? null,
    })
    if (isTrans) transitionCount += 1
    return slide
  })
}

export function slideToSchema(slide: EditorSlide): SlideSchema {
  return cloneSchema(slide.schema)
}

/** 依据元素当前文本刷新 schema 内容（导出前保险调用） */
export function syncSlideFromElements(slide: EditorSlide): void {
  const schema = slide.schema
  if (!schema.data) schema.data = {}
  for (const el of slide.elements) syncElementToSchema(schema, el)
  // 同步后为 item 数组中的对象补默认字段，避免导出缺 text
  const d = schema.data
  if (Array.isArray(d.items)) {
    d.items = d.items.map((it) => (typeof it === 'object' && it ? { title: it.title ?? '', text: it.text ?? '' } : it))
  }
}

// ------------------------------------------------------------------
// 大纲解析（用于 Demo 模式与生成页进度预估）
// ------------------------------------------------------------------
export interface OutlineSection {
  title: string
  subheads: { title: string; bullets: string[] }[]
}

export interface OutlinePlan {
  title: string
  subtitle: string
  sections: OutlineSection[]
}

export function parseOutline(markdown: string): OutlinePlan {
  const lines = markdown.split('\n').map((l) => l.trim())
  let title = ''
  let subtitle = ''
  const sections: OutlineSection[] = []
  let cur: OutlineSection | null = null
  let curSub: { title: string; bullets: string[] } | null = null

  const ensureSub = (): { title: string; bullets: string[] } => {
    if (!cur) {
      cur = { title: '', subheads: [] }
      sections.push(cur)
    }
    if (!curSub) {
      curSub = { title: '', bullets: [] }
      cur.subheads.push(curSub)
    }
    return curSub
  }

  for (const raw of lines) {
    if (!raw) continue
    const head = /^(#{1,6})\s+(.+)$/.exec(raw)
    if (head) {
      const level = head[1].length
      const body = head[2].trim()
      if (!body) continue
      if (level === 1) {
        if (!title) title = body
      } else if (level === 2) {
        cur = { title: body, subheads: [] }
        curSub = null
        sections.push(cur)
      } else {
        // ### 及以下作为当前章节下的小节
        if (!cur) {
          cur = { title: '', subheads: [] }
          sections.push(cur)
        }
        curSub = { title: body, bullets: [] }
        cur.subheads.push(curSub)
      }
      continue
    }
    if (/^[-*•]/.test(raw)) {
      const bullet = raw.replace(/^[-*•]\s*/, '').trim()
      if (!bullet) continue
      const sub = ensureSub()
      sub.bullets.push(bullet)
    } else {
      // 游离正文：无小节时当作封面副标题
      if (!cur && !subtitle) subtitle = raw
    }
  }
  if (!title && sections.length) title = sections[0].title
  if (!sections.length && title) {
    sections.push({ title, subheads: [] })
  }
  return { title: title || '未命名演示', subtitle, sections }
}

/** 估算生成页数，用于进度百分比 */
export function estimateSlideCount(md: string): number {
  const plan = parseOutline(md)
  const n = plan.sections.length
  if (!n) return 6
  return 2 + n * 2 + 1 // 封面 + 目录 + 每节(过渡+内容) + 结束
}

/** 按解析的大纲构造整套内容 Schema（Demo 数据源） */
export function schemasFromOutline(md: string): SlideSchema[] {
  const plan = parseOutline(md)
  const schemas: SlideSchema[] = []
  schemas.push({ type: 'cover', data: { title: plan.title, text: plan.subtitle || '一份由 AiPPT 智能生成的演示文稿' } })
  schemas.push({
    type: 'contents',
    data: { items: plan.sections.filter((s) => s.title).map((s) => s.title) },
  })
  if (!plan.sections.length) {
    schemas.push({ type: 'end', data: {} })
    return schemas
  }
  for (const sec of plan.sections) {
    if (sec.title) {
      schemas.push({ type: 'transition', data: { title: sec.title, text: '' } })
    }
    const items: ContentItem[] = []
    for (const sub of sec.subheads) {
      if (sub.title) {
        items.push({ title: sub.title, text: sub.bullets.join('\n') })
      } else {
        sub.bullets.forEach((b) => items.push({ title: '', text: b }))
      }
    }
    if (!sec.title && !items.length) {
      // 大纲退化：仅标题无小节，仍给一页空内容
      items.push({ title: '', text: '（该章节暂无小节要点）' })
    }
    schemas.push({ type: 'content', data: { title: sec.title || plan.title, items } })
  }
  schemas.push({ type: 'end', data: {} })
  return schemas
}

/** 演示用样例大纲 */
export const SAMPLE_OUTLINE = `# 电动汽车产业发展报告

## 市场现状与规模
### 全球销量快速增长
- 2025 年全球新能源汽车销量突破 2000 万辆
- 渗透率首次超过 25%，进入规模放量阶段
### 中国市场持续领跑
- 中国占全球市场份额六成以上
- 出口量连续三年保持全球第一

## 核心技术趋势
### 动力电池技术
- 固态电池进入量产前夜
- 能量密度正向 400Wh/kg 迈进
### 智能驾驶
- 高阶辅助驾驶渗透率快速提升
- L3 级法规在多个城市逐步落地

## 产业链竞争格局
### 整车厂商
- 新势力与传统车企加速电动化转型
- 价格竞争激烈，行业洗牌加速
### 供应链
- 电池、芯片、电机等核心环节国产化率提升

## 未来展望
### 基础设施
- 充电桩、换电站加速建设
- 车网互动（V2G）等新业态兴起
### 政策方向
- 双碳目标驱动绿色交通转型
- 鼓励技术创新与产业协同
`

export function demoDeck(): EditorSlide[] {
  return schemasToSlides(schemasFromOutline(SAMPLE_OUTLINE))
}
