/**
 * Unified agent catalog — the only place that registers Domain Agents.
 * Add a new agent: import + register(agent) here.
 * Add a new routable capability: also register a skill in skills.ts (+ Intent + pipeline).
 */
import { register, listAgents } from './registry.js'
import { listRoutableSkills } from './skills.js'
import { entityExtractAgent } from './entityExtract.agent.js'
import { accountProfileAgent } from './accountProfile.agent.js'
import { accountListAgent } from './accountList.agent.js'
import { activityCreateAgent } from './activityCreate.agent.js'
import { opportunityCreateAgent } from './opportunityCreate.agent.js'
import { opportunityPulseAgent } from './opportunityPulse.agent.js'
import { orderQueryAgent } from './orderQuery.agent.js'
import { workSummaryAgent } from './workSummary.agent.js'
import { opportunitySupervisorAgent } from './opportunitySupervisor.agent.js'
import { activitySupervisorAgent } from './activitySupervisor.agent.js'
import { activityInsightAgent } from './activityInsight.agent.js'
import { opportunityInsightAgent } from './opportunityInsight.agent.js'
import { generalAssistAgent } from './generalAssist.agent.js'

let booted = false

export function ensureAgentsRegistered(): void {
  if (booted) return
  register(entityExtractAgent)
  register(accountProfileAgent)
  register(accountListAgent)
  register(opportunityPulseAgent)
  register(activityCreateAgent)
  register(opportunityCreateAgent)
  register(activitySupervisorAgent)
  register(opportunitySupervisorAgent)
  register(orderQueryAgent)
  register(workSummaryAgent)
  register(activityInsightAgent)
  register(opportunityInsightAgent)
  register(generalAssistAgent)
  booted = true
}

export function getCatalogSummary() {
  ensureAgentsRegistered()
  return {
    agents: listAgents().map((a) => ({
      name: a.name,
      displayName: a.displayName,
      description: a.description,
      intents: a.intents ?? [],
    })),
    skills: listRoutableSkills().map((skill) => ({
      id: skill.id,
      intent: skill.intent,
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      examples: skill.examples,
    })),
  }
}
