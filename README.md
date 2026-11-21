# SalesCompanion

销售 CRM 移动 AI Demo（React + Vite + 自研 Orchestrator）。

**文档：** [docs/README.md](docs/README.md) · 执行范围 [docs/15-demo-scope-matrix.md](docs/15-demo-scope-matrix.md)

## 快速启动

```bash
# 首次：在 server/.env 填 DEEPSEEK_API_KEY（可选）
# cd server && copy .env.example .env

# 一键（推荐）：API + 前端
npm run dev:all
```

或分两个终端：

```bash
# 终端 1 — API（DeepSeek）
cd server
npm run dev

# 终端 2 — 前端
cd ..
npm run dev
```

- 前端：http://127.0.0.1:5174  
- API：http://127.0.0.1:8787/api/health  
- Vite 已代理 `/api` → `8787`

## Demo 能力

| 场景 | 说明 |
| --- | --- |
| A 拜访录入 | 语音/文本 → 抽取 → 活动+商机草稿 → Confirm → synced |
| B 客户速览 | 「仁济医院最近怎么样？」 |
| C 订单物流（选做） | 「查一下仁济医院上个订单的物流」 |

编排：**DeepSeek**（默认；有 Key 时启用，否则启发式兜底）；数据：**Dataverse 种子内存库**（`dataverse/seed/seed.json`）。

> Copilot Studio 接入代码保留为可选路径（`AI_PROVIDER=copilotstudio` + 管理端配置），Demo 默认不使用，也不作为验收前提。

## 环境变量（server/.env）

| 变量 | 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 可选；不填则启发式 |
| `DEEPSEEK_MODEL` | 默认 `deepseek-chat` |
| `DATAVERSE_URL` / `DATAVERSE_TOKEN` | 可选；不填用内存种子 |
| `WEB_SEARCH_API_KEY` | 可选；通用助手实时网页检索（Serper/Tavily） |
| `WEB_SEARCH_PROVIDER` | `serper`（默认）或 `tavily` |
| `WEB_FETCH_ENABLED` | 可选；抓取 https 页面（有搜索 Key 时默认开启） |

Demo 默认不依赖 Copilot Studio / AI Builder；Copilot Studio 连接保留为可选路径（显式 `AI_PROVIDER=copilotstudio` 才启用）。

## 线上发布（Power Apps Code App）注意

**只发布前端不够。** 对话 / DeepSeek 跑在独立的 `server/` 上；Code App 静态托管里没有 Node，也没有 Vite 的 `/api` 代理。

| 环境 | 做法 |
| --- | --- |
| 本地 | `npm run dev:all` → http://127.0.0.1:5174 |
| 线上 | ① 把本仓库（至少 `server/` + `dataverse/seed/`）部署到你的服务器 ② 见下方「后端服务器部署」 ③ 构建前端前设 `VITE_API_BASE=https://你的API域名/api` ④ Power Platform CSP `connect-src` 允许该 API 域名（**不要只加** `api.deepseek.com`） |

### 后端服务器部署（Linux + Node + PM2 + Nginx）

```bash
# 1) 机器上安装 Node 20+，把代码放到例如 /var/www/SalesCompanion
cd /var/www/SalesCompanion/server
cp .env.example .env
# 编辑 .env：HOST=0.0.0.0  PORT=8787  DEEPSEEK_API_KEY=你的密钥

npm install
npm run build
npm run start:prod          # 先手动验证
curl http://127.0.0.1:8787/api/health   # 应 deepseek:true

# 2) 用 PM2 常驻
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup

# 3) Nginx 反代 HTTPS（示例）
# location /api/ { proxy_pass http://127.0.0.1:8787/api/; ... }
# 证书可用 certbot

# 4) 本机重新构建前端并发布 Code App
# Windows:
set VITE_API_BASE=https://api.你的域名.com/api
npm run build
```

健康检查：`https://api.你的域名.com/api/health`  
浏览器控制台若出现 `connect-src 'none'` / `powerplatformusercontent.com/api/...`，即未配公网 API 或 CSP 未放行。
