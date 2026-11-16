import { Router } from 'express'
import { config, hasDeepSeek, hasRemoteDataverse } from '../config.js'
import { orchestrate } from '../orchestrator.js'
import { store } from '../store/dataverseStore.js'
import { buildAccountProfileMessage, resolveAccount } from '../agents/accountProfile.js'
import type { DraftPayload } from '../types.js'

export const apiRouter = Router()

apiRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    deepseek: hasDeepSeek(),
    dataverseRemote: hasRemoteDataverse(),
    dataverseMode: hasRemoteDataverse() ? 'webapi' : 'in-memory-seed',
    promptVersion: config.promptVersion,
    accounts: store.accounts.length,
  })
})

apiRouter.post('/orchestrate', async (req, res) => {
  try {
    const utterance = String(req.body?.utterance || '').trim()
    if (!utterance) {
      res.status(400).json({ error: 'utterance required' })
      return
    }
    const result = await orchestrate({
      utterance,
      locale: req.body?.locale,
      context: req.body?.context,
    })
    res.json(result)
  } catch (err) {
    store.writeLog({
      agentName: 'Orchestrator',
      inputSummary: String(req.body?.utterance || ''),
      latencyMs: 0,
      success: false,
      errorMessage: err instanceof Error ? err.message : 'unknown',
    })
    res.status(500).json({ error: err instanceof Error ? err.message : 'orchestrate failed' })
  }
})

apiRouter.get('/drafts', (_req, res) => {
  res.json({ drafts: store.listAllDrafts() })
})

apiRouter.put('/drafts/:key', (req, res) => {
  const key = req.params.key
  const body = req.body as DraftPayload
  if (!body || body.idempotencyKey !== key) {
    res.status(400).json({ error: 'idempotencyKey mismatch' })
    return
  }
  if (body.kind === 'activity') {
    res.json(store.upsertActivity(body))
    return
  }
  res.json(store.upsertOpportunityDraft(body))
})

apiRouter.post('/drafts/:key/confirm', async (req, res) => {
  try {
    const fail = Boolean(req.body?.fail)
    const draft = await store.confirmAndSync(req.params.key, { fail })
    if (!draft) {
      res.status(404).json({ error: 'not found' })
      return
    }
    res.json(draft)
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'not found' })
  }
})

apiRouter.post('/drafts/:key/discard', (req, res) => {
  const draft = store.discardDraft(req.params.key)
  if (!draft) {
    res.status(404).json({ error: 'not found' })
    return
  }
  res.json(draft)
})

apiRouter.get('/metrics', (_req, res) => {
  res.json(store.computeMetrics())
})

apiRouter.get('/accounts', (_req, res) => {
  res.json({ accounts: store.accounts })
})

apiRouter.get('/accounts/:id', (req, res) => {
  const account = store.getAccount(req.params.id) || resolveAccount(req.params.id)
  if (!account) {
    res.status(404).json({ error: 'account not found' })
    return
  }
  const profileMsg = buildAccountProfileMessage(account)
  res.json({
    account,
    contacts: store.getContactsForAccount(account.id),
    opportunities: store.getOpportunitiesForAccount(account.id),
    orders: store.getOrdersForAccount(account.id),
    profile: profileMsg,
  })
})

apiRouter.get('/orders', (req, res) => {
  const q = String(req.query.account || '')
  const account = q ? resolveAccount(q) || store.getAccount(q) : undefined
  if (!account) {
    res.json({ orders: store.orders, shipments: store.shipments })
    return
  }
  const orders = store.getOrdersForAccount(account.id)
  const shipments = orders
    .map((o) => store.getShipmentForOrder(o.id))
    .filter(Boolean)
  res.json({ account, orders, shipments })
})

apiRouter.get('/logs', (_req, res) => {
  res.json({ logs: store.logs.slice(0, 50) })
})

apiRouter.get('/conversations/:sessionKey', (req, res) => {
  const conv = store.getConversation(req.params.sessionKey)
  if (!conv) {
    res.status(404).json({ error: 'not found' })
    return
  }
  res.json({
    ...conv,
    context: JSON.parse(conv.contextJson),
    messages: JSON.parse(conv.messagesJson),
  })
})

apiRouter.post('/seed/reload', (_req, res) => {
  store.loadSeed()
  res.json({ ok: true, accounts: store.accounts.length })
})
