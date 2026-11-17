import type { DomainAgent } from './agentTypes.js'
import { queryOrderLogistics } from './orderQuery.js'
import { resolveAccount } from './accountProfile.js'

export const orderQueryAgent: DomainAgent = {
  name: 'OrderQuery',
  displayName: '订单查询 Agent',
  description: '查询客户最近订单与物流 ETA（Dataverse 临时订单表）',
  intents: ['query_order'],
  async run(ctx) {
    const { message: orderMsg, mode } = await queryOrderLogistics(ctx.utterance)
    const account = resolveAccount(ctx.utterance) ||
      (ctx.memory.accountId
        ? resolveAccount(ctx.memory.accountId)
        : undefined)

    return {
      messages: [orderMsg],
      mode,
      memoryPatch: account
        ? {
            accountId: account.id,
            accountName: account.name,
            accountRef: account.externalKey,
          }
        : undefined,
    }
  },
}
