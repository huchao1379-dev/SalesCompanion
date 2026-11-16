# 10 · 产品配置 SKU

按 Microsoft 产品 / SKU 组织：用途、目标角色、估算逻辑。单价以微软或合作伙伴正式报价为准。

## SKU 一览

| SKU | Purpose | Target User Roles | Sizing Logic |
| --- | --- | --- | --- |
| **Power Apps Premium** | 移动 App 运行时：Premium 连接器（含 SAP / Custom）、Dataverse、Custom Pages、Mobile App | 一线销售 / 服务工程师、区域经理、Maker | 按命名用户：Phase 1 ~10–20；Phase 2 ~100；Phase 4 按目标销售 1:1 |
| **Copilot Studio User** | Agent 编辑 / 发布：编排、新 Agent、知识源维护 | Maker、中央 IT 编排团队 | 按 Maker 头数：Phase 2 约 5–10；Phase 4 每区域 1–2 |
| **Copilot Studio Credits** | 运行时与 AI 消耗：对话消息 + Prompt(GPT) / OCR / 抽取 / 分类等；Code App 与编排层共用。语音为设备原生，无额外语音订阅 | 租户级（不绑人头） | 月活 × 日均对话 × 22 + 高耗调用；Phase 1 例：10×20×22 ≈ 4.4k 消息/月；Phase 2 起按 P95 续包并设上限 |
| **Managed Environments + Dataverse Capacity** | 环境拓扑、Pipelines、使用分析；DB / 文件容量承载元数据、日志、知识缓存 | 租户级 · 中央 IT | Managed Environments 常与 Premium 对齐；容量 = 基线 + 月增量，预留 ~30% |
| **Microsoft 365 E3 / E5** | Entra SSO、Teams Copilot、SharePoint 知识源、Outlook 跟进 | 全体内部用户 | **复用已有**；确认目标人群已启用 Teams / SharePoint |
| **Microsoft Purview** | AI 审计、PII、Copilot 互动追踪 | 合规 / 安全 | E5 可启用；E3 需加载项；按受合规约束人数 |

## 复用 vs 新购 vs 按量

### 可复用（通常不重复采购）

- Microsoft 365 E3 / E5  
- Microsoft Purview（E5 已含；E3 补加载项）  
- Managed Environments（与既有 Power Platform 治理合并）  

### 需新购订阅

- Power Apps Premium（命名用户）  
- Copilot Studio Credits（消息 + AI 调用估包）  
- Copilot Studio User（Maker）  
- Dataverse 增量容量  

### Azure 按量（无需预购授权）

| 服务 | 用途 |
| --- | --- |
| API Management | SAP 统一接入 |
| Service Bus | 异步回写 |
| Key Vault | 凭据托管 |
| Application Insights / Monitor | 端到端可观测 |
| Blob Storage | 拜访照片 / 铭牌 |
| AI Search | Phase 3 售后知识语义检索 |

按月实际用量结算；前期可控，随 Phase 弹性增减。

## 分阶段 sizing 快查

| 阶段 | Premium 用户 | Maker | Credits 策略 |
| --- | --- | --- | --- |
| Phase 1 | 10–20 | 少数（中央） | 最小包验证基线 |
| Phase 2 | ~100 | 5–10 | 按 P95 续包 + 租户上限 |
| Phase 3 | 随售后角色扩展 | + 知识维护者 | 检索类调用单独观察 |
| Phase 4 | 全球销售 1:1 | 每区域 1–2 | 区域用量分账可选 |

## 与架构映射

| 架构层 | 主要 SKU / 服务 |
| --- | --- |
| 体验 | Power Apps Premium、M365（Teams） |
| 认知 / 编排 | Copilot Studio Credits + User、AI Builder（含于 Credits 计量叙事） |
| 数据 | Dataverse Capacity、APIM、Service Bus、Blob |
| 治理 | Managed Environments、Purview、Key Vault、App Insights |

## 相关文档

- [02 系统架构](02-system-architecture.md)
- [09 实施计划](09-implementation-roadmap.md)
- [11 成功指标](11-success-metrics.md)
