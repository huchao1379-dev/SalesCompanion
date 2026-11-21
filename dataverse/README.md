# Dataverse（Demo）

> 权威规格：[docs/13-dataverse-table-spec.md](../docs/13-dataverse-table-spec.md)  
> 范围矩阵：[docs/15-demo-scope-matrix.md](../docs/15-demo-scope-matrix.md)  
> 种子数据：[`seed/seed.json`](seed/seed.json)

---

## 当前仓库状态（务必先读）

| 项 | 现状 |
| --- | --- |
| 运行时数据源 | **默认内存替身**：API 启动时加载 `seed/seed.json`（`server/src/store/dataverseStore.ts`，`mode: seed-memory`） |
| 真实 Dataverse Web API | **尚未实现**。`SalesRepository` 已预留 `dataverse-webapi`，配 `DATAVERSE_URL` + `DATAVERSE_TOKEN` 后仍不会自动连真表，需补适配器 |
| Maker 环境建表 | **需手工按本文「必建表」在 Dataverse 建表**；本目录暂无 Solution 包 / 导入脚本 |
| 种子 | 已含仁济、Alpha/Beta/Gamma/Delta、张主任、N17 商机、订单/物流；`activities` 初始为空（由 Demo 写入草稿） |

演示与开发可继续用内存种子。要对客户宣称「落库到真实 Dataverse」前，必须：① 按下方建表；② 实现 Web API 仓储；③ 把种子写入环境。

---

## 必建表（5 张）

前缀示例 `crmai_`（以环境发布商为准，**列语义保持一致**）。

| 逻辑名 | 显示名 | 角色 | 种子要求 |
| --- | --- | --- | --- |
| `crmai_account` | 客户 | VT 替身 · 画像查询 | ≥ 仁济 + 1～3 家 |
| `crmai_contact` | 联系人 | 关联客户 | 仁济 → 张主任 |
| `crmai_activity` | 活动/拜访 | AI 草稿操作面 + syncstatus | 初始可空 |
| `crmai_opportunity` | 商机 | 种子既有行 + AI 草稿行 | **必含** 仁济 N17 Identify（`SAP-OPP-N17`） |
| `crmai_aiinvocationlog` | AI 调用日志 | 治理 / Prompt 版本 | 运行时写入 |

### 全局 Choice（建表前先建）

#### `crmai_syncstatus`

| Value | Label | 说明 |
| --- | ---: | --- |
| 100000000 | draft | AI 草稿 |
| 100000001 | confirmed | 用户已确认 |
| 100000002 | synced | **模拟**已回写 SAP |
| 100000003 | discarded | 用户拒绝 |

> 前端另有 `Syncing` / `SyncFailed` 演示态；**非验收硬项**。若要做失败演示，可再加两值。

#### `crmai_activitytype`

| Value | Label |
| --- | ---: |
| 100000000 | Visit |
| 100000001 | Call |
| 100000002 | Demo |
| 100000003 | FollowUp |

#### `crmai_oppstage`

| Value | Label |
| --- | ---: |
| 100000000 | Identify |
| 100000001 | Qualify |
| 100000002 | Propose |
| 100000003 | Negotiate |
| 100000004 | Closed |

---

### 1. `crmai_account` · 客户（必建）

| 显示名 | 逻辑名 | 类型 | 必填 | 说明 | 种子 ↔ 代码字段 |
| --- | --- | --- | --- | --- | --- |
| 客户 | `crmai_accountid` | GUID PK | 是 | | `id` |
| 名称 | `crmai_name` | Text (200) | 是 | 主字段 | `name` |
| 外部键 | `crmai_externalkey` | Text (100) | 是 | 建议 Alternate Key | `externalKey`（如 `SAP-ACC-RENJI`） |
| 区域 | `crmai_region` | Text (50) | 否 | | `region` |
| 信用等级 | `crmai_creditlevel` | Text (20) | 否 | A/B/C | `creditLevel` |
| 上次拜访 | `crmai_lastvisitat` | DateTime | 否 | | `lastVisitAt` |
| 近30天拜访数 | `crmai_visitcount30d` | Whole number | 否 | | `visitCount30d` |
| NPS 变化 | `crmai_npsdelta` | Text (20) | 否 | | `npsDelta` |
| 已签 MSA | `crmai_hasmsa` | Two options | 否 | | `hasMsa` |
| 摘要备注 | `crmai_notes` | Memo | 否 | 画像兜底 | `notes` |

---

### 2. `crmai_contact` · 联系人（必建）

| 显示名 | 逻辑名 | 类型 | 必填 | 说明 | 种子 ↔ 代码字段 |
| --- | --- | --- | --- | --- | --- |
| 联系人 | `crmai_contactid` | GUID PK | 是 | | `id` |
| 名称 | `crmai_name` | Text (100) | 是 | 如「张主任」 | `name` |
| 客户 | `crmai_accountid` | Lookup → account | 是 | | `accountId` |
| 职位 | `crmai_title` | Text (100) | 否 | | `title` |
| 电话 | `crmai_phone` | Text (50) | 否 | | `phone` |
| 外部键 | `crmai_externalkey` | Text (100) | 否 | | `externalKey` |

---

### 3. `crmai_activity` · 活动/拜访（必建 · AI 操作面）

| 显示名 | 逻辑名 | 类型 | 必填 | 说明 | 代码字段 |
| --- | --- | --- | --- | --- | --- |
| 活动 | `crmai_activityid` | GUID PK | 是 | | `id` |
| 主题 | `crmai_name` / `crmai_subject` | Text (200) | 是 | 可用 name 作主字段 | `subject` |
| 客户 | `crmai_accountid` | Lookup → account | 否* | 命中种子则填 | `accountId` |
| 客户名称快照 | `crmai_accountname` | Text (200) | 是 | 抽取兜底 | `accountName` |
| 联系人 | `crmai_contactid` | Lookup → contact | 否 | | `contactId` |
| 联系人名称 | `crmai_contactname` | Text (100) | 否 | | `contactName` |
| 类型 | `crmai_type` | Choice → activitytype | 是 | Visit… | `visitType` |
| 发生时间 | `crmai_occurredat` | DateTime | 否 | | `occurredAt` |
| 计划开始/结束 | `crmai_scheduledstart` / `end` | DateTime | 否 | | `scheduledStart` / `scheduledEnd` |
| 摘要 | `crmai_summary` | Memo | 是 | | `summary` |
| 下次跟进 | `crmai_nextfollowupat` | Date Only | 否 | | `followUpAt` |
| 原始转写 | `crmai_sourcetranscript` | Memo | 是 | | `transcript` |
| 同步状态 | `crmai_syncstatus` | Choice | 是 | 默认 draft | `syncStatus` |
| 置信度 | `crmai_confidence` | Decimal 0–1 | 是 | | `confidence` |
| 产出 Agent | `crmai_createdbyagent` | Text (100) | 是 | | `agentName` |
| 来源 JSON | `crmai_sourcesjson` | Memo | 否 | Envelope sources | `sources` → JSON |
| 幂等键 | `crmai_idempotencykey` | Text (100) | 是 | **Alternate Key** | `idempotencyKey` |
| 模拟外部 ID | `crmai_sapexternalid` | Text (100) | 否 | synced 后可填 | `sapExternalId` |
| 会话键 | `crmai_sessionkey` | Text (100) | 否 | | `sessionKey` |
| Prompt 版本 | `crmai_promptversion` | Text (50) | 否 | 如 `demo-deepseek-v1` | `promptVersion` |

\* Lookup 在种子客户命中时填写，便于 `sources` 指向真实 GUID。

**写入状态机：**

```
draft ──Confirm──► confirmed ──(短延迟模拟)──► synced
  │
  └──Discard──► discarded
```

---

### 4. `crmai_opportunity` · 商机（必建 · 种子 + 草稿）

| 显示名 | 逻辑名 | 类型 | 必填 | 说明 | 代码字段 |
| --- | --- | --- | --- | --- | --- |
| 商机 | `crmai_opportunityid` | GUID PK | 是 | | `id` |
| 名称 | `crmai_name` | Text (200) | 是 | | `name` |
| 客户 | `crmai_accountid` | Lookup → account | 是* | 种子必填 | `accountId` |
| 客户名称 | `crmai_accountname` | Text (200) | 否 | 快照 | `accountName` |
| 产品线 | `crmai_productline` | Text (100) | 是 | 监护仪 | `productLine` |
| 产品型号 | `crmai_productmodel` | Text (100) | 否 | N17 | `productModel` |
| 数量 | `crmai_quantity` | Whole number | 否 | | `quantity` |
| 金额 | `crmai_amount` | Currency / Decimal | 否 | | `amount` / 草稿 `estimatedValue` |
| 货币代码 | `crmai_currencycode` | Text (3) | 否 | USD | `currencyCode` |
| 阶段 | `crmai_stage` | Choice → oppstage | 是 | | `stage` |
| 信心分 | `crmai_confidencescore` | Decimal 0–1 | 否 | | `confidenceScore` / 草稿 `confidence` |
| 预计成交 | `crmai_closedate` | Date Only | 否 | | `closeDate` |
| 同步状态 | `crmai_syncstatus` | Choice | 否** | 种子可 synced；草稿必 draft | `syncStatus` |
| 是否追加既有 | `crmai_reuseexisting` | Two options | 否 | | `reuseExisting` |
| 既有商机 | `crmai_existingopportunityid` | Lookup → opportunity | 否 | 自关联 | `existingOpportunityId` |
| 督导提示 JSON | `crmai_supervisorhints` | Memo | 否 | `string[]` | `supervisorHints` |
| 来源活动 | `crmai_linkedactivityid` | Lookup → activity | 否 | | `linkedActivityId` |
| 幂等键 | `crmai_idempotencykey` | Text (100) | 条件 | 草稿行必填 + AK | `idempotencyKey` |
| 产出 Agent | `crmai_createdbyagent` | Text (100) | 否 | 草稿填写 | `createdByAgent` / `agentName` |
| 来源 JSON | `crmai_sourcesjson` | Memo | 否 | | `sourcesJson` |
| 原始转写/备注 | `crmai_notes` | Memo | 否 | | — |
| 外部键 | `crmai_externalkey` | Text (100) | 否 | 种子 `SAP-OPP-N17` | `externalKey` |

\* 草稿客户未解析时可暂空 Lookup，仅填名称。  
\** 种子「正式」商机可不走草稿机；AI 新建行必须有 syncstatus。

**种子必含：** 仁济 · 监护仪 N17 · Identify · `externalKey=SAP-OPP-N17`（场景 A 督导「建议关联而非新建」）。

---

### 5. `crmai_aiinvocationlog` · 调用日志（必建）

| 显示名 | 逻辑名 | 类型 | 必填 | 说明 | 代码字段 |
| --- | --- | --- | --- | --- | --- |
| 日志 | `crmai_aiinvocationlogid` | GUID PK | 是 | | `id` |
| 名称 | `crmai_name` | Text (200) | 是 | `{agent}-{time}` | 可由 agent+时间合成 |
| 会话 ID | `crmai_sessionid` | Text (100) | 否 | | `sessionId` |
| Agent 名 | `crmai_agentname` | Text (100) | 是 | | `agentName` |
| 输入摘要 | `crmai_inputsummary` | Memo | 是 | 话术截断 | `inputSummary` |
| 输出信封 | `crmai_outputenvelope` | Memo | 否 | Envelope JSON | `outputEnvelope` |
| 耗时 ms | `crmai_latencyms` | Whole number | 是 | | `latencyMs` |
| 成功 | `crmai_success` | Two options | 是 | | `success` |
| 置信度 | `crmai_confidence` | Decimal | 否 | | `confidence` |
| 错误 | `crmai_errormessage` | Memo | 否 | | `errorMessage` |
| Prompt 版本 | `crmai_promptversion` | Text (50) | 否 | | `promptVersion` |
| 模型名 | `crmai_modelname` | Text (100) | 否 | 如 `deepseek-chat` | `modelName` |

---

## 选建表（场景 C / 增强）

当前 **内存种子已灌** order / shipment；会话在内存 `Map`。接真 Dataverse 时按需建。

### `crmai_order`（选建 · 场景 C）

| 逻辑名 | 类型 | 代码字段 |
| --- | --- | --- |
| `crmai_orderid` | GUID PK | `id` |
| `crmai_name` | Text | `name` |
| `crmai_accountid` | Lookup → account | `accountId` |
| `crmai_externalkey` | Text | `externalKey` |
| `crmai_status` | Text | `status` |
| `crmai_orderedat` | Date | `orderedAt` |
| `crmai_amount` | Currency | `amount` |
| （建议）`crmai_currencycode` | Text (3) | `currencyCode` |

### `crmai_shipment`（选建 · 场景 C）

| 逻辑名 | 类型 | 代码字段 |
| --- | --- | --- |
| `crmai_shipmentid` | GUID PK | `id` |
| `crmai_name` | Text | `name` |
| `crmai_orderid` | Lookup → order | `orderId` |
| `crmai_status` | Text | `status` |
| `crmai_eta` | Date | `eta` |
| `crmai_trackingno` | Text | `trackingNo` |

### `crmai_conversation`（选建 · 多轮 Shared Memory）

| 逻辑名 | 类型 | 代码字段 |
| --- | --- | --- |
| `crmai_conversationid` | GUID PK | `id` |
| `crmai_sessionkey` | Text AK | `sessionKey` |
| `crmai_contextjson` | Memo | `contextJson` |
| `crmai_messagesjson` | Memo | `messagesJson` |
| `crmai_lastmessageat` | DateTime | `lastMessageAt` |

Demo 可仅用服务端内存 / 前端 localStorage，**不阻塞验收**。

---

## 明确不建（Demo）

| 不建 | 原因 |
| --- | --- |
| 任何 `*_vt` Virtual Table | 无真实 SAP VT |
| 独立 `aimetadata` 大表 | Prompt 版本落在 log / activity |
| `offlineutterance` | 不做多设备离线补传 |
| Service Bus / APIM 实体 | `synced` 状态模拟即可 |

---

## 关系（最小）

```
crmai_account 1──* crmai_contact
crmai_account 1──* crmai_activity
crmai_account 1──* crmai_opportunity
crmai_activity 0..1──0..1 crmai_opportunity（linked）
crmai_opportunity 自关联（reuse existing）
crmai_account 1──* crmai_order（选）
crmai_order 1──* crmai_shipment（选）
```

---

## Maker 检查清单

### 必做

- [ ] Choice：`crmai_syncstatus` / `crmai_activitytype` / `crmai_oppstage`
- [ ] 表：account、contact、activity、opportunity、aiinvocationlog
- [ ] activity / opportunity 草稿：`idempotencykey` Alternate Key
- [ ] 种子：仁济 + 张主任 + N17（`SAP-OPP-N17`）
- [ ] 安全角色：演示账号与 API 应用用户（account/contact 读；activity/opportunity 读写草稿；log 创建+读）
- [ ] （接真库时）Web API：读一条 account、写一条 activity draft、Confirm→synced

### 选做

- [ ] order + shipment + 仁济订单种子
- [ ] conversation 表
- [ ] Syncing / SyncFailed 增强态

### 不做

- [ ] Virtual Tables
- [ ] Service Bus / 真实 SAP 回写
- [ ] offlineutterance / 独立 aimetadata

---

## 与代码对照

| 前端 / 服务端类型 | Dataverse 表 |
| --- | --- |
| `AccountRecord` | `crmai_account` |
| `ContactRecord` | `crmai_contact` |
| `ActivityDraft` | `crmai_activity` |
| `OpportunityDraft` / `OpportunityRecord` | `crmai_opportunity` |
| `InvocationLog` | `crmai_aiinvocationlog` |
| `OrderRecord` / `ShipmentRecord` | 选建 order / shipment |
| `ConversationRecord` | 选建 conversation |
| `SourceRef` | 写入 `sourcesjson`，`entity`+`id` 指向 DV GUID |

详细列说明与生产接轨见 [docs/13](../docs/13-dataverse-table-spec.md)。
