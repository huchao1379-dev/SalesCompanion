/**
 * Logical column names as they exist in the live environment (prefix=hc).
 * Spec used crmai_* names; Maker schema has a few renames/typos — map here.
 */
import { config } from '../config.js'

export type FieldKey =
  | 'name'
  | 'externalkey'
  | 'region'
  | 'creditlevel'
  | 'lastvisitat'
  | 'visitcount30d'
  | 'npsdelta'
  | 'hasmsa'
  | 'notes'
  | 'title'
  | 'phone'
  | 'accountid'
  | 'accountname'
  | 'contactid'
  | 'contactname'
  | 'type'
  | 'occurredat'
  | 'scheduledstart'
  | 'scheduledend'
  | 'summary'
  | 'nextfollowupat'
  | 'sourcetranscript'
  | 'syncstatus'
  | 'confidence'
  | 'createdbyagent'
  | 'sourcesjson'
  | 'idempotencykey'
  | 'sapexternalid'
  | 'sessionkey'
  | 'promptversion'
  | 'subject'
  | 'productline'
  | 'productmodel'
  | 'quantity'
  | 'amount'
  | 'currencycode'
  | 'stage'
  | 'confidencescore'
  | 'closedate'
  | 'reuseexisting'
  | 'existingopportunityid'
  | 'supervisorhints'
  | 'linkedactivityid'
  | 'agentname'
  | 'inputsummary'
  | 'outputenvelope'
  | 'latencyms'
  | 'success'
  | 'errormessage'
  | 'sessionid'
  | 'modelname'
  | 'status'
  | 'orderedat'
  | 'orderid'
  | 'eta'
  | 'trackingno'

/** Live hc_* schema overrides vs docs/13 defaults. */
const HC_OVERRIDES: Partial<Record<FieldKey, string>> = {
  // activity primary is subject (no hc_name); contact lookup logical name is hc_contact
  subject: 'subject',
  contactid: 'contact',
  // opportunity Maker typos
  quantity: 'qunatity',
  closedate: 'closeddate',
}

/**
 * Resolve full logical column name: `{prefix}_{leaf}`.
 * Returns null when the live schema does not have the column (e.g. account.externalkey).
 */
export function field(key: FieldKey, table?: 'account' | 'contact' | 'activity' | 'opportunity' | 'aiinvocationlog' | 'order' | 'shipment'): string | null {
  const prefix = config.dataversePrefix

  // account has no externalkey in current env
  if (table === 'account' && key === 'externalkey') return null

  // activity uses subject as the main/primary text field
  if (table === 'activity' && key === 'name') {
    return `${prefix}_subject`
  }

  if (prefix === 'hc' && key in HC_OVERRIDES) {
    const leaf = HC_OVERRIDES[key]!
    return `${prefix}_${leaf}`
  }

  return `${prefix}_${key}`
}

export function fieldOrThrow(
  key: FieldKey,
  table?: Parameters<typeof field>[1],
): string {
  const name = field(key, table)
  if (!name) throw new Error(`Column not available in live schema: ${table}.${key}`)
  return name
}
