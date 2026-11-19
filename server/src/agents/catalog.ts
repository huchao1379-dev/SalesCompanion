/**
 * Unified agent catalog — the only place that registers Domain Agents.
 * Add a new agent: import + register(agent) here.
 */
import { register, listAgents } from './registry.js'
import { entityExtractAgent } from './entityExtract.agent.js'
import { accountProfileAgent } from './accountProfile.agent.js'
import { activityCreateAgent } from './activityCreate.agent.js'
import { opportunityCreateAgent } from './opportunityCreate.agent.js'
import { orderQueryAgent } from './orderQuery.agent.js'
import { workSummaryAgent } from './workSummary.agent.js'
import { opportunitySupervisorAgent } from './opportunitySupervisor.agent.js'

let booted = false

export function ensureAgentsRegistered(): void {
  if (booted) return
  register(entityExtractAgent)
  register(accountProfileAgent)
  register(activityCreateAgent)
  register(opportunityCreateAgent)
  register(opportunitySupervisorAgent)
  register(orderQueryAgent)
  register(workSummaryAgent)
  booted = true
}

export function getCatalogSummary() {
  ensureAgentsRegistered()
  return listAgents().map((a) => ({
    name: a.name,
    displayName: a.displayName,
    description: a.description,
    intents: a.intents ?? [],
  }))
}
