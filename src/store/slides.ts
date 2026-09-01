import { defineStore } from 'pinia'
import type { SlideSchema } from '../types/AIPPT'

// 幻灯片全局状态（后续编辑器/放映都会用到）
export const useSlidesStore = defineStore('slides', {
  state: () => ({
    slides: [] as SlideSchema[],
    templateId: '',
    currentIndex: 0,
  }),
  actions: {
    addSlide(slide: SlideSchema) {
      this.slides.push(slide)
    },
    reset() {
      this.slides = []
      this.currentIndex = 0
    },
  },
})
