import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'
import type { CustomPreset } from '@omniremit/ui/validation'

const base = env.authServiceUrl

export interface ValidationPresetCatalogDto {
  presets: CustomPreset[]
  version: number
  updatedAt: string
}

export interface UpdateValidationPresetCatalogRequest {
  presets: CustomPreset[]
  /** The version this page loaded; a save based on an older one is refused (409) instead of overwriting someone else's. */
  expectedVersion?: number
}

export const customPresetsApi = {
  get: (accessToken: string) => apiFetch<ValidationPresetCatalogDto>(`${base}/api/validation-presets`, { accessToken }),

  update: (accessToken: string, body: UpdateValidationPresetCatalogRequest) =>
    apiFetch<ValidationPresetCatalogDto>(`${base}/api/validation-presets`, { method: 'PUT', accessToken, body }),
}
