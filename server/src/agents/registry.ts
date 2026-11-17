import type { DomainAgent } from './agentTypes.js'
import type { Intent } from '../types.js'

const agents = new Map<string, DomainAgent>()

export function register(agent: DomainAgent): void {
  if (agents.has(agent.name)) {
    throw new Error(`Agent already registered: ${agent.name}`)
  }
  agents.set(agent.name, agent)
}

export function getAgent(name: string): DomainAgent | undefined {
  return agents.get(name)
}

export function requireAgent(name: string): DomainAgent {
  const agent = agents.get(name)
  if (!agent) throw new Error(`Unknown agent: ${name}`)
  return agent
}

export function listAgents(): DomainAgent[] {
  return [...agents.values()]
}

/** Find a single-route agent that declares ownership of an intent. */
export function findAgentForIntent(intent: Intent): DomainAgent | undefined {
  return listAgents().find((a) => a.intents?.includes(intent))
}

export function clearRegistryForTests(): void {
  agents.clear()
}
