import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'
import type { FieldDefinition } from '@omniremit/ui/validation'

const base = env.authServiceUrl

export interface UserFieldSchemaDto {
  fields: FieldDefinition[]
  version: number
  updatedAt: string
}

export interface UpdateUserFieldSchemaRequest {
  fields: FieldDefinition[]
  /** The version this page loaded; a save based on an older one is refused (409) instead of overwriting someone else's. */
  expectedVersion?: number
}

export const userSchemaApi = {
  get: (accessToken: string) => apiFetch<UserFieldSchemaDto>(`${base}/api/user-schema`, { accessToken }),

  update: (accessToken: string, body: UpdateUserFieldSchemaRequest) =>
    apiFetch<UserFieldSchemaDto>(`${base}/api/user-schema`, { method: 'PUT', accessToken, body }),
}
