// 幻灯片"草稿"状态（仅服务 /generate 页的流式生成与缩略图预览）
// ------------------------------------------------------------------
// 注意：本 store 的 pinia id 取 'draft'，不能占用 'slides'——
// 'slides' 已被 vendored PPTist 内核（src/pptist/store/slides.ts）使用，
// 两者 id 相同会导致 Pinia 以先注册者为准，互相污染。
// 本 store 保存的是外层 EditorSlide[]（1920×1080 轻量元素模型），
// 进入 /editor 时由 Editor.vue 用 exportSchemas() 还原成 SlideSchema[]，
// 再经 src/utils/schemaToPptist.ts 转成 PPTist Slide[] 灌入 PPTist 编辑器。
import { defineStore } from 'pinia'
import type { SlideSchema, SlideType } from '../types/AIPPT'
import type { EditorSlide, SlideElement } from '../types/editor'
import {
  accentAt,
  cloneSchema,
  cloneSlide,
  createBlankSlide,
  schemaToSlide,
  syncElementToSchema,
  syncSlideFromElements,
  uid,
} from '../utils/aippt'

export interface GenMeta {
  title: string
  outline: string
  templateId: string
  language: string
  source: 'web' | 'file' | 'kb'
}

const EMPTY_META: GenMeta = {
  title: '',
  outline: '',
  templateId: '',
  language: '中文',
  source: 'web',
}

interface Snapshot {
  slides: EditorSlide[]
  current: number
}

function encodeSnapshot(s: Snapshot): string {
  return JSON.stringify(s)
}

export const useDraftStore = defineStore('draft', {
  state: () => ({
    slides: [] as EditorSlide[],
    currentIndex: 0,
    meta: { ...EMPTY_META } as GenMeta,
    generating: false,
    // 撤销 / 重做（每次 record() 前会压入快照字符串）
    past: [] as string[],
    future: [] as string[],
  }),

  getters: {
    slideCount: (s) => s.slides.length,
    currentSlide: (s): EditorSlide | null => s.slides[s.currentIndex] ?? null,
    canUndo: (s) => s.past.length > 0,
    canRedo: (s) => s.future.length > 0,
  },

  actions: {
    // ---------- 历史快照 ----------
    snapshot(): Snapshot {
      return JSON.parse(encodeSnapshot({ slides: this.slides, current: this.currentIndex })) as Snapshot
    },
    record() {
      const sn = encodeSnapshot({ slides: this.slides, current: this.currentIndex })
      if (this.past[this.past.length - 1] === sn) return
      this.past.push(sn)
      if (this.past.length > 120) this.past.shift()
      this.future = []
    },
    undo(): boolean {
      if (!this.past.length) return false
      this.future.push(encodeSnapshot({ slides: this.slides, current: this.currentIndex }))
      const sn = JSON.parse(this.past.pop() as string) as Snapshot
      this.slides = sn.slides
      this.currentIndex = sn.current
      return true
    },
    redo(): boolean {
      if (!this.future.length) return false
      this.past.push(encodeSnapshot({ slides: this.slides, current: this.currentIndex }))
      const sn = JSON.parse(this.future.pop() as string) as Snapshot
      this.slides = sn.slides
      this.currentIndex = sn.current
      return true
    },

    // ---------- 元信息 / 生成状态 ----------
    setMeta(meta: Partial<GenMeta>) {
      this.meta = { ...this.meta, ...meta }
    },
    setGenerating(v: boolean) {
      this.generating = v
    },

    // ---------- 幻灯片管理 ----------
    reset() {
      this.slides = []
      this.currentIndex = 0
      this.past = []
      this.future = []
      this.meta = { ...EMPTY_META }
      this.generating = false
    },
    /** 整批替换（生成页全部完成 / 演示数据导入） */
    seedSlides(slides: EditorSlide[], meta?: Partial<GenMeta>) {
      this.slides = slides
      this.currentIndex = slides.length ? 0 : 0
      this.past = []
      this.future = []
      if (meta) this.meta = { ...this.meta, ...meta }
    },
    /** 生成中逐页追加（流式） */
    pushSlide(slide: EditorSlide) {
      this.slides.push(slide)
      this.currentIndex = this.slides.length - 1
    },
    /** 生成中追加一页契约（自动计数过渡章节序号 / 版式主色） */
    pushSchema(schema: SlideSchema) {
      const transitionIndex = schema.type === 'transition'
        ? this.slides.filter((s) => s.type === 'transition').length
        : undefined
      const slide = schemaToSlide(schema, {
        accent: accentAt(this.slides.length),
        transitionIndex,
      })
      this.pushSlide(slide)
    },
    insertBlank(type: SlideType, atEnd = true) {
      const i = atEnd ? this.slides.length : Math.max(0, this.currentIndex)
      const slide = createBlankSlide(type, { accent: accentAt(this.slides.length + 1) })
      this.slides.splice(i, 0, slide)
      this.currentIndex = i
    },
    removeSlide(i: number) {
      if (!this.slides.length) return
      this.slides.splice(i, 1)
      if (this.slides.length === 0) {
        this.currentIndex = 0
        return
      }
      this.currentIndex = Math.min(Math.max(0, i - 1), this.slides.length - 1)
    },
    duplicateSlide(i: number) {
      const src = this.slides[i]
      if (!src) return
      const c = cloneSlide(src)
      c.id = uid()
      c.elements = c.elements.map((el) => ({ ...el, id: uid() }))
      this.slides.splice(i + 1, 0, c)
      this.currentIndex = i + 1
    },
    moveSlide(from: number, to: number) {
      if (from < 0 || from >= this.slides.length) return
      const [s] = this.slides.splice(from, 1)
      const target = Math.min(Math.max(0, to), this.slides.length)
      this.slides.splice(target, 0, s)
      this.currentIndex = target
    },
    setCurrent(i: number) {
      this.currentIndex = Math.min(Math.max(0, i), this.slides.length - 1)
    },
    updateSlide(i: number, patch: Partial<EditorSlide>) {
      if (this.slides[i]) this.slides[i] = { ...this.slides[i], ...patch }
    },

    // ---------- 元素编辑 ----------
    findElement(slideIdx: number, elId: string): SlideElement | null {
      return this.slides[slideIdx]?.elements.find((el) => el.id === elId) ?? null
    },
    /** 替换某页元素数组（排序 / 删除 / 添加等） */
    setElements(slideIdx: number, els: SlideElement[]) {
      if (this.slides[slideIdx]) this.slides[slideIdx].elements = els
    },
    patchElement(slideIdx: number, elId: string, patch: Partial<SlideElement>) {
      const el = this.findElement(slideIdx, elId)
      if (el) Object.assign(el, patch)
    },
    setText(slideIdx: number, elId: string, text: string) {
      const el = this.findElement(slideIdx, elId)
      const slide = this.slides[slideIdx]
      if (el && el.type === 'text' && slide) {
        el.text = text
        syncElementToSchema(slide.schema, el)
      }
    },
    addElement(slideIdx: number, el: SlideElement) {
      const slide = this.slides[slideIdx]
      if (slide) slide.elements.push(el)
    },
    removeElement(slideIdx: number, elId: string) {
      const slide = this.slides[slideIdx]
      if (slide) slide.elements = slide.elements.filter((el) => el.id !== elId)
    },
    /** 元素上移一层（显示层级，后加入的在上面） */
    bringElementForward(slideIdx: number, elId: string) {
      const slide = this.slides[slideIdx]
      if (!slide) return
      const idx = slide.elements.findIndex((el) => el.id === elId)
      if (idx >= 0 && idx < slide.elements.length - 1) {
        const [el] = slide.elements.splice(idx, 1)
        slide.elements.splice(idx + 1, 0, el)
      }
    },
    sendElementBackward(slideIdx: number, elId: string) {
      const slide = this.slides[slideIdx]
      if (!slide) return
      const idx = slide.elements.findIndex((el) => el.id === elId)
      if (idx > 0) {
        const [el] = slide.elements.splice(idx, 1)
        slide.elements.splice(idx - 1, 0, el)
      }
    },
    /** 依据 schema 重新排版当前页（新增/删除内容项或切换版式后调用） */
    relayoutSlide(slideIdx: number) {
      const src = this.slides[slideIdx]
      if (!src) return
      const transitionIndex = src.type === 'transition'
        ? this.slides.slice(0, slideIdx).filter((s) => s.type === 'transition').length
        : undefined
      const rebuilt = schemaToSlide(src.schema, {
        accent: src.accent,
        transitionIndex,
      })
      src.elements = rebuilt.elements
      src.schema = cloneSchema(src.schema)
      src.background = rebuilt.background
    },
    /** 导出前把所有元素文本同步回 schema，返回还原出的契约 */
    exportSchemas(): SlideSchema[] {
      return this.slides.map((slide) => {
        syncSlideFromElements(slide)
        return cloneSchema(slide.schema)
      })
    },
    /** 替换整批内容契约（导入 JSON 后用），自动按序排版 */
    importSchemas(schemas: SlideSchema[]) {
      let transitionIndex = 0
      const slides = schemas.map((s, i) => {
        const isTrans = s.type === 'transition'
        const slide = schemaToSlide(s, { accent: accentAt(i), transitionIndex: isTrans ? transitionIndex : undefined })
        if (isTrans) transitionIndex += 1
        return slide
      })
      this.seedSlides(slides)
    },
  },
})
