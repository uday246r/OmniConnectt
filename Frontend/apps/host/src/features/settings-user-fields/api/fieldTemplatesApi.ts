import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'

const base = env.authServiceUrl

export interface FieldTemplateDto {
  id: string
  name: string
  label: string
  category: 'contact' | 'organization' | 'general' | 'custom' | string
  dataType: 'text' | 'dropdown'
  description?: string | null
  options?: string[] | null
  isSystem?: boolean
  key?: string
}

export interface FieldTemplateCatalogDto {
  templates: FieldTemplateDto[]
  version: number
  updatedAt: string
}

export interface UpdateFieldTemplateCatalogRequest {
  templates: FieldTemplateDto[]
  expectedVersion?: number
}

export const fieldTemplatesApi = {
  get: (accessToken: string) =>
    apiFetch<FieldTemplateCatalogDto>(`${base}/api/field-templates`, { accessToken }),

  update: (accessToken: string, body: UpdateFieldTemplateCatalogRequest) =>
    apiFetch<FieldTemplateCatalogDto>(`${base}/api/field-templates`, {
      method: 'PUT',
      accessToken,
      body,
    }),
}
