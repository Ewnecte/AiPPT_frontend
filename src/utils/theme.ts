// 模板主题装载器（全站共用一份缓存）
// ------------------------------------------------------------------
// 从后端 /data/{templateId}.json 读取 theme（主题色/字体/底色），并额外从模板自带
// 的 slides 里按页面类型采样背景色（cover/contents/content/transition/end/reference），
// 让「封面主色、过渡页、内容页浅染」都能体现所选模板，而不是只换一点强调色。
import { getTemplateData, type TemplateDeckData } from '../services'
import type { SlideType } from '../types/AIPPT'
import type { DeckTheme } from './aippt'

const cache = new Map<string, DeckTheme | null>()

/** 从 PPTist background 里取一个可用颜色：solid 取 color，gradient 取第一个色标 */
function firstColor(bg: unknown): string | undefined {
  if (!bg || typeof bg !== 'object') return undefined
  const b = bg as {
    type?: string
    color?: string
    gradient?: { colors?: { color?: string }[] }
  }
  if (b.type === 'solid' && typeof b.color === 'string' && b.color.trim()) return b.color.trim()
  const stops = b.gradient?.colors
  if (Array.isArray(stops)) {
    for (const s of stops) {
      if (s && typeof s.color === 'string' && s.color.trim()) return s.color.trim()
    }
  }
  return undefined
}

/** 模板 JSON → DeckTheme（无 themeColors 视为无主题） */
export function themeFromDeck(deck: TemplateDeckData): DeckTheme | null {
  const t = deck.theme
  if (!t || !Array.isArray(t.themeColors) || !t.themeColors.length) return null

  const backgrounds: Partial<Record<SlideType, string>> = {}
  for (const s of deck.slides || []) {
    const type = s?.type as SlideType | undefined
    if (!type || backgrounds[type]) continue
    const c = firstColor(s?.background)
    if (c) backgrounds[type] = c
  }

  return {
    name: deck.name || t.name,
    themeColors: t.themeColors,
    backgroundColor: t.backgroundColor,
    fontColor: t.fontColor,
    fontName: t.fontName,
    backgrounds,
  }
}

/** 按模板 id 加载主题（带缓存）；无 id 或失败返回 null（回落内置紫蓝默认风格）。 */
export async function loadDeckTheme(id?: string | null): Promise<DeckTheme | null> {
  const key = (id || '').trim()
  if (!key) return null
  if (cache.has(key)) return cache.get(key) ?? null
  let theme: DeckTheme | null = null
  try {
    theme = themeFromDeck(await getTemplateData(key))
  } catch {
    theme = null
  }
  cache.set(key, theme)
  return theme
}
