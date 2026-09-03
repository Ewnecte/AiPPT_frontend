<script setup lang="ts">
// P05 幻灯片编辑器（画布待 PPTist 集成，本页先承载顶部操作栏：放映 / 导出）
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import ExportDialog from '../components/ExportDialog.vue'

const router = useRouter()
const showExport = ref(false)

function goScreen() {
  router.push('/screen')
}
</script>

<template>
  <div class="card">
    <!-- 顶部操作栏 -->
    <div class="toolbar">
      <div class="tb-title">
        <h1>幻灯片编辑器</h1>
      </div>
      <div class="tb-actions">
        <button class="btn ghost" title="全屏演示当前幻灯片" @click="goScreen">▶ 放映</button>
        <button class="btn primary" title="导出 PPTX / PDF / 图片 / JSON" @click="showExport = true">
          ⬇ 导出
        </button>
      </div>
    </div>

    <p class="hint">
      对应原型 P05：缩略图栏 + 可编辑画布 + 工具栏 + 样式面板，在画布中逐页排版与编辑。
    </p>

    <div class="placeholder">
      <div class="ph-ico">🎨</div>
      <p>画布区：此处渲染当前页并支持直接编辑元素</p>
    </div>

    <p class="foot">
      <router-link class="next" to="/screen">全屏放映 →</router-link>
    </p>
  </div>

  <ExportDialog v-if="showExport" @close="showExport = false" />
</template>

<style scoped>
.card {
  background: #fff;
  border-radius: 14px;
  padding: 24px 28px;
  box-shadow: 0 10px 30px rgba(30, 40, 80, 0.08);
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding-bottom: 14px;
  border-bottom: 1px solid #f1f3f9;
}
.tb-title h1 {
  font-size: 20px;
}
.tb-actions {
  display: flex;
  gap: 10px;
}
.btn {
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  padding: 9px 18px;
  border-radius: 10px;
  transition: 0.15s;
}
.btn.primary {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.btn.ghost {
  background: #eef0f7;
  color: #3f4a66;
}
.btn.ghost:hover {
  background: #e2e6f2;
}
.hint {
  color: #8a94a6;
  font-size: 13px;
  margin: 14px 0 18px;
}
.placeholder {
  min-height: 320px;
  border: 1.5px dashed #d6daea;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #a9b2c4;
  background:
    linear-gradient(45deg, rgba(102, 126, 234, 0.03) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(102, 126, 234, 0.03) 25%, transparent 25%);
  background-size: 24px 24px;
}
.ph-ico {
  font-size: 44px;
  opacity: 0.7;
}
.placeholder p {
  font-size: 13px;
}
.foot {
  margin-top: 16px;
}
.next {
  color: #6366f1;
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
}
</style>
