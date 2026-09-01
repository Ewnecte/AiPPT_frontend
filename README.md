# 前端（三人协作）

Vue3 + Vite + TypeScript，基于 PPTist 二次开发（编辑器部分）。

## 启动

```bash
cd frontend
npm install
npm run dev          # http://127.0.0.1:5173
```

> 前端通过 `vite.config.ts` 把 `/api` 代理到后端主 API（127.0.0.1:6800）。
> 后端未就绪时，可临时把代理 target 改为 mock_api（6801）联调。

## 目录与分工建议

| 目录 | 内容 | 负责 |
| ---- | ---- | ---- |
| `src/services/index.ts` | API 契约（已写好骨架） | **前端 A**（牵头定稿） |
| `src/types/AIPPT.ts` | Slide Schema 类型（已写好） | **前端 A** |
| `src/views/Outline.vue` | 录入 + 大纲生成/编辑（P01/P02） | 前端 A |
| `src/views/TemplateSelect.vue` | 模板选择（P03） | 前端 A |
| `src/views/Editor.vue` | 编辑器（P05，集成 PPTist） | 前端 B |
| `src/store/` | Pinia 状态（幻灯片/放映/快照/快捷键） | 前端 B |
| `src/views/Screen.vue` | 放映（P07） | 前端 C |
| `src/views/Settings.vue` | 知识库/设置（P08） | 前端 C |
| `src/components/`、`src/configs/`、`src/utils/` | 通用组件、主题/字体/图表配置、工具 | 前端 C 牵头 |

## 协作约定

1. **接口对齐**：后端接口见 `backend/main_api/main.py`，前端已按此写好 `services/index.ts`。
   改接口时，后端改 `main.py`，前端同步改 `services/index.ts` 和 `types/AIPPT.ts`。
2. **SSE 解析**：`AIPPT_Outline`（text/plain 流式）与 `AIPPT_Content`（SSE，`data: [DONE]` 结束）
   已实现，直接调用即可。
3. **模板匹配引擎**：核心逻辑在 `hooks/useAIPPT.ts`（待建），参考复现计划第 9.2 节。
4. **编辑器**：PPTist 集成放 `views/Editor.vue`，不要改 `services` 与 `types` 的对外签名。
