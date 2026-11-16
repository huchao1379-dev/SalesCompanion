# SalesCompanion

销售 CRM 移动 AI Demo（React + Vite + 自研 Orchestrator）。

**文档：** [docs/README.md](docs/README.md) · 执行范围 [docs/15-demo-scope-matrix.md](docs/15-demo-scope-matrix.md)

## 快速启动

```bash
# 1) API（DeepSeek 可选；无 Key 时用启发式 + 种子 Dataverse）
cd server
cp .env.example .env   # 可选填 DEEPSEEK_API_KEY
npm install
npm run dev

# 2) 前端（另开终端）
cd ..
npm install
npm run dev
```

- 前端：http://localhost:5173  
- API：http://localhost:8787/api/health  
- Vite 已代理 `/api` → `8787`

## Demo 能力

| 场景 | 说明 |
| --- | --- |
| A 拜访录入 | 语音/文本 → 抽取 → 活动+商机草稿 → Confirm → synced |
| B 客户速览 | 「仁济医院最近怎么样？」 |
| C 订单物流（选做） | 「查一下仁济医院上个订单的物流」 |

编排：**DeepSeek**（有 Key）或启发式兜底；数据：**Dataverse 种子内存库**（`dataverse/seed/seed.json`）。

## 环境变量（server/.env）

| 变量 | 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 可选；不填则启发式 |
| `DEEPSEEK_MODEL` | 默认 `deepseek-chat` |
| `DATAVERSE_URL` / `DATAVERSE_TOKEN` | 可选；不填用内存种子 |

无 Copilot Studio、无 AI Builder。
