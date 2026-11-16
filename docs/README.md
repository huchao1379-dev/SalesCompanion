# SalesCompanion 文档套件

本目录是 **SalesCompanion**（销售 CRM 移动 AI 智能体）的完整实施与设计文档，对齐提案 [销售 CRM 移动 AI 智能体方案](https://illusion615.github.io/KnowledgeHub/posts/mindray-crm-ai-proposal/index.html)，并落到本仓库 Power Apps Code App（React + Vite）语境。

> 不再让销售「使用 CRM」，而是让 CRM「跟随销售」。

## 文档列表

| 编号 | 文档 | 说明 |
| --- | --- | --- |
| 00 | [术语表](00-glossary.md) | SoR/SoE、消息信封、草稿三段式等统一用语 |
| 01 | [产品总览](01-product-overview.md) | 愿景、四原则、痛点与价值主张 |
| 02 | [系统架构](02-system-architecture.md) | 体验 / 认知 / 编排 / 数据 / 治理五层 |
| 03 | [Agent 架构](03-agent-architecture.md) | 三层 Agent、四种协同、消息契约 |
| 04 | [Agent 全景目录](04-agent-catalog.md) | 30+ Agent 与 Phase 标注 |
| 05 | [界面五屏](05-ui-screens.md) | 今日大盘 / Brief Me / 活动 / 客户 / 商机 |
| 06 | [数据模型](06-data-model.md) | Dataverse 操作面 + Virtual Tables + 状态机 |
| 07 | [SAP 集成](07-integration-sap.md) | 读路径、异步回写、幂等与补偿 |
| 08 | [ALM 交付](08-alm-delivery.md) | Plan-First · Vibe Build · ALM Promote |
| 09 | [实施计划](09-implementation-roadmap.md) | 6 个月四阶段、里程碑、回退与风险 |
| 10 | [产品配置 SKU](10-product-sku.md) | 授权、Credits、Azure 按量服务 |
| 11 | [成功指标](11-success-metrics.md) | A/B/C 三维收益与度量原则 |
| 12 | [Phase 1 开工指南](12-phase1-build-guide.md) | 对本仓库的环境、目录、验收清单 |

## 按角色阅读路径

### 产品经理 / 业务负责人

1. [01 产品总览](01-product-overview.md)
2. [09 实施计划](09-implementation-roadmap.md)
3. [11 成功指标](11-success-metrics.md)
4. [04 Agent 全景目录](04-agent-catalog.md)

### 架构师 / 平台负责人

1. [00 术语表](00-glossary.md)
2. [02 系统架构](02-system-architecture.md)
3. [03 Agent 架构](03-agent-architecture.md)
4. [06 数据模型](06-data-model.md) → [07 SAP 集成](07-integration-sap.md)
5. [08 ALM 交付](08-alm-delivery.md) → [10 产品配置 SKU](10-product-sku.md)

### 前端 / Code App 开发

1. [01 产品总览](01-product-overview.md)（四原则）
2. [05 界面五屏](05-ui-screens.md)
3. [03 Agent 架构](03-agent-architecture.md)（消息契约）
4. [12 Phase 1 开工指南](12-phase1-build-guide.md)

### Citizen Developer / Maker

1. [03 Agent 架构](03-agent-architecture.md)
2. [04 Agent 全景目录](04-agent-catalog.md)
3. [08 ALM 交付](08-alm-delivery.md)
4. [12 Phase 1 开工指南](12-phase1-build-guide.md)

### 交付 / 项目经理

1. [09 实施计划](09-implementation-roadmap.md)（主文档）
2. [08 ALM 交付](08-alm-delivery.md)
3. [10 产品配置 SKU](10-product-sku.md)
4. [11 成功指标](11-success-metrics.md)

## 仓库对应关系

| 仓库现状 | 文档落点 |
| --- | --- |
| [`power.config.json`](../power.config.json) → `SalesCompanion` Code App | [12 Phase 1 开工指南](12-phase1-build-guide.md) |
| [`src/App.tsx`](../src/App.tsx) 模板页 | [05 界面五屏](05-ui-screens.md) 模块映射 |
| 尚无 Dataverse / Connector 引用 | [06](06-data-model.md) / [07](07-integration-sap.md) |

## 提案原文

完整方案叙事与图示见：

https://illusion615.github.io/KnowledgeHub/posts/mindray-crm-ai-proposal/index.html
