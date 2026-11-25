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

编排：**DeepSeek**（默认）或 **OpenAI gpt-6-luna**（`AI_PROVIDER=openai`）；有 Key 时启用，否则启发式兜底。数据：**真实 Dataverse**（`DATAVERSE_*` 必填，无内存种子回退）。

> Copilot Studio 接入代码保留为可选路径（`AI_PROVIDER=copilotstudio` + 管理端配置），Demo 默认不使用，也不作为验收前提。

## 环境变量（server/.env）

| 变量 | 说明 |
| --- | --- |
| `AI_PROVIDER` | `deepseek`（默认）/ `openai` / `copilotstudio` |
| `DEEPSEEK_API_KEY` | DeepSeek 路径；不填则启发式 |
| `DEEPSEEK_MODEL` | 默认 `deepseek-chat` |
| `OPENAI_API_KEY` | OpenAI 路径（`AI_PROVIDER=openai`） |
| `OPENAI_MODEL` | 默认 `gpt-6-luna`（也接受 `gpt6-luna`） |
| `OPENAI_REASONING_EFFORT` | `none` / `low`（默认）/ `medium` / `high` / `xhigh` / `max` |
| `OPENAI_BASE_URL` | 默认 `https://api.openai.com`（走 `/v1/responses`） |
| `DATAVERSE_URL` + Token 或 Client Credentials | **必填**；读写真实 Dataverse 表 |
| `DATAVERSE_PREFIX` | 表前缀，如 `hc` |
| `WEB_SEARCH_API_KEY` | 可选；通用助手实时网页检索（Serper/Tavily） |
| `WEB_SEARCH_PROVIDER` | `serper`（默认）或 `tavily` |
| `WEB_FETCH_ENABLED` | 可选；抓取 https 页面（有搜索 Key 时默认开启） |
| `SPEECH_PROVIDER` | `auto`（默认）/ `iflytek` / `webspeech` |
| `IFLYTEK_APP_ID` / `API_KEY` / `API_SECRET` | 可选；听写 + 合成共用（国内可用，不依赖 Google） |
| `IFLYTEK_TTS_VCN` | 可选；合成发音人，默认 `xiaoyan`（需在控制台开通） |

### 切换到讯飞语音（听写 + 播报）

**听写（ASR）**：浏览器采 PCM → `GET /api/speech/iat/ticket` → HTTPS 会话 / WSS 代理 → 讯飞（密钥只留服务端）。

**播报（TTS）**：每日播报 / Copilot 自动朗读 → `POST /api/speech/tts` → 服务端连 `tts-api.xfyun.cn` 合成 MP3 → 前端 `Audio` 播放（**不再依赖 Google / speechSynthesis**；失败时才回退浏览器 TTS）。

1. 在[讯飞开放平台](https://console.xfyun.cn/)创建应用，并开通：
   - **语音听写（流式版）**（新建拜访 / Copilot 录音）
   - **在线语音合成（流式版）**，并添加发音人（如小燕 `xiaoyan`）
2. 若尚无 `server/.env`：`cd server && copy .env.example .env`（macOS/Linux 用 `cp`）
3. 在 `server/.env` 填写：

```bash
SPEECH_PROVIDER=auto
IFLYTEK_APP_ID=你的AppID
IFLYTEK_API_KEY=你的APIKey
IFLYTEK_API_SECRET=你的APISecret
# 可选：合成发音人（控制台显示的 vcn）
# IFLYTEK_TTS_VCN=xiaoyan
# 可选：听写语言/方言/动态修正
# IFLYTEK_LANGUAGE=zh_cn
# IFLYTEK_ACCENT=mandarin
# IFLYTEK_DWA=wpgs
# IFLYTEK_VAD_EOS=3000
```

4. 重启 API（`npm run dev` 或 `npm run dev:all`）
5. 验证：`curl http://127.0.0.1:8787/api/health` 应看到 `"speechProvider":"iflytek"`、`"iflytek":true`、`"iflytekTts":true`
6. 打开对话页 / 拜访录入点按麦克风；每日播报应走讯飞合成
7. 前端也可强制听写：根目录 `.env` 设 `VITE_SPEECH_PROVIDER=iflytek`（或 `webspeech`）后重启 Vite

未配置讯飞密钥时：听写回退浏览器 Web Speech；播报回退 `speechSynthesis`（Chrome 上常走 Google，国内/部分安卓浏览器不稳定）。

**线上移动端注意（Power Apps / 安卓 / iOS）：**

控制台若出现：

`Refused to connect to 'wss://salescompanion.de1.net/...' ... connect-src https://salescompanion.de1.net ...`

说明 **CSP 只放了 https，没放 wss**。当前默认已改走 **HTTPS 会话**（`/api/speech/iat/session` + SSE），与现有 `https://salescompanion.de1.net` 兼容，**不必再加 wss**。

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 安卓「讯飞语音连接失败」+ CSP 拦 `wss://` | Power Apps 未放行 WebSocket | 部署含 HTTP 语音通道的新前后端；CSP 保留 `https://salescompanion.de1.net` 即可 |
| iOS `The operation is insecure` | 宿主未授权麦克风 | 系统/Power Apps 开麦克风，或用 Safari 打开 |
| 仍想用 WSS | 需改 CSP | 在 connect-src **额外**加 `wss://salescompanion.de1.net` |
| 播报失败 + 控制台 `media-src ...` 拦 `blob:` | **旧前端**仍用 `blob:` 播音频 | **重新构建并发布前端**（现已改 Web Audio，不依赖 media-src / blob）。只放行域名不够，代码必须更新到线上 |
| 本地播报正常、线上失败 | ① 线上后端未部署 `/api/speech/tts` ② 讯飞只开通了听写未开通合成 ③ 前端仍是旧包 ④ Power Apps CSP 拦媒体 | 在电脑浏览器打开 `https://你的API/api/health` 看 `iflytekTts:true`；`POST /api/speech/tts` 应返回 audioBase64。听写≠合成，控制台要单独开通「在线语音合成」并添加发音人 |

你当前 CSP 建议保持：

`connect-src https://api.deepseek.com https://salescompanion.de1.net https://*.api.powerplatform.com https://*.api.powerplatformusercontent.com`

（听写 / 播报都走 https API，**无需**把 `tts-api.xfyun.cn` / `iat-api.xfyun.cn` 加进白名单，也无需 `wss://`。）

### 切换到 OpenAI gpt-6-luna

在 `server/.env`：

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-6-luna
OPENAI_REASONING_EFFORT=low
```

重启 `server` 后，`GET /api/health` 应看到 `aiProvider:"openai"`、`openai:true`、`llmModel:"gpt-6-luna"`。聊天 / 洞察仍走同一套 Orchestrator，底层改为 OpenAI Responses API。

> **注意：** `openai:true` 只表示 Key 已配置，不保证本机能访问 `api.openai.com`。若聊天条出现「规则兜底」且步骤摘要含连接超时，请走可访问 OpenAI 的代理，或把 `OPENAI_BASE_URL` 改成你们的兼容网关（仍调用 `/v1/responses`）。

Demo 默认不依赖 Copilot Studio / AI Builder；Copilot Studio 连接保留为可选路径（显式 `AI_PROVIDER=copilotstudio` 才启用）。

## 线上发布（Power Apps Code App）注意

**只发布前端不够。** 对话 / DeepSeek 跑在独立的 `server/` 上；Code App 静态托管里没有 Node，也没有 Vite 的 `/api` 代理。

| 环境 | 做法 |
| --- | --- |
| 本地 | `npm run dev:all` → http://127.0.0.1:5174 |
| 线上 | ① 部署 `server/` 并配置 `DATAVERSE_*` ② 见下方「后端服务器部署」 ③ 构建前端前设 `VITE_API_BASE=https://你的API域名/api` ④ Power Platform CSP `connect-src` 允许该 API 域名（**不要只加** `api.deepseek.com`） |

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
