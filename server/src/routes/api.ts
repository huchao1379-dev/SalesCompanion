import { Router } from 'express'
import { config, hasCopilotStudioConfig, hasDeepSeek, hasVisionModel } from '../config.js'
import { CopilotStudioConfigurationError, copilotStudioOrchestrate } from '../copilotStudio.js'
import { orchestrate } from '../orchestrator.js'
import { repository } from '../store/dataverseStore.js'
import { resolveAccount, synthesizeAccountProfile } from '../agents/accountProfile.js'
import { getCatalogSummary, ensureAgentsRegistered } from '../agents/catalog.js'
import { generateActivityInsight } from '../agents/activityInsight.agent.js'
import type { DraftPayload, OrchestratorAttachment } from '../types.js'

function normalizeAttachments(raw: unknown): OrchestratorAttachment[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      name: String(item.name || 'attachment').slice(0, 120),
      mimeType: String(item.mimeType || 'application/octet-stream').slice(0, 80),
      dataBase64: String(item.dataBase64 || ''),
    }))
    .filter((item) => item.dataBase64.length > 0)
    .slice(0, 5)
}

export const apiRouter = Router()

apiRouter.get('/health', async (_req, res) => {
  ensureAgentsRegistered()
  res.json({
    ok: true,
    aiProvider: config.aiProvider,
    deepseek: hasDeepSeek(),
    vision: hasVisionModel(),
    visionModel: hasVisionModel() ? config.visionModel : undefined,
    copilotstudio: hasCopilotStudioConfig(),
    dataverseRemote: repository.mode === 'dataverse-webapi',
    dataverseMode: repository.mode,
    promptVersion: config.promptVersion,
    accounts: (await repository.listAccounts()).length,
    agents: getCatalogSummary().length,
  })
})

/** Unified agent management entry — list registered Domain Agents. */
apiRouter.get('/agents', (_req, res) => {
  res.json({ agents: getCatalogSummary() })
})

async function handleOrchestrate(req: import('express').Request, res: import('express').Response, useCopilotStudio = false) {
  try {
    const utterance = String(req.body?.utterance || '').trim()
    const attachments = normalizeAttachments(req.body?.attachments)
    if (!utterance && attachments.length === 0) {
      res.status(400).json({ error: 'utterance or attachments required' })
      return
    }
    const payload = {
      utterance: utterance || '请根据附件内容协助处理',
      locale: req.body?.locale,
      context: req.body?.context,
      turnId: typeof req.body?.turnId === 'string' ? req.body.turnId.slice(0, 100) : undefined,
      attachments: attachments.length ? attachments : undefined,
    }
    const result = useCopilotStudio
      ? await copilotStudioOrchestrate(payload)
      : await orchestrate(payload)
    res.json(result)
  } catch (err) {
    await repository.writeLog({
      agentName: 'Orchestrator',
      inputSummary: String(req.body?.utterance || ''),
      latencyMs: 0,
      success: false,
      errorMessage: err instanceof Error ? err.message : 'unknown',
    })
    const status = err instanceof CopilotStudioConfigurationError ? 503 : 500
    res.status(status).json({ error: err instanceof Error ? err.message : 'orchestrate failed' })
  }
}

apiRouter.post('/orchestrate', (req, res) => handleOrchestrate(req, res))
/** Explicit Copilot Studio SDK endpoint. DeepSeek remains available through /orchestrate when enabled. */
apiRouter.post('/copilot/message', (req, res) => handleOrchestrate(req, res, true))

/** Activity detail → AI 洞察（商机完成状况 + 近期拜访 + 结果 → 中文建议） */
apiRouter.post('/activity-insight', async (req, res) => {
  try {
    const activity = req.body?.activity
    if (!activity || typeof activity !== 'object' || !String(activity.orgName || '').trim()) {
      res.status(400).json({ error: 'activity.orgName required' })
      return
    }
    const result = await generateActivityInsight({
      activity: {
        id: String(activity.id || 'activity'),
        title: String(activity.title || ''),
        type: String(activity.type || 'visit'),
        status: String(activity.status || ''),
        time: activity.time ? String(activity.time) : undefined,
        location: activity.location ? String(activity.location) : undefined,
        orgName: String(activity.orgName),
        orgIndustry: activity.orgIndustry ? String(activity.orgIndustry) : undefined,
        notes: activity.notes ? String(activity.notes) : undefined,
        contacts: Array.isArray(activity.contacts)
          ? activity.contacts
              .filter((c: unknown) => c && typeof c === 'object')
              .map((c: { name?: string; role?: string }) => ({
                name: String(c.name || ''),
                role: c.role ? String(c.role) : undefined,
              }))
              .filter((c: { name: string }) => c.name)
          : undefined,
      },
      recentVisits: Array.isArray(req.body?.recentVisits)
        ? req.body.recentVisits
            .filter((v: unknown) => v && typeof v === 'object')
            .map((v: { title?: string; time?: string; status?: string; notes?: string }) => ({
              title: String(v.title || ''),
              time: v.time ? String(v.time) : undefined,
              status: v.status ? String(v.status) : undefined,
              notes: v.notes ? String(v.notes) : undefined,
            }))
            .filter((v: { title: string }) => v.title)
        : undefined,
      refreshNonce:
        typeof req.body?.refreshNonce === 'string'
          ? req.body.refreshNonce.slice(0, 64)
          : undefined,
    })
    res.json(result)
  } catch (err) {
    await repository.writeLog({
      agentName: 'ActivityInsight',
      inputSummary: String(req.body?.activity?.title || req.body?.activity?.orgName || ''),
      latencyMs: 0,
      success: false,
      errorMessage: err instanceof Error ? err.message : 'unknown',
    })
    res.status(500).json({ error: err instanceof Error ? err.message : 'activity insight failed' })
  }
})

apiRouter.get('/drafts', async (_req, res) => {
  res.json({ drafts: await repository.listAllDrafts() })
})

apiRouter.put('/drafts/:key', async (req, res) => {
  const key = req.params.key
  const body = req.body as DraftPayload
  if (!body || body.idempotencyKey !== key) {
    res.status(400).json({ error: 'idempotencyKey mismatch' })
    return
  }
  if (body.kind === 'activity') {
    res.json(await repository.upsertActivity(body))
    return
  }
  res.json(await repository.upsertOpportunityDraft(body))
})

apiRouter.post('/drafts/:key/confirm', async (req, res) => {
  try {
    const fail = Boolean(req.body?.fail)
    const draft = await repository.confirmAndSync(req.params.key, { fail })
    if (!draft) {
      res.status(404).json({ error: 'not found' })
      return
    }
    res.json(draft)
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'not found' })
  }
})

apiRouter.post('/drafts/:key/discard', async (req, res) => {
  const draft = await repository.discardDraft(req.params.key)
  if (!draft) {
    res.status(404).json({ error: 'not found' })
    return
  }
  res.json(draft)
})

apiRouter.get('/metrics', async (_req, res) => {
  res.json(await repository.computeMetrics())
})

apiRouter.get('/opportunities', async (_req, res) => {
  const opportunities = await repository.listOpportunities()
  const items = await Promise.all(opportunities.map(async (opp) => {
    const [account, contacts] = await Promise.all([
      repository.getAccount(opp.accountId),
      repository.getContactsForAccount(opp.accountId),
    ])
    const contact = contacts[0]
    return {
      ...opp,
      accountExternalKey: account?.externalKey,
      accountLastVisitAt: account?.lastVisitAt,
      accountVisitCount30d: account?.visitCount30d,
      accountNpsDelta: account?.npsDelta,
      accountNotes: account?.notes,
      primaryContact: contact
        ? { name: contact.name, title: contact.title || '' }
        : null,
      // Seed CRM records do not carry an official win-rate forecast field.
      crmWinProbability: null as number | null,
      ownerName: null as string | null,
    }
  }))
  res.json({
    opportunities: items,
    dataSource: repository.mode,
    note: '管线来自 Dataverse 种子/内存库；无 CRM 赢单预测字段时前端应显示「暂无可靠预测」。',
  })
})

apiRouter.get('/accounts', async (_req, res) => {
  res.json({ accounts: await repository.listAccounts() })
})

apiRouter.get('/accounts/:id', async (req, res) => {
  const account = await repository.getAccount(req.params.id) || await resolveAccount(req.params.id)
  if (!account) {
    res.status(404).json({ error: 'account not found' })
    return
  }
  const { message: profileMsg, mode: profileMode } = await synthesizeAccountProfile(account)
  const [orders, activitiesAll, opportunityDraftsAll, contacts, opportunities] = await Promise.all([
    repository.getOrdersForAccount(account.id),
    repository.listActivityDrafts(),
    repository.listOpportunityDrafts(),
    repository.getContactsForAccount(account.id),
    repository.getOpportunitiesForAccount(account.id),
  ])
  const shipments = (await Promise.all(orders.map((o) => repository.getShipmentForOrder(o.id))))
    .filter((shipment) => shipment !== undefined)
  const activities = activitiesAll.filter(
      (a) =>
        a.accountId === account.id ||
        a.accountRef === account.externalKey ||
        a.accountName === account.name,
    )
  const opportunityDrafts = opportunityDraftsAll.filter(
      (d) =>
        d.accountId === account.id ||
        d.accountRef === account.externalKey ||
        d.accountName === account.name,
    )
  res.json({
    account,
    contacts,
    opportunities: opportunities.map((opp) => ({
      ...opp,
      // Seed CRM records do not carry an official win-rate forecast field.
      crmWinProbability: null as number | null,
      ownerName: null as string | null,
      nextAction: null as { label: string; dueAt: string } | null,
    })),
    opportunityDrafts,
    orders,
    shipments,
    activities,
    profile: profileMsg,
    meta: {
      dataSource: repository.mode,
      profileMode,
      asOf: new Date().toISOString(),
      // Fields not yet modeled in seed / Dataverse demo tables
      missingFields: [
        'accountType',
        'accountStatus',
        'ownerName',
        'address',
        'contact.department',
        'contact.role',
        'contact.lastContactAt',
        'crmWinProbability',
        'equipmentInstalled',
        'serviceTickets',
      ],
      note: '客户画像读路径来自 Dataverse 种子/内存库；缺失字段前端应显示「待补充」，不可编造。',
    },
  })
})

apiRouter.get('/orders', async (req, res) => {
  const q = String(req.query.account || '')
  const account = q ? await resolveAccount(q) || await repository.getAccount(q) : undefined
  if (!account) {
    const [orders, shipments] = await Promise.all([repository.listOrders(), repository.listShipments()])
    res.json({ orders, shipments })
    return
  }
  const orders = await repository.getOrdersForAccount(account.id)
  const shipments = (await Promise.all(orders.map((o) => repository.getShipmentForOrder(o.id))))
    .filter((shipment) => shipment !== undefined)
  res.json({ account, orders, shipments })
})

apiRouter.get('/logs', async (_req, res) => {
  res.json({ logs: await repository.listLogs(50) })
})

apiRouter.get('/conversations/:sessionKey', async (req, res) => {
  const conv = await repository.getConversation(req.params.sessionKey)
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

apiRouter.post('/seed/reload', async (_req, res) => {
  res.json({ ok: true, accounts: await repository.reloadSeed() })
})
