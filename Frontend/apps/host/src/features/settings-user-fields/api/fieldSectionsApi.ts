import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'

const base = env.authServiceUrl

/**
 * One form section. `key` is the immutable identity a field's `section` points at; `label` is display
 * only and can be renamed freely, which is the entire reason sections are a catalog and not free text.
 */
export interface FieldSection {
  key: string
  label: string
  order: number
  /** The one section that can be renamed and reordered but never deleted — where an unresolvable field lands. */
  isSystem: boolean
}

export interface FieldSectionCatalogDto {
  sections: FieldSection[]
  version: number
  updatedAt: string
}

export interface UpdateFieldSectionCatalogRequest {
  sections: FieldSection[]
  /** The version this page loaded; a save based on an older one is refused (409) instead of overwriting someone else's. */
  expectedVersion?: number
  /** For each removed section that still holds fields: removedKey -> the surviving section key they move to. */
  reassignFieldsTo?: Record<string, string>
}

export const fieldSectionsApi = {
  get: (accessToken: string) =>
    apiFetch<FieldSectionCatalogDto>(`${base}/api/field-sections`, { accessToken }),

  update: (accessToken: string, body: UpdateFieldSectionCatalogRequest) =>
    apiFetch<FieldSectionCatalogDto>(`${base}/api/field-sections`, { method: 'PUT', accessToken, body }),
}
