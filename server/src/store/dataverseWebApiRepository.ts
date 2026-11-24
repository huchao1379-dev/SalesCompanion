import { config } from '../config.js'
import { isoDateInZone, todayIsoDate } from '../util/datetime.js'
import type {
  AccountRecord,
  ActivityDraft,
  ContactRecord,
  ConversationRecord,
  InvocationLog,
  OpportunityDraft,
  OpportunityRecord,
  OrderRecord,
  ShipmentRecord,
  SyncStatus,
} from '../types.js'
import type { SalesRepository } from './repository.js'
import {
  dataverseCreate,
  dataverseGet,
  dataverseList,
  dataversePatch,
  DataverseHttpError,
  lookupBind,
  odataEscape,
} from './dataverseClient.js'
import {
  activityTypeToChoice,
  choiceToActivityType,
  choiceToOppStage,
  choiceToSyncStatus,
  col,
  entitySet,
  oppStageToChoice,
  syncStatusToChoice,
} from './dataverseSchema.js'

type Row = Record<string, unknown>

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function now() {
  return new Date().toISOString()
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function asString(value: unknown, fallback = ''): string {
  if (value == null) return fallback
  return String(value)
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  const n = Number(value)
  return Number.isNaN(n) ? fallback : n
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  return fallback
}

function parseJsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Live Dataverse Web API adapter (ordinary tables, not VT).
 * Conversations stay in-memory (optional table not required for Demo).
 */
export class DataverseWebApiRepository implements SalesRepository {
  readonly mode = 'dataverse-webapi' as const
  private readonly prefix: string
  private readonly conversations = new Map<string, ConversationRecord>()
  private optionalTablesMissing = new Set<string>()

  constructor(prefix = config.dataversePrefix) {
    this.prefix = prefix
  }

  /** Column leaf → full logical name, with live hc_* schema quirks. */
  private c(
    name: string,
    table?: 'account' | 'contact' | 'activity' | 'opportunity' | 'aiinvocationlog',
  ) {
    if (this.prefix === 'hc') {
      if (name === 'quantity') return 'hc_qunatity'
      if (name === 'closedate') return 'hc_closeddate'
      if (name === 'contactid' && table === 'activity') return 'hc_contact'
      if ((name === 'name' || name === 'subject') && table === 'activity') return 'hc_subject'
      // account.externalkey not created in Maker — encoded into notes instead
      if (name === 'externalkey' && table === 'account') return ''
    }
    return col(this.prefix, name)
  }

  private set(singular: string) {
    return entitySet(this.prefix, singular)
  }

  private pk(singular: string) {
    return `${this.prefix}_${singular}id`
  }

  private lookupValue(
    row: Row,
    field: string,
    table?: 'account' | 'contact' | 'activity' | 'opportunity',
  ): string | undefined {
    const logical = this.c(field, table)
    if (!logical) return undefined
    const key = `_${logical}_value`
    const v = row[key] ?? row[logical]
    return v ? String(v) : undefined
  }

  private extractExternalKeyFromNotes(notes?: string): string {
    if (!notes) return ''
    const match = notes.match(/\[externalKey=([^\]]+)\]/i)
    return match?.[1]?.trim() || ''
  }

  private mapAccount(row: Row): AccountRecord {
    const notes = row[this.c('notes')] ? asString(row[this.c('notes')]) : undefined
    const externalFromCol = this.c('externalkey', 'account')
      ? asString(row[this.c('externalkey', 'account')])
      : ''
    return {
      id: asString(row[this.pk('account')]),
      externalKey: externalFromCol || this.extractExternalKeyFromNotes(notes),
      name: asString(row[this.c('name')]),
      region: asString(row[this.c('region')]),
      creditLevel: asString(row[this.c('creditlevel')]),
      lastVisitAt: row[this.c('lastvisitat')]
        ? asString(row[this.c('lastvisitat')])
        : undefined,
      visitCount30d: asNumber(row[this.c('visitcount30d')]),
      npsDelta: row[this.c('npsdelta')] ? asString(row[this.c('npsdelta')]) : undefined,
      hasMsa: asBool(row[this.c('hasmsa')]),
      notes,
    }
  }

  private mapContact(row: Row): ContactRecord {
    return {
      id: asString(row[this.pk('contact')]),
      accountId: this.lookupValue(row, 'accountid', 'contact') || '',
      externalKey: row[this.c('externalkey')]
        ? asString(row[this.c('externalkey')])
        : undefined,
      name: asString(row[this.c('name')]),
      title: row[this.c('title')] ? asString(row[this.c('title')]) : undefined,
      phone: row[this.c('phone')] ? asString(row[this.c('phone')]) : undefined,
    }
  }

  private mapOpportunityRecord(row: Row): OpportunityRecord {
    const hints = parseJsonArray(row[this.c('supervisorhints')]).map(String)
    const quantityCol = this.c('quantity', 'opportunity')
    const closeCol = this.c('closedate', 'opportunity')
    return {
      id: asString(row[this.pk('opportunity')]),
      externalKey: row[this.c('externalkey')]
        ? asString(row[this.c('externalkey')])
        : undefined,
      name: asString(row[this.c('name')]),
      accountId: this.lookupValue(row, 'accountid', 'opportunity') || '',
      accountName: asString(row[this.c('accountname')]),
      productLine: asString(row[this.c('productline')]),
      productModel: row[this.c('productmodel')]
        ? asString(row[this.c('productmodel')])
        : undefined,
      quantity: asNumber(row[quantityCol]),
      amount: asNumber(row[this.c('amount')]),
      currencyCode: asString(row[this.c('currencycode')], 'USD'),
      stage: choiceToOppStage(row[this.c('stage')]),
      confidenceScore: asNumber(row[this.c('confidencescore')], 0),
      closeDate: row[closeCol]
        ? asString(row[closeCol]).slice(0, 10)
        : undefined,
      syncStatus: row[this.c('syncstatus')] != null
        ? choiceToSyncStatus(row[this.c('syncstatus')])
        : 'Synced',
      isSeed: !row[this.c('idempotencykey')],
      reuseExisting: asBool(row[this.c('reuseexisting')]),
      existingOpportunityId: this.lookupValue(row, 'existingopportunityid', 'opportunity'),
      supervisorHints: hints.length ? hints : undefined,
      linkedActivityId: this.lookupValue(row, 'linkedactivityid', 'opportunity'),
      idempotencyKey: row[this.c('idempotencykey')]
        ? asString(row[this.c('idempotencykey')])
        : undefined,
      createdByAgent: row[this.c('createdbyagent')]
        ? asString(row[this.c('createdbyagent')])
        : undefined,
      sourcesJson: row[this.c('sourcesjson')]
        ? asString(row[this.c('sourcesjson')])
        : undefined,
      createdAt: row.createdon ? asString(row.createdon) : undefined,
      updatedAt: row.modifiedon ? asString(row.modifiedon) : undefined,
    }
  }

  private mapOpportunityDraft(row: Row): OpportunityDraft {
    const record = this.mapOpportunityRecord(row)
    const sources = parseJsonArray(row[this.c('sourcesjson')]) as OpportunityDraft['sources']

    return {
      kind: 'opportunity',
      id: record.id,
      name: record.name,
      accountName: record.accountName || asString(row[this.c('accountname')]),
      accountId: record.accountId || undefined,
      accountRef: record.accountId || record.externalKey,
      productLine: record.productLine,
      productModel: record.productModel,
      quantity: record.quantity,
      estimatedValue: record.amount,
      currency: record.currencyCode || 'USD',
      stage: record.stage,
      closeDate: record.closeDate || '',
      confidence: record.confidenceScore,
      reuseExisting: Boolean(record.reuseExisting),
      existingOpportunityRef: record.existingOpportunityId,
      supervisorHints: record.supervisorHints ?? [],
      syncStatus: record.syncStatus ?? 'Draft',
      sources,
      agentName: record.createdByAgent || 'OpportunityDraftWriter',
      idempotencyKey: record.idempotencyKey || record.id,
      linkedActivityId: record.linkedActivityId,
      sapExternalId: record.externalKey,
      createdAt: record.createdAt || now(),
      updatedAt: record.updatedAt || now(),
    }
  }

  private mapActivity(row: Row): ActivityDraft {
    const sourcesRaw = asString(row[this.c('sourcesjson')])
    let sources: ActivityDraft['sources'] = []
    if (sourcesRaw) {
      try {
        const parsed = JSON.parse(sourcesRaw)
        if (Array.isArray(parsed)) sources = parsed
      } catch {
        sources = []
      }
    }
    const subjectCol = this.c('subject', 'activity')
    const subject = asString(row[subjectCol]) || asString(row[this.c('name')])
    return {
      kind: 'activity',
      id: asString(row[this.pk('activity')]),
      subject,
      summary: asString(row[this.c('summary')]),
      visitType: choiceToActivityType(row[this.c('type')]),
      accountName: asString(row[this.c('accountname')]),
      accountId: this.lookupValue(row, 'accountid', 'activity'),
      accountRef: this.lookupValue(row, 'accountid', 'activity'),
      contactName: asString(row[this.c('contactname')] || ''),
      contactId: this.lookupValue(row, 'contactid', 'activity'),
      occurredAt: row[this.c('occurredat')]
        ? asString(row[this.c('occurredat')])
        : undefined,
      scheduledStart: row[this.c('scheduledstart')]
        ? asString(row[this.c('scheduledstart')])
        : undefined,
      scheduledEnd: row[this.c('scheduledend')]
        ? asString(row[this.c('scheduledend')])
        : undefined,
      followUpAt: row[this.c('nextfollowupat')]
        ? asString(row[this.c('nextfollowupat')]).slice(0, 10)
        : '',
      transcript: asString(row[this.c('sourcetranscript')]),
      syncStatus: choiceToSyncStatus(row[this.c('syncstatus')]),
      confidence: asNumber(row[this.c('confidence')], 0),
      sources,
      agentName: asString(row[this.c('createdbyagent')], 'ActivityDraftWriter'),
      idempotencyKey: asString(row[this.c('idempotencykey')]),
      sapExternalId: row[this.c('sapexternalid')]
        ? asString(row[this.c('sapexternalid')])
        : undefined,
      sessionKey: row[this.c('sessionkey')]
        ? asString(row[this.c('sessionkey')])
        : undefined,
      promptVersion: row[this.c('promptversion')]
        ? asString(row[this.c('promptversion')])
        : undefined,
      createdAt: row.createdon ? asString(row.createdon) : now(),
      updatedAt: row.modifiedon ? asString(row.modifiedon) : now(),
    }
  }

  private mapOrder(row: Row): OrderRecord {
    return {
      id: asString(row[this.pk('order')]),
      externalKey: asString(row[this.c('externalkey')]),
      name: asString(row[this.c('name')]),
      accountId: this.lookupValue(row, 'accountid') || '',
      status: asString(row[this.c('status')]),
      orderedAt: asString(row[this.c('orderedat')]).slice(0, 10),
      amount: asNumber(row[this.c('amount')]),
      currencyCode: asString(row[this.c('currencycode')], 'USD'),
    }
  }

  private mapShipment(row: Row): ShipmentRecord {
    return {
      id: asString(row[this.pk('shipment')]),
      orderId: this.lookupValue(row, 'orderid') || '',
      name: asString(row[this.c('name')]),
      status: asString(row[this.c('status')]),
      eta: asString(row[this.c('eta')]).slice(0, 10),
      trackingNo: asString(row[this.c('trackingno')]),
    }
  }

  private mapLog(row: Row): InvocationLog {
    return {
      id: asString(row[this.pk('aiinvocationlog')]),
      sessionId: row[this.c('sessionid')]
        ? asString(row[this.c('sessionid')])
        : undefined,
      agentName: asString(row[this.c('agentname')]),
      inputSummary: asString(row[this.c('inputsummary')]),
      outputEnvelope: row[this.c('outputenvelope')]
        ? asString(row[this.c('outputenvelope')])
        : undefined,
      latencyMs: asNumber(row[this.c('latencyms')]),
      success: asBool(row[this.c('success')]),
      confidence:
        row[this.c('confidence')] != null
          ? asNumber(row[this.c('confidence')])
          : undefined,
      errorMessage: row[this.c('errormessage')]
        ? asString(row[this.c('errormessage')])
        : undefined,
      promptVersion: row[this.c('promptversion')]
        ? asString(row[this.c('promptversion')])
        : undefined,
      modelName: row[this.c('modelname')]
        ? asString(row[this.c('modelname')])
        : undefined,
      createdAt: row.createdon ? asString(row.createdon) : now(),
    }
  }

  private async listOptional<T>(
    singular: string,
    map: (row: Row) => T,
    query?: Parameters<typeof dataverseList>[1],
  ): Promise<T[]> {
    const set = this.set(singular)
    if (this.optionalTablesMissing.has(set)) return []
    try {
      const rows = await dataverseList<Row>(set, query)
      return rows.map(map)
    } catch (err) {
      if (err instanceof DataverseHttpError && (err.status === 404 || err.status === 403)) {
        this.optionalTablesMissing.add(set)
        return []
      }
      throw err
    }
  }

  async listAccounts(): Promise<AccountRecord[]> {
    const rows = await dataverseList<Row>(this.set('account'), {
      orderby: `${this.c('name')} asc`,
    })
    return rows.map((r) => this.mapAccount(r))
  }

  async listOpportunities(): Promise<OpportunityRecord[]> {
    const synced = syncStatusToChoice('Synced')
    const rows = await dataverseList<Row>(this.set('opportunity'), {
      filter: `${this.c('syncstatus')} eq ${synced} or ${this.c('syncstatus')} eq null`,
      orderby: `${this.c('name')} asc`,
    })
    return rows.map((r) => this.mapOpportunityRecord(r))
  }

  async listOrders(): Promise<OrderRecord[]> {
    return this.listOptional('order', (r) => this.mapOrder(r))
  }

  async listShipments(): Promise<ShipmentRecord[]> {
    return this.listOptional('shipment', (r) => this.mapShipment(r))
  }

  async searchAccounts(query: string): Promise<AccountRecord[]> {
    const q = query.trim()
    if (!q) return this.listAccounts()
    const escaped = odataEscape(q)
    const name = this.c('name')
    const ext = this.c('externalkey', 'account')
    const filter = ext
      ? `contains(${name},'${escaped}') or contains(${ext},'${escaped}')`
      : `contains(${name},'${escaped}') or contains(${this.c('notes')},'${escaped}')`
    const rows = await dataverseList<Row>(this.set('account'), { filter })
    const mapped = rows.map((r) => this.mapAccount(r))
    if (mapped.length) return mapped
    // Fallback: local alias match (e.g. "仁济" vs full name) against full list
    const all = await this.listAccounts()
    const lower = q.toLowerCase()
    return all.filter((a) => {
      const alias = a.externalKey.split(/[-_]/).at(-1)?.toLowerCase()
      return (
        a.name.toLowerCase().includes(lower) ||
        a.externalKey.toLowerCase().includes(lower) ||
        lower.includes(a.name.toLowerCase()) ||
        Boolean(alias && lower.includes(alias))
      )
    })
  }

  async getAccount(idOrKey: string): Promise<AccountRecord | undefined> {
    const key = idOrKey.trim()
    if (!key) return undefined
    if (/^[0-9a-f-]{36}$/i.test(key)) {
      const row = await dataverseGet<Row>(this.set('account'), key)
      return row ? this.mapAccount(row) : undefined
    }
    const escaped = odataEscape(key)
    const ext = this.c('externalkey', 'account')
    const filter = ext
      ? `${ext} eq '${escaped}' or ${this.c('name')} eq '${escaped}'`
      : `${this.c('name')} eq '${escaped}' or contains(${this.c('notes')},'${escaped}')`
    const rows = await dataverseList<Row>(this.set('account'), {
      filter,
      top: 5,
    })
    if (rows[0]) {
      const mapped = rows.map((r) => this.mapAccount(r))
      return (
        mapped.find(
          (a) =>
            a.externalKey === key ||
            a.name === key ||
            a.externalKey.toLowerCase() === key.toLowerCase(),
        ) || mapped[0]
      )
    }
    const hits = await this.searchAccounts(key)
    return hits[0]
  }

  async getContactsForAccount(accountId: string): Promise<ContactRecord[]> {
    if (!accountId) return []
    const rows = await dataverseList<Row>(this.set('contact'), {
      filter: `_${this.c('accountid')}_value eq ${accountId}`,
    })
    return rows.map((r) => this.mapContact(r))
  }

  async getOpportunitiesForAccount(accountId: string): Promise<OpportunityRecord[]> {
    if (!accountId) return []
    const synced = syncStatusToChoice('Synced')
    const rows = await dataverseList<Row>(this.set('opportunity'), {
      filter:
        `_${this.c('accountid')}_value eq ${accountId}` +
        ` and (${this.c('syncstatus')} eq ${synced} or ${this.c('syncstatus')} eq null)`,
    })
    return rows.map((r) => this.mapOpportunityRecord(r))
  }

  async findMatchingOpportunity(
    accountId: string,
    productHint?: string,
  ): Promise<OpportunityRecord | undefined> {
    const list = await this.getOpportunitiesForAccount(accountId)
    const hint = (productHint || '').toLowerCase()
    if (!hint) return list[0]
    return (
      list.find(
        (o) =>
          o.productModel?.toLowerCase().includes(hint) ||
          o.productLine.toLowerCase().includes(hint) ||
          hint.includes((o.productModel || '').toLowerCase()) ||
          o.name.toLowerCase().includes(hint),
      ) || list[0]
    )
  }

  async getOrdersForAccount(accountId: string): Promise<OrderRecord[]> {
    if (!accountId) return []
    return this.listOptional('order', (r) => this.mapOrder(r), {
      filter: `_${this.c('accountid')}_value eq ${accountId}`,
    })
  }

  async getShipmentForOrder(orderId: string): Promise<ShipmentRecord | undefined> {
    if (!orderId) return undefined
    const rows = await this.listOptional('shipment', (r) => this.mapShipment(r), {
      filter: `_${this.c('orderid')}_value eq ${orderId}`,
      top: 1,
    })
    return rows[0]
  }

  async listActivityDrafts(): Promise<ActivityDraft[]> {
    const rows = await dataverseList<Row>(this.set('activity'), {
      orderby: 'modifiedon desc',
    })
    return rows
      .map((r) => this.mapActivity(r))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async listOpportunityDrafts(): Promise<OpportunityDraft[]> {
    const rows = await dataverseList<Row>(this.set('opportunity'), {
      filter: `${this.c('idempotencykey')} ne null`,
      orderby: 'modifiedon desc',
    })
    return rows
      .map((r) => this.mapOpportunityDraft(r))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async listAllDrafts(): Promise<Array<ActivityDraft | OpportunityDraft>> {
    const [activities, opps] = await Promise.all([
      this.listActivityDrafts(),
      this.listOpportunityDrafts(),
    ])
    return [...activities, ...opps]
  }

  private async findActivityByKey(idempotencyKey: string): Promise<ActivityDraft | undefined> {
    const escaped = odataEscape(idempotencyKey)
    const rows = await dataverseList<Row>(this.set('activity'), {
      filter: `${this.c('idempotencykey')} eq '${escaped}'`,
      top: 1,
    })
    return rows[0] ? this.mapActivity(rows[0]) : undefined
  }

  private async findOpportunityDraftByKey(
    idempotencyKey: string,
  ): Promise<OpportunityDraft | undefined> {
    const escaped = odataEscape(idempotencyKey)
    const rows = await dataverseList<Row>(this.set('opportunity'), {
      filter: `${this.c('idempotencykey')} eq '${escaped}'`,
      top: 1,
    })
    return rows[0] ? this.mapOpportunityDraft(rows[0]) : undefined
  }

  private activityBody(draft: ActivityDraft): Row {
    const subjectCol = this.c('subject', 'activity')
    const contactLookup = this.c('contactid', 'activity')
    const body: Row = {
      [subjectCol]: draft.subject,
      [this.c('accountname')]: draft.accountName,
      [this.c('type')]: activityTypeToChoice(draft.visitType || 'Visit'),
      [this.c('occurredat')]: draft.occurredAt || null,
      [this.c('scheduledstart')]: draft.scheduledStart || null,
      [this.c('scheduledend')]: draft.scheduledEnd || null,
      [this.c('summary')]: draft.summary,
      [this.c('nextfollowupat')]: draft.followUpAt || null,
      [this.c('sourcetranscript')]: draft.transcript,
      [this.c('syncstatus')]: syncStatusToChoice(draft.syncStatus),
      [this.c('confidence')]: draft.confidence,
      [this.c('createdbyagent')]: draft.agentName,
      [this.c('sourcesjson')]: JSON.stringify(draft.sources ?? []),
      [this.c('idempotencykey')]: draft.idempotencyKey,
      [this.c('sapexternalid')]: draft.sapExternalId || null,
      [this.c('sessionkey')]: draft.sessionKey || null,
      [this.c('promptversion')]: draft.promptVersion || config.promptVersion,
    }
    // live hc_* schema has no hc_contactname column
    if (this.prefix !== 'hc') {
      body[this.c('contactname')] = draft.contactName || null
    }
    if (draft.accountId) {
      body[`${this.c('accountid')}@odata.bind`] = lookupBind(
        this.set('account'),
        draft.accountId,
      )
    }
    if (draft.contactId) {
      body[`${contactLookup}@odata.bind`] = lookupBind(
        this.set('contact'),
        draft.contactId,
      )
    }
    return body
  }

  private opportunityDraftBody(draft: OpportunityDraft): Row {
    const quantityCol = this.c('quantity', 'opportunity')
    const closeCol = this.c('closedate', 'opportunity')
    const body: Row = {
      [this.c('name')]: draft.name,
      [this.c('accountname')]: draft.accountName,
      [this.c('productline')]: draft.productLine,
      [this.c('productmodel')]: draft.productModel || null,
      [quantityCol]: draft.quantity,
      [this.c('amount')]: draft.estimatedValue,
      [this.c('currencycode')]: draft.currency || 'USD',
      [this.c('stage')]: oppStageToChoice(draft.stage || 'Identify'),
      [this.c('confidencescore')]: draft.confidence,
      [closeCol]: draft.closeDate || null,
      [this.c('syncstatus')]: syncStatusToChoice(draft.syncStatus),
      [this.c('reuseexisting')]: Boolean(draft.reuseExisting),
      [this.c('supervisorhints')]: JSON.stringify(draft.supervisorHints ?? []),
      [this.c('idempotencykey')]: draft.idempotencyKey,
      [this.c('createdbyagent')]: draft.agentName,
      [this.c('sourcesjson')]: JSON.stringify(draft.sources ?? []),
      [this.c('externalkey')]: draft.sapExternalId || null,
    }
    if (draft.accountId) {
      body[`${this.c('accountid')}@odata.bind`] = lookupBind(
        this.set('account'),
        draft.accountId,
      )
    }
    if (draft.existingOpportunityRef && /^[0-9a-f-]{36}$/i.test(draft.existingOpportunityRef)) {
      body[`${this.c('existingopportunityid')}@odata.bind`] = lookupBind(
        this.set('opportunity'),
        draft.existingOpportunityRef,
      )
    }
    if (draft.linkedActivityId) {
      body[`${this.c('linkedactivityid')}@odata.bind`] = lookupBind(
        this.set('activity'),
        draft.linkedActivityId,
      )
    }
    return body
  }

  async upsertActivity(draft: ActivityDraft): Promise<ActivityDraft> {
    const existing = await this.findActivityByKey(draft.idempotencyKey)
    if (existing) {
      const row = await dataversePatch<Row>(
        this.set('activity'),
        existing.id,
        this.activityBody({ ...existing, ...draft, id: existing.id }),
      )
      return this.mapActivity(row)
    }
    const row = await dataverseCreate<Row>(this.set('activity'), this.activityBody(draft))
    return this.mapActivity(row)
  }

  async upsertOpportunityDraft(draft: OpportunityDraft): Promise<OpportunityDraft> {
    const existing = await this.findOpportunityDraftByKey(draft.idempotencyKey)
    if (existing) {
      const row = await dataversePatch<Row>(
        this.set('opportunity'),
        existing.id,
        this.opportunityDraftBody({ ...existing, ...draft, id: existing.id }),
      )
      return this.mapOpportunityDraft(row)
    }
    const row = await dataverseCreate<Row>(
      this.set('opportunity'),
      this.opportunityDraftBody(draft),
    )
    return this.mapOpportunityDraft(row)
  }

  private async getDraftByKey(
    idempotencyKey: string,
  ): Promise<ActivityDraft | OpportunityDraft | undefined> {
    return (
      (await this.findActivityByKey(idempotencyKey)) ||
      (await this.findOpportunityDraftByKey(idempotencyKey))
    )
  }

  private async patchDraftStatus(
    idempotencyKey: string,
    syncStatus: SyncStatus,
    patch?: {
      sapExternalId?: string
      confirmedAction?: 'create' | 'link_existing'
      linkedExistingOpportunityId?: string
    },
  ): Promise<ActivityDraft | OpportunityDraft | null> {
    const activity = await this.findActivityByKey(idempotencyKey)
    if (activity) {
      const body: Row = {
        [this.c('syncstatus')]: syncStatusToChoice(syncStatus),
      }
      if (patch?.sapExternalId) body[this.c('sapexternalid')] = patch.sapExternalId
      const row = await dataversePatch<Row>(this.set('activity'), activity.id, body)
      return this.mapActivity(row)
    }

    const opportunity = await this.findOpportunityDraftByKey(idempotencyKey)
    if (opportunity) {
      const body: Row = {
        [this.c('syncstatus')]: syncStatusToChoice(syncStatus),
      }
      if (patch?.sapExternalId) body[this.c('externalkey')] = patch.sapExternalId
      if (patch?.linkedExistingOpportunityId) {
        body[`${this.c('existingopportunityid')}@odata.bind`] = lookupBind(
          this.set('opportunity'),
          patch.linkedExistingOpportunityId,
        )
        body[this.c('reuseexisting')] = true
      }
      const row = await dataversePatch<Row>(this.set('opportunity'), opportunity.id, body)
      const mapped = this.mapOpportunityDraft(row)
      if (patch?.confirmedAction) mapped.confirmedAction = patch.confirmedAction
      if (patch?.linkedExistingOpportunityId) {
        mapped.linkedExistingOpportunityId = patch.linkedExistingOpportunityId
      }
      return mapped
    }
    return null
  }

  async confirmAndSync(
    idempotencyKey: string,
    options?: { fail?: boolean },
  ): Promise<ActivityDraft | OpportunityDraft | null> {
    const draft = await this.getDraftByKey(idempotencyKey)
    if (!draft) throw new Error('Draft not found')
    if (draft.syncStatus === 'Synced') return draft
    if (draft.syncStatus === 'Discarded') throw new Error('Draft already discarded')
    if (draft.reviewStatus === 'blocked') {
      throw new Error('督导存在阻断项，请先补全必填信息后再确认')
    }

    await this.patchDraftStatus(idempotencyKey, 'Confirmed')
    await this.patchDraftStatus(idempotencyKey, 'Syncing')
    await delay(700)

    if (options?.fail) {
      return this.patchDraftStatus(idempotencyKey, 'SyncFailed')
    }

    let linkedOpportunity: OpportunityRecord | undefined
    if (draft.kind === 'opportunity' && draft.reuseExisting) {
      linkedOpportunity = await this.resolveOpportunityRef(draft.existingOpportunityRef)
    }

    const synced = await this.patchDraftStatus(idempotencyKey, 'Synced', {
      sapExternalId: `SAP-${Date.now().toString(36).toUpperCase()}`,
      confirmedAction:
        draft.kind === 'opportunity'
          ? linkedOpportunity
            ? 'link_existing'
            : 'create'
          : undefined,
      linkedExistingOpportunityId: linkedOpportunity?.id,
    })

    if (synced?.kind === 'opportunity' && linkedOpportunity && synced.linkedActivityId) {
      await dataversePatch(this.set('opportunity'), linkedOpportunity.id, {
        [`${this.c('linkedactivityid')}@odata.bind`]: lookupBind(
          this.set('activity'),
          synced.linkedActivityId,
        ),
      })
    }

    return synced
  }

  private async resolveOpportunityRef(ref?: string): Promise<OpportunityRecord | undefined> {
    if (!ref) return undefined
    if (/^[0-9a-f-]{36}$/i.test(ref)) {
      const row = await dataverseGet<Row>(this.set('opportunity'), ref)
      return row ? this.mapOpportunityRecord(row) : undefined
    }
    const escaped = odataEscape(ref)
    const rows = await dataverseList<Row>(this.set('opportunity'), {
      filter:
        `${this.c('externalkey')} eq '${escaped}' or ${this.c('name')} eq '${escaped}'`,
      top: 1,
    })
    return rows[0] ? this.mapOpportunityRecord(rows[0]) : undefined
  }

  async discardDraft(idempotencyKey: string): Promise<ActivityDraft | OpportunityDraft | null> {
    return this.patchDraftStatus(idempotencyKey, 'Discarded')
  }

  async writeLog(
    row: Omit<InvocationLog, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
  ): Promise<InvocationLog> {
    const name = `${row.agentName}-${row.createdAt ?? now()}`.slice(0, 200)
    const body: Row = {
      [this.c('name')]: name,
      [this.c('sessionid')]: row.sessionId || null,
      [this.c('agentname')]: row.agentName,
      [this.c('inputsummary')]: row.inputSummary,
      [this.c('outputenvelope')]: row.outputEnvelope || null,
      [this.c('latencyms')]: row.latencyMs,
      [this.c('success')]: row.success,
      [this.c('confidence')]: row.confidence ?? null,
      [this.c('errormessage')]: row.errorMessage || null,
      [this.c('promptversion')]: row.promptVersion ?? config.promptVersion,
      [this.c('modelname')]: row.modelName || null,
    }
    const created = await dataverseCreate<Row>(this.set('aiinvocationlog'), body)
    return this.mapLog(created)
  }

  async listLogs(limit = 50): Promise<InvocationLog[]> {
    const rows = await dataverseList<Row>(this.set('aiinvocationlog'), {
      orderby: 'createdon desc',
      top: limit,
    })
    return rows.map((r) => this.mapLog(r))
  }

  async saveConversation(
    sessionKey: string,
    context: Record<string, string>,
    messages: unknown[],
  ): Promise<ConversationRecord> {
    const existing = this.conversations.get(sessionKey)
    const record: ConversationRecord = {
      id: existing?.id ?? uid('conv'),
      sessionKey,
      contextJson: JSON.stringify(context),
      messagesJson: JSON.stringify(messages),
      lastMessageAt: now(),
    }
    this.conversations.set(sessionKey, record)
    return record
  }

  async getConversation(sessionKey: string): Promise<ConversationRecord | undefined> {
    return this.conversations.get(sessionKey)
  }

  async computeMetrics() {
    const [activities, opportunityDrafts, opportunities, accounts] = await Promise.all([
      this.listActivityDrafts(),
      this.listOpportunityDrafts(),
      this.listOpportunities(),
      this.listAccounts(),
    ])
    const drafts = [...activities, ...opportunityDrafts]
    const openDrafts = drafts.filter((d) => d.syncStatus === 'Draft').length
    const pendingSync = drafts.filter((d) =>
      ['Confirmed', 'Syncing', 'SyncFailed'].includes(d.syncStatus),
    ).length
    const decided = drafts.filter((d) => d.syncStatus !== 'Draft')
    const adopted = drafts.filter((d) =>
      ['Synced', 'Confirmed', 'Syncing', 'SyncFailed'].includes(d.syncStatus),
    )
    const riskOpportunities = [
      ...opportunities.filter((o) => o.confidenceScore < 0.7 || o.stage === 'Identify'),
      ...opportunityDrafts.filter(
        (o) => o.syncStatus !== 'Discarded' && (o.confidence < 0.7 || o.stage === 'Identify'),
      ),
    ].length
    const todayVisits = activities.filter(
      (activity) =>
        activity.syncStatus !== 'Discarded' &&
        isoDateInZone(activity.occurredAt || activity.scheduledStart || activity.createdAt) ===
          todayIsoDate(),
    ).length
    return {
      todayVisits,
      riskOpportunities,
      pendingSync,
      openDrafts,
      draftAdoptionPct:
        decided.length === 0 ? 0 : Math.round((adopted.length / Math.max(decided.length, 1)) * 100),
      accountCount: accounts.length,
      opportunityCount: opportunities.length,
    }
  }
}
