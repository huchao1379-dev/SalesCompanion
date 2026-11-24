/**
 * Persistence entrypoint — Dataverse Web API only (no in-memory seed runtime).
 */
import { config, hasRemoteDataverse } from '../config.js'
import type { SalesRepository } from './repository.js'
import { DataverseWebApiRepository } from './dataverseWebApiRepository.js'

export function createRepository(): SalesRepository {
  if (!hasRemoteDataverse()) {
    throw new Error(
      'Dataverse is required. Set DATAVERSE_URL plus DATAVERSE_TOKEN or ' +
        'DATAVERSE_TENANT_ID + DATAVERSE_CLIENT_ID + DATAVERSE_CLIENT_SECRET in server/.env',
    )
  }
  console.log(
    `[dataverse] Using Web API → ${config.dataverseUrl} (prefix=${config.dataversePrefix}_)`,
  )
  return new DataverseWebApiRepository()
}

export const repository: SalesRepository = createRepository()
