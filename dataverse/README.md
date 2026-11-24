# Dataverse（运行时唯一数据源）

> 权威规格：[docs/13-dataverse-table-spec.md](../docs/13-dataverse-table-spec.md)  
> 范围矩阵：[docs/15-demo-scope-matrix.md](../docs/15-demo-scope-matrix.md)

---

## 当前仓库状态

| 项 | 现状 |
| --- | --- |
| 运行时数据源 | **仅 Dataverse Web API**（`DataverseWebApiRepository`） |
| 内存种子 / `seed.json` | **已移除**；主数据以环境中的 `hc_*` 表为准 |
| 未配置凭据 | API **拒绝启动** |

### 接通（server/.env）

```bash
DATAVERSE_URL=https://orgxxxxxxxx.crm.dynamics.com
DATAVERSE_PREFIX=hc
DATAVERSE_TENANT_ID=...
DATAVERSE_CLIENT_ID=...
DATAVERSE_CLIENT_SECRET=...
DATAVERSE_CHOICE_BASE=122990000
```

启动后：

- `GET /api/health` → `dataverseMode:"dataverse-webapi"`
- `GET /api/dataverse/status` → 账号数等
- `npm run dataverse:verify`（在 `server/` 下）读库校验

本环境列名差异：`hc_qunatity`、`hc_closeddate`；客户无独立 `hc_externalkey`（写在 `notes` 的 `[externalKey=…]`）。

---

## 必建表（5 张）

前缀以环境为准（当前为 `hc_`）。

| 逻辑名 | 显示名 |
| --- | --- |
| `{prefix}_account` | 客户 |
| `{prefix}_contact` | 联系人 |
| `{prefix}_activity` | 活动/拜访 |
| `{prefix}_opportunity` | 商机 |
| `{prefix}_aiinvocationlog` | AI 调用日志 |

选建：`order` / `shipment` / `conversation`。详细列见 [docs/13](../docs/13-dataverse-table-spec.md)。

应用用户须具备表读写权限。
