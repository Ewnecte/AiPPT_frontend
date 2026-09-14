// SlideSchema[] → PPTist Slide[]（版式转换器）
// ------------------------------------------------------------------
// 生成契约（外层 types/AIPPT.ts）只有粗粒度内容（type + title/text/items/references），
// 不含几何/样式。本模块把它"排版"成 PPTist 的富元素幻灯片（1000 × 562.5 坐标系），
// 进入 /editor 后由 PPTist 提供元素级二次编辑、导出与放映。
//
// 坐标系：PPTist 画布 = viewportSize(1000) × viewportSize*viewportRatio(0.5625)。
// 文本元素 content 为 HTML；PPTist 富文本可解析 <p> / <strong> / <span style="font-size/color">。
// 主题：可传入模板 theme（themeColors/背景/字体色），整份 PPT 视觉风格随之改变；
//       未传模板时回落为内置默认紫蓝风格。
import type {
  ChartItem,
  SlideData,
  SlideSchema,
} from '../types/AIPPT'
import { accentAt, uid, type DeckTheme } from './aippt'
import type {
  PPTChartElement,
  PPTElement,
  PPTShapeElement,
  PPTTextElement,
  Slide,
  SlideBackground,
  SlideType as PptistSlideType,
  TextAlignVertical,
} from '../pptist/types/slides'

export const VIEW_W = 1000
export const VIEW_H = 1000 * 0.5625 // 562.5

// ------------------------------------------------------------------
// 主题 / 调色板
// ------------------------------------------------------------------
// DeckTheme 统一在 utils/aippt.ts 定义（含模板各类页面背景色采样），这里复用并转出，
// 保证「生成页预览」与「编辑器成稿」用同一份主题数据。
export type { DeckTheme } from './aippt'

/** 排版用调色板（由模板 theme 生成，缺省回落内置默认值） */
interface Palette {
  paper: string // 浅色页背景
  ink: string // 浅底正文（标题/要点）
  sub: string // 浅底次要文字
  faint: string // 弱文字 / 页码
  coverBg: string // 封面背景
  coverText: string // 封面正文色（按底色深浅自动黑/白）
  coverSub: string // 封面副标题色
  coverBar: string // 封面装饰条
  transBg: string // 过渡页背景
  transText: string // 过渡页正文色
  transSub: string // 过渡页副标题色
  transBar: string // 过渡页装饰条
  endBg: string // 结束页背景
  endText: string // 结束页正文色
  top: string // 深页顶部色带（模板主色）
  accentFor(i: number): string // 每页主题主色（accent）
}

// 默认（无模板）时的内置紫蓝风格
const DEFAULT_PAPER = '#ffffff'
const DEFAULT_INK = '#1f2340'
const DEFAULT_COLORS = ['#6366f1', '#8b5cf6', '#0ea5e9', '#a855f7', '#f59e0b', '#14b8a6']

/** hex(#rgb/#rrggbb) → [r,g,b] 0-255；解析失败返回 null */
function hexToRgb(hex: string): [number, number, number] | null {
  let h = String(hex).trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

/** 把颜色往 target(#000/#fff 等) 混合 t(0-1)，得到新 hex */
function mixToward(hex: string, target: string, t: number): string {
  const a = hexToRgb(hex)
  const b = hexToRgb(target)
  if (!a || !b) return hex
  const [r1, g1, b1] = a
  const [r2, g2, b2] = b
  const r = clamp255(r1 + (r2 - r1) * t)
  const g = clamp255(g1 + (g2 - g1) * t)
  const bl = clamp255(b1 + (b2 - b1) * t)
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`
}

/** 感知亮度 0-1（近似），用于判断深/浅背景与文字反色 */
function luminance(hex: string): number {
  const c = hexToRgb(hex)
  if (!c) return 1
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
}

function validHex(v: unknown): v is string {
  return typeof v === 'string' && hexToRgb(v) !== null
}

function buildPalette(theme?: DeckTheme | null): Palette {
  const colors = (theme?.themeColors || []).filter(validHex)
  const c0 = colors[0] || DEFAULT_COLORS[0]
  const c1 = colors[1] || DEFAULT_COLORS[1]

  // 内容页底色：优先模板里的内容页背景；再按主色做极淡染色，让模板差异在每页都可见
  const rawPaper = validHex(theme?.backgrounds?.content)
    ? (theme!.backgrounds!.content as string)
    : validHex(theme?.backgroundColor)
      ? (theme!.backgroundColor as string)
      : DEFAULT_PAPER
  const paper = theme ? mixToward(rawPaper, c0, 0.05) : rawPaper
  const dark = luminance(paper) < 0.45
  const ink = validHex(theme?.fontColor) && !dark ? (theme!.fontColor as string) : dark ? '#ffffff' : DEFAULT_INK

  // 封面/结束：优先用模板 deck 里对应页面的真实背景色（模板主色），否则由主色派生深色
  const coverBg = validHex(theme?.backgrounds?.cover)
    ? (theme!.backgrounds!.cover as string)
    : mixToward(c0, '#0d0a24', dark ? 0.35 : 0.66)
  const endBg = validHex(theme?.backgrounds?.end)
    ? (theme!.backgrounds!.end as string)
    : mixToward(c0, '#0d0a24', dark ? 0.42 : 0.74)
  // 过渡页：模板背景若是浅色（如白底）则改用次主色压暗，保证白字可读；否则直接用
  const rawTrans = validHex(theme?.backgrounds?.transition)
    ? (theme!.backgrounds!.transition as string)
    : ''
  const transBg =
    rawTrans && luminance(rawTrans) < 0.6 ? rawTrans : mixToward(c1, '#0d0a24', 0.5)

  // 与预览端保持一致：底色偏深（含模板的饱和主色封面）用白字，浅底用模板字体色
  const fg = (bg: string) => (luminance(bg) < 0.6 ? '#ffffff' : ink)
  const subOf = (bg: string) =>
    luminance(bg) < 0.6 ? 'rgba(255,255,255,0.82)' : 'rgba(31,35,64,0.72)'
  const barOf = (bg: string) =>
    luminance(bg) < 0.6 ? mixToward(c0, '#ffffff', 0.55) : mixToward(c0, '#000000', 0.2)

  return {
    paper,
    ink,
    sub: dark ? 'rgba(255,255,255,0.75)' : '#5b6275',
    faint: dark ? 'rgba(255,255,255,0.45)' : '#9aa2b5',
    coverBg,
    coverText: fg(coverBg),
    coverSub: subOf(coverBg),
    coverBar: barOf(coverBg),
    transBg,
    transText: fg(transBg),
    transSub: subOf(transBg),
    transBar: barOf(transBg),
    endBg,
    endText: fg(endBg),
    top: c0,
    accentFor: (i) => (colors.length ? colors[i % colors.length] : accentAt(i)),
  }
}

// 把外层 SlideType 归并到 PPTist 认可的 Slide.type（reference 无对应，归入 content）
const TYPE_MAP: Record<string, PptistSlideType> = {
  cover: 'cover',
  contents: 'contents',
  transition: 'transition',
  content: 'content',
  reference: 'content',
  end: 'end',
}

// ------------------------------------------------------------------
// 小工具
// ------------------------------------------------------------------
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface PStyle {
  size?: number
  color?: string
  bold?: boolean
  align?: 'left' | 'center' | 'right'
}
/** 生成一个 <p> 段落（PPTist 富文本规范内联样式） */
function para(text: string, o: PStyle = {}): string {
  const size = o.size ?? 20
  const color = o.color ?? '#1f2340'
  const styles = [`font-size:${size}px`, `color:${color}`]
  if (o.bold) styles.push('font-weight:bold')
  const pStyle = o.align && o.align !== 'left' ? ` style="text-align:${o.align}"` : ''
  return `<p${pStyle}><span style="${styles.join('; ')}">${esc(text)}</span></p>`
}
interface TextBox {
  x: number
  y: number
  w: number
  h: number
  html: string
  valign?: TextAlignVertical
  lineHeight?: number
  paragraphSpace?: number
}
function textEl(box: TextBox, defaultColor = DEFAULT_INK): PPTTextElement {
  const el: PPTTextElement = {
    type: 'text',
    id: uid(),
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
    rotate: 0,
    defaultFontName: '',
    defaultColor,
    content: box.html,
    fixedHeight: true,
    vAlign: box.valign ?? 'top',
    inset: [0, 0, 0, 0],
  }
  if (box.lineHeight) el.lineHeight = box.lineHeight
  if (box.paragraphSpace) el.paragraphSpace = box.paragraphSpace
  return el
}

function rect({ x, y, w, h, color, opacity = 1, radius = 0 }: {
  x: number; y: number; w: number; h: number; color: string; opacity?: number; radius?: number
}): PPTShapeElement {
  // 用圆角矩形路径（避免引入 shapes 配置的 pathFormula 依赖）
  const r = Math.min(radius, w / 2, h / 2)
  const d = `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z`
  return {
    type: 'shape',
    id: uid(),
    left: x,
    top: y,
    width: w,
    height: h,
    rotate: 0,
    viewBox: [w, h],
    path: d,
    fixedRatio: false,
    fill: color,
    opacity,
  }
}

function chartColors(accent: string): string[] {
  return [accent, '#0ea5e9', '#f59e0b', '#10b981', '#ec4899']
}

function chartEl(item: ChartItem, box: { x: number; y: number; w: number; h: number }, accent: string): PPTChartElement {
  const series = (item.series || []).map((s) => s.data)
  return {
    type: 'chart',
    id: uid(),
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
    rotate: 0,
    chartType: item.chartType,
    data: {
      labels: item.labels || [],
      legends: (item.series || []).map((s) => s.name),
      series,
    },
    options: {},
    themeColors: chartColors(accent),
    textColor: '#9aa2b5',
    lineColor: '#e2e6f0',
  }
}

/** 数值补零用于目录/过渡的编号 */
function num(n: number): string {
  return String(n).padStart(2, '0')
}

// ------------------------------------------------------------------
// 文本自适应（防重叠）
// ------------------------------------------------------------------
// 思路：按「字数 × 字号 vs 可用宽度」估算行数与高度，逐级缩小字号；
// 仍放不下就截断条目并加省略提示，保证任何输入都不会互相压字。
/** 中日韩字符按 1 个字宽计，其余（英文/数字/标点）按 0.56 计 */
function charWeight(ch: string): number {
  return ch.charCodeAt(0) > 0x2e80 ? 1 : 0.56
}
function weightedLen(text: string): number {
  let n = 0
  for (const ch of text) n += charWeight(ch)
  return n
}
/** 估算文本在给定字号与宽度下的行数 */
function estimateLines(text: string, fontSize: number, width: number): number {
  if (!text) return 0
  const perLine = Math.max(1, width / fontSize)
  return Math.max(1, Math.ceil(weightedLen(text) / perLine))
}
/** 超过 maxLines 行时截断并加省略号 */
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
/** 选一个能容纳标题的字号（最多 2 行） */
function pickTitleSize(text: string, width: number, sizes: number[]): number {
  for (const s of sizes) {
    if (estimateLines(text, s, width) <= 2) return s
  }
  return sizes[sizes.length - 1]
}

// ------------------------------------------------------------------
// 各类页面版式
// ------------------------------------------------------------------
interface LayoutCtx {
  schema: SlideSchema
  data: SlideData
  accent: string
  palette: Palette
  index: number // 全局序号（用于章节编号）
  slideNo: number
}
type ElementsFactory = (ctx: LayoutCtx) => { elements: PPTElement[]; background?: SlideBackground }

/** 页面标题块：标题过长自动缩字号并向下顺延装饰线，返回正文起始 Y（防重叠） */
function titleHeader(
  data: SlideData,
  accent: string,
  y: number,
  palette: Palette,
): { els: PPTElement[]; bottom: number } {
  const els: PPTElement[] = []
  const title = (data.title || '').trim()
  if (!title) return { els, bottom: y + 10 }
  const width = 800
  const size = pickTitleSize(title, width, [40, 34, 28, 24, 20])
  const lines = estimateLines(title, size, width)
  const h = Math.round(lines * size * 1.32)
  els.push(textEl({
    x: 100, y, w: width, h,
    html: para(title, { size, color: palette.ink, bold: true }),
    valign: 'top',
  }, palette.ink))
  els.push(rect({ x: 100, y: y + h + 10, w: 64, h: 7, color: accent, radius: 3 }))
  return { els, bottom: y + h + 26 }
}

const coverLayout: ElementsFactory = ({ data, palette }) => {
  const els: PPTElement[] = []
  const bg: SlideBackground = { type: 'solid', color: palette.coverBg }
  const width = 880
  const title = (data.title || '演示文稿').trim() || '演示文稿'
  // 标题自适应字号 + 按实际高度居中排布；副标题跟随其下，避免长标题压住副标题
  const size = pickTitleSize(title, width, [56, 48, 40, 34, 28])
  const h = Math.round(estimateLines(title, size, width) * size * 1.24)
  const subtitleSize = data.text && estimateLines(data.text, 24, width) > 1 ? 20 : 24
  const subtitleH = data.text ? Math.round(estimateLines(data.text, subtitleSize, width) * subtitleSize * 1.5) : 0
  const totalH = h + (data.text ? subtitleH + 34 : 0)
  const top = Math.max(190, Math.round((VIEW_H - totalH) / 2) + 10)

  els.push(rect({ x: 0, y: 0, w: VIEW_W, h: 14, color: palette.top }))
  els.push(rect({ x: 426, y: Math.max(60, top - 38), w: 148, h: 6, color: palette.coverBar, radius: 3 }))
  els.push(textEl({
    x: 60, y: top, w: width, h,
    html: para(title, { size, color: palette.coverText, bold: true, align: 'center' }),
    valign: 'top',
  }, palette.coverText))
  if (data.text) {
    els.push(textEl({
      x: 60, y: top + h + 34, w: width, h: subtitleH,
      html: para(truncateToLines(data.text, subtitleSize, width, 2), { size: subtitleSize, color: palette.coverSub, align: 'center' }),
      valign: 'top',
    }))
  }
  return { elements: els, background: bg }
}

const contentsLayout: ElementsFactory = ({ data, accent, palette, slideNo }) => {
  const els: PPTElement[] = []
  const items = (data.items || []).filter((it) => typeof it === 'string') as string[]
  const header = titleHeader(data, accent, 76, palette)
  els.push(...header.els)

  if (items.length) {
    // 逐级缩小字号以适配可用高度；仍放不下则截断条目并提示
    const top = Math.max(header.bottom, 160)
    const avail = 508 - top
    const width = 780
    const variants = [
      { s: 22, ps: 16 },
      { s: 20, ps: 14 },
      { s: 18, ps: 12 },
      { s: 16, ps: 10 },
    ]
    const heightOf = (list: string[], v: { s: number; ps: number }) =>
      list.reduce(
        (h, it) => h + estimateLines(it, v.s, width) * v.s * 1.5 + v.ps,
        0,
      )
    let used = variants[variants.length - 1]
    for (const v of variants) {
      if (heightOf(items, v) <= avail) {
        used = v
        break
      }
    }
    let show = items.slice()
    let note = ''
    if (heightOf(show, used) > avail) {
      while (show.length > 1 && heightOf(show, used) > avail) show.pop()
      note = `…… 共 ${items.length} 条，已省略 ${items.length - show.length} 条`
    }
    const rows = show.map((it, i) =>
      `<p><span style="font-size:${used.s}px;color:${accent};font-weight:bold">${num(i + 1)}</span><span style="font-size:${used.s}px;color:${palette.ink}">&nbsp;&nbsp;&nbsp;${esc(truncateToLines(it, used.s, width - 40, 2))}</span></p>`,
    )
    if (note) {
      rows.push(`<p><span style="font-size:${Math.max(14, used.s - 4)}px;color:${palette.faint}">${note}</span></p>`)
    }
    els.push(textEl({
      x: 112, y: top, w: width, h: Math.min(avail, heightOf(show, used) + 8),
      html: rows.join(''),
      lineHeight: 1.5,
      paragraphSpace: used.ps,
    }, palette.ink))
  }
  els.push(textEl({
    x: 880, y: 522, w: 96, h: 26,
    html: para(String(slideNo + 1).padStart(2, '0'), { size: 16, color: palette.faint, align: 'right' }),
  }))
  return { elements: els, background: { type: 'solid', color: palette.paper } }
}

const transitionLayout: ElementsFactory = ({ data, palette }) => {
  const bg: SlideBackground = { type: 'solid', color: palette.transBg }
  const els: PPTElement[] = []
  els.push(rect({ x: 0, y: 0, w: VIEW_W, h: 10, color: palette.top }))
  const title = (data.title || '').trim()
  // 标题自适应字号；副标题按标题实际高度下移，避免压字
  let cursor = 232
  if (title) {
    const width = 880
    const size = pickTitleSize(title, width, [48, 42, 36, 30, 26])
    const h = Math.round(estimateLines(title, size, width) * size * 1.28)
    els.push(textEl({
      x: 60, y: cursor, w: width, h,
      html: para(title, { size, color: palette.transText, bold: true, align: 'center' }),
      valign: 'top',
    }, palette.transText))
    cursor += h + 22
  }
  if (data.text) {
    const width = 720
    const size = estimateLines(data.text, 22, width) <= 2 ? 22 : 18
    const h = Math.round(estimateLines(data.text, size, width) * size * 1.4)
    els.push(textEl({
      x: 140, y: cursor, w: width, h,
      html: para(truncateToLines(data.text, size, width, 2), { size, color: palette.transSub, align: 'center' }),
      valign: 'top',
    }))
    cursor += h + 14
  }
  els.push(rect({ x: 470, y: Math.min(cursor, 430), w: 60, h: 5, color: palette.transBar, radius: 2 }))
  return { elements: els, background: bg }
}

interface BodyItem {
  title?: string
  text?: string
}
const contentLayout: ElementsFactory = ({ data, accent, palette }) => {
  const header = titleHeader(data, accent, 76, palette)
  const els: PPTElement[] = [...header.els]
  const items = data.items || []
  const textual: BodyItem[] = []
  const charts: ChartItem[] = []
  const images: { title?: string; text?: string; url?: string }[] = []
  for (const it of items) {
    const kind = (it as { kind?: string } | null)?.kind
    if (typeof it === 'string') textual.push({ text: it })
    else if (kind === 'chart' && (it as ChartItem).labels) charts.push(it as ChartItem)
    else if (kind === 'image') images.push(it as { title?: string; text?: string; url?: string })
    else textual.push({ title: (it as BodyItem).title, text: (it as BodyItem).text })
  }

  const hasChart = charts.length > 0
  const top = Math.max(header.bottom, 150)
  const avail = 512 - top
  const width = hasChart ? 480 : 780

  // 逐级缩小字号；仍放不下则截断条目（并给出省略提示）
  const variants = [
    { t: 22, b: 19, lh: 1.5, ps: 12 },
    { t: 20, b: 17, lh: 1.45, ps: 10 },
    { t: 18, b: 15, lh: 1.4, ps: 8 },
    { t: 16, b: 14, lh: 1.35, ps: 6 },
  ]
  const heightOf = (list: BodyItem[], v: (typeof variants)[number]) =>
    list.reduce((h, it) => {
      const tl = it.title ? estimateLines(it.title, v.t, width) * v.t * 1.35 : 0
      const bl = it.text ? estimateLines(it.text, v.b, width) * v.b * 1.35 : 0
      return h + tl + bl + v.ps
    }, 0)
  let used = variants[variants.length - 1]
  for (const v of variants) {
    if (heightOf(textual, v) <= avail) {
      used = v
      break
    }
  }
  let show = textual.slice()
  let note = ''
  if (heightOf(show, used) > avail) {
    while (show.length > 1 && heightOf(show, used) > avail) show.pop()
    note = `…… 共 ${textual.length} 条，已省略 ${textual.length - show.length} 条`
  }

  const textPps: string[] = []
  for (const it of show) {
    if (it.title) {
      textPps.push(`<p><span style="font-size:${used.t}px;color:${palette.ink};font-weight:bold">${esc(truncateToLines(it.title, used.t, width, 2))}</span></p>`)
      if (it.text) {
        textPps.push(`<p><span style="font-size:${used.b}px;color:${palette.sub}">${esc(truncateToLines(it.text, used.b, width, 3))}</span></p>`)
      }
    } else if (it.text) {
      textPps.push(`<p><span style="font-size:${used.t}px;color:${palette.ink}">·&nbsp;&nbsp;${esc(truncateToLines(it.text, used.t, width, 3))}</span></p>`)
    }
  }
  if (note) {
    textPps.push(`<p><span style="font-size:${Math.max(14, used.b - 4)}px;color:${palette.faint}">${note}</span></p>`)
  }
  if (images.length && !textPps.length) {
    const names = images.map((i) => i.title).filter(Boolean).join('、') || '由模型按内容配图'
    textPps.push(`<p><span style="font-size:18px;color:${palette.faint}">（本页配图位：${names}）</span></p>`)
  }

  const bodyH = Math.min(avail, Math.max(60, heightOf(show, used) + 8))
  if (hasChart) {
    if (textPps.length) {
      els.push(textEl({
        x: 90, y: top, w: width, h: bodyH,
        html: textPps.join(''),
        lineHeight: used.lh,
        paragraphSpace: used.ps,
      }, palette.ink))
    }
    els.push(chartEl(charts[0], { x: 620, y: Math.max(160, top - 12), w: 340, h: Math.min(340, avail + 12) }, accent))
  } else {
    els.push(textEl({
      x: 100, y: top, w: width, h: bodyH,
      html: textPps.join('') || para('（本页暂无文字内容）', { size: 20, color: palette.faint }),
      lineHeight: used.lh,
      paragraphSpace: used.ps,
    }, palette.ink))
  }
  return { elements: els, background: { type: 'solid', color: palette.paper } }
}

const referenceLayout: ElementsFactory = ({ data, palette }) => {
  const accent = palette.accentFor(999) // 引用页用主题主色
  const header = titleHeader(data, accent, 76, palette)
  const els: PPTElement[] = [...header.els]
  const refs = data.references || []
  const top = Math.max(header.bottom, 150)
  const avail = 512 - top
  const width = 780
  const size = 18
  const perRow = size * 1.7 + 12
  const maxRows = Math.max(1, Math.floor(avail / perRow))
  const show = refs.slice(0, maxRows)
  const rows = show.map((r, i) =>
    `<p><span style="font-size:${size - 3}px;color:${accent};font-weight:bold">[${i + 1}]</span><span style="font-size:${size}px;color:${palette.sub}">&nbsp;&nbsp;${esc(truncateToLines(r, size, width - 40, 1))}</span></p>`,
  )
  if (refs.length > show.length) {
    rows.push(`<p><span style="font-size:${size - 4}px;color:${palette.faint}">…… 共 ${refs.length} 条参考文献，已省略 ${refs.length - show.length} 条</span></p>`)
  }
  els.push(textEl({
    x: 100, y: top, w: width, h: Math.min(avail, show.length * perRow + 8),
    html: rows.join('') || para('（暂无参考文献）', { size, color: palette.faint }),
    lineHeight: 1.6,
    paragraphSpace: 12,
  }, palette.ink))
  return { elements: els, background: { type: 'solid', color: palette.paper } }
}

const endLayout: ElementsFactory = ({ data, palette }) => {
  const bg: SlideBackground = { type: 'solid', color: palette.endBg }
  const els: PPTElement[] = []
  els.push(rect({ x: 0, y: 0, w: VIEW_W, h: 12, color: palette.top }))
  const title = (data.title || '谢谢观看').trim() || '谢谢观看'
  const width = 880
  const size = pickTitleSize(title, width, [54, 46, 38, 32, 26])
  const h = Math.round(estimateLines(title, size, width) * size * 1.28)
  const y = Math.max(196, Math.round((VIEW_H - h) / 2) - 30)
  els.push(textEl({
    x: 60, y, w: width, h,
    html: para(title, { size, color: palette.endText, bold: true, align: 'center' }),
    valign: 'top',
  }, palette.endText))
  els.push(textEl({
    x: 60, y: y + h + 18, w: width, h: 40,
    html: para('Thanks for watching', { size: 18, color: palette.coverSub, align: 'center' }),
  }))
  return { elements: els, background: bg }
}

const LAYOUTS: Record<string, ElementsFactory> = {
  cover: coverLayout,
  contents: contentsLayout,
  transition: transitionLayout,
  content: contentLayout,
  reference: referenceLayout,
  end: endLayout,
}

// ------------------------------------------------------------------
// 对外主入口
// ------------------------------------------------------------------
export function schemaToPptSlide(
  schema: SlideSchema,
  opts: { accent?: string; slideNo?: number; theme?: DeckTheme | null } = {},
): Slide {
  const data = schema.data || {}
  const palette = buildPalette(opts.theme)
  const factory = LAYOUTS[schema.type] || contentLayout
  const ctx: LayoutCtx = {
    schema,
    data,
    accent: opts.accent || palette.accentFor(opts.slideNo ?? 0),
    palette,
    index: opts.slideNo ?? 0,
    slideNo: opts.slideNo ?? 0,
  }
  const { elements, background } = factory(ctx)
  return {
    id: uid(),
    elements,
    background,
    type: TYPE_MAP[schema.type] || 'content',
  }
}

/** 整批转换；theme 传入所选模板主题（每页主色循环取 themeColors），缺省内置紫蓝 */
export function schemasToPptistSlides(schemas: SlideSchema[], theme?: DeckTheme | null): Slide[] {
  return schemas.map((s, i) => schemaToPptSlide(s, { slideNo: i, theme }))
}

/** 空态兜底：生成一页空白封面，保证编辑器打开时总有可编辑画布 */
export function makeBlankCover(title = '未命名演示文稿'): Slide {
  return schemaToPptSlide({ type: 'cover', data: { title, text: '双击进入编辑，或返回「生成」重新生成内容' } })
}
