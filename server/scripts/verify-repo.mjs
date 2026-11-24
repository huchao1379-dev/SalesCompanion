import { createRepository } from '../src/store/dataverseStore.ts'

const repo = createRepository()
console.log('mode', repo.mode)
const accounts = await repo.listAccounts()
console.log(
  'accounts',
  accounts.length,
  accounts.map((a) => `${a.name}|${a.externalKey}`).join('; '),
)
const renji = await repo.getAccount('SAP-ACC-RENJI')
console.log('getAccount RENJI', renji?.id, renji?.name, renji?.externalKey)
const renji2 = await repo.searchAccounts('仁济')
console.log(
  'search 仁济',
  renji2.map((a) => a.name),
)
if (renji) {
  const contacts = await repo.getContactsForAccount(renji.id)
  console.log(
    'contacts',
    contacts.map((c) => `${c.name}|${c.externalKey}`),
  )
  const opps = await repo.getOpportunitiesForAccount(renji.id)
  console.log(
    'opps',
    opps.map((o) => `${o.name}|${o.externalKey}|${o.stage}|qty=${o.quantity}`),
  )
  const n17 = await repo.findMatchingOpportunity(renji.id, 'N17')
  console.log('match N17', n17?.externalKey, n17?.stage, n17?.quantity)
}
console.log('listOpportunities', (await repo.listOpportunities()).length)
