import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'

const base = env.authServiceUrl

/** One salutation with a stable id — so editing its text is a rename that follows it onto every user. */
export interface SalutationEntryDto {
  id: string
  value: string
  /** How many user profiles show it. Informational; ignored when sent back. */
  userCount: number
}

export interface SalutationCatalogDto {
  salutations: string[]
  version: number
  updatedAt: string
  entries?: SalutationEntryDto[] | null
}

export interface UpdateSalutationCatalogRequest {
  /** A plain list, for callers that never rename. */
  salutations?: string[]
  /** The list with ids. A kept id with new text renames that salutation for every user who has it. */
  entries?: Pick<SalutationEntryDto, 'id' | 'value'>[]
  /** The version this editor loaded; a save based on an older one is refused with a 409. */
  expectedVersion?: number
}

export const salutationsApi = {
  get: (accessToken: string) => apiFetch<SalutationCatalogDto>(`${base}/api/salutations`, { accessToken }),

  update: (accessToken: string, body: UpdateSalutationCatalogRequest) =>
    apiFetch<SalutationCatalogDto>(`${base}/api/salutations`, { method: 'PUT', accessToken, body }),
}
