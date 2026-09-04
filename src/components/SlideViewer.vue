<script setup lang="ts">
// 整页 16:9 预览：按给定显示宽度把 1920×1080 画布整体等比缩放渲染。
// 供缩略图栏 / 生成进度实时预览使用（纯展示，不处理交互）。
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import type { EditorSlide } from '../types/editor'
import { SLIDE_W, SLIDE_H } from '../types/editor'
import ElementView from './ElementView.vue'

const props = withDefaults(
  defineProps<{
    slide: EditorSlide
    /** 显示宽度（px），高度按 16:9 自动得出 */
    width?: number
    /** 是否显示阴影 / 圆角等卡片观感 */
    flat?: boolean
  }>(),
  { width: 320, flat: false },
)

const scale = computed(() => props.width / SLIDE_W)
const height = computed(() => (SLIDE_H * scale.value))
const boxH = computed(() => height.value)

const stageStyle = computed<CSSProperties>(() => ({
  width: `${SLIDE_W}px`,
  height: `${SLIDE_H}px`,
  transform: `scale(${scale.value})`,
  transformOrigin: '0 0',
  background: props.slide.background.css,
  overflow: 'hidden',
}))
</script>

<template>
  <div class="slide-viewer" :style="{ width: width + 'px', height: boxH + 'px' }">
    <div
      class="slide-stage"
      :style="stageStyle"
      :class="{ shadow: !flat }"
    >
      <ElementView v-for="el in slide.elements" :key="el.id" :el="el" />
    </div>
  </div>
</template>

<style scoped>
.slide-viewer {
  position: relative;
  overflow: hidden;
  flex: none;
}
.slide-stage {
  position: absolute;
  top: 0;
  left: 0;
}
.slide-stage.shadow {
  box-shadow: 0 6px 22px rgba(20, 24, 60, 0.18);
  border-radius: 4px;
}
</style>
