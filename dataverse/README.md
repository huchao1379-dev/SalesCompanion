# Dataverse（Demo）

- 表字段规格：[`docs/13-dataverse-table-spec.md`](../docs/13-dataverse-table-spec.md)
- 种子数据：[`seed/seed.json`](seed/seed.json)

当前 API 默认把 `seed.json` 载入**内存 Dataverse 替身**（普通表语义）。  
配置 `DATAVERSE_URL` + `DATAVERSE_TOKEN` 后可改为真实 Web API（接口面保持不变）。

## 必建表

`crmai_account` · `crmai_contact` · `crmai_activity` · `crmai_opportunity` · `crmai_aiinvocationlog`

## 选建表

`crmai_order` · `crmai_shipment` · `crmai_conversation`
