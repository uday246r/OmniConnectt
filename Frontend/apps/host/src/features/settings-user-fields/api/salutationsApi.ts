import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'

const base = env.authServiceUrl

export interface SalutationCatalogDto {
  salutations: string[]
  version: number
  updatedAt: string
}

export interface UpdateSalutationCatalogRequest {
  salutations: string[]
}

export const salutationsApi = {
  get: (accessToken: string) => apiFetch<SalutationCatalogDto>(`${base}/api/salutations`, { accessToken }),

  update: (accessToken: string, body: UpdateSalutationCatalogRequest) =>
    apiFetch<SalutationCatalogDto>(`${base}/api/salutations`, { method: 'PUT', accessToken, body }),
}
