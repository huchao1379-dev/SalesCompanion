import { z } from 'zod'
import {
  accountIdArgsSchema,
  searchAccountsArgsSchema,
} from '../llm/schemas.js'
import type { ChatTool } from '../llm/deepseek.js'
import * as dataTools from './dataverseTools.js'

const searchAccounts: ChatTool = {
  name: 'search_accounts',
  description: '按客户名称或别名查找客户。只返回 CRM 中存在的匹配项。',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: '客户名称或用户提到的别名' } },
    required: ['query'],
    additionalProperties: false,
  },
  inputSchema: searchAccountsArgsSchema,
  async execute(input) {
    const { query } = searchAccountsArgsSchema.parse(input)
    return {
      matches: (await dataTools.searchAccounts(query)).slice(0, 5).map((account) => ({
        id: account.id,
        name: account.name,
        externalKey: account.externalKey,
      })),
    }
  },
}

const getAccountProfile: ChatTool = {
  name: 'get_account_profile',
  description: '按客户 ID 读取客户信用、拜访、联系人和开放商机事实。',
  parameters: {
    type: 'object',
    properties: { accountId: { type: 'string', description: 'search_accounts 返回的客户 ID' } },
    required: ['accountId'],
    additionalProperties: false,
  },
  inputSchema: accountIdArgsSchema,
  async execute(input) {
    const { accountId } = accountIdArgsSchema.parse(input)
    const data = await dataTools.getAccountProfileData(accountId)
    if (!data) return { error: 'Account not found' }
    return {
      account: {
        id: data.account.id,
        name: data.account.name,
        externalKey: data.account.externalKey,
        region: data.account.region,
        creditLevel: data.account.creditLevel,
        lastVisitAt: data.account.lastVisitAt,
        visitCount30d: data.account.visitCount30d,
        npsDelta: data.account.npsDelta,
        hasMsa: data.account.hasMsa,
        notes: data.account.notes,
      },
      contacts: data.contacts.map(({ id, name, title }) => ({ id, name, title })),
      opportunities: data.opportunities.map((opportunity) => ({
        id: opportunity.id,
        externalKey: opportunity.externalKey,
        name: opportunity.name,
        productLine: opportunity.productLine,
        productModel: opportunity.productModel,
        stage: opportunity.stage,
        amount: opportunity.amount,
        currencyCode: opportunity.currencyCode,
        updatedAt: opportunity.updatedAt,
        createdAt: opportunity.createdAt,
        isSeed: opportunity.isSeed ?? true,
      })),
    }
  },
}

const getOrderLogistics: ChatTool = {
  name: 'get_order_logistics',
  description: '按客户名称查询订单和最近订单的物流信息。',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: '客户名称或别名' } },
    required: ['query'],
    additionalProperties: false,
  },
  inputSchema: searchAccountsArgsSchema,
  async execute(input) {
    const { query } = searchAccountsArgsSchema.parse(input)
    const result = await dataTools.getOrderLogistics(query)
    if (!result) return { error: 'Account not found' }
    return {
      account: {
        id: result.account.id,
        name: result.account.name,
        externalKey: result.account.externalKey,
      },
      orders: result.orders,
      latestOrder: result.latestOrder ?? null,
      shipment: result.shipment ?? null,
    }
  },
}

export const accountQueryTools: ChatTool[] = [searchAccounts, getAccountProfile]
export const orderQueryTools: ChatTool[] = [searchAccounts, getOrderLogistics]

export const accountProfileToolResultSchema = z.object({
  account: z.object({
    id: z.string(),
    externalKey: z.string(),
    name: z.string(),
    region: z.string(),
    creditLevel: z.string(),
    lastVisitAt: z.string().optional(),
    visitCount30d: z.number(),
    npsDelta: z.string().optional(),
    hasMsa: z.boolean(),
    notes: z.string().optional(),
  }),
  contacts: z.array(z.object({
    id: z.string(),
    name: z.string(),
    title: z.string().optional(),
  })),
  opportunities: z.array(z.object({
    id: z.string(),
    externalKey: z.string().optional(),
    name: z.string(),
    productLine: z.string(),
    productModel: z.string().optional(),
    stage: z.string(),
    amount: z.number(),
    currencyCode: z.string(),
    updatedAt: z.string().optional(),
    createdAt: z.string().optional(),
    isSeed: z.boolean().optional(),
  })),
})

export const orderLogisticsToolResultSchema = z.object({
  account: z.object({ id: z.string(), name: z.string(), externalKey: z.string() }),
  orders: z.array(z.object({
    id: z.string(),
    externalKey: z.string(),
    name: z.string(),
    accountId: z.string(),
    status: z.string(),
    orderedAt: z.string(),
    amount: z.number(),
    currencyCode: z.string(),
  })),
  latestOrder: z.object({
    id: z.string(),
    externalKey: z.string(),
    name: z.string(),
    accountId: z.string(),
    status: z.string(),
    orderedAt: z.string(),
    amount: z.number(),
    currencyCode: z.string(),
  }).nullable(),
  shipment: z.object({
    id: z.string(),
    orderId: z.string(),
    name: z.string(),
    status: z.string(),
    eta: z.string(),
    trackingNo: z.string(),
  }).nullable(),
})
