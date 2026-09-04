import type { AssignableModuleDto } from '../api/checkerAssignmentsApi'
import type { RemoteAppDto } from '../../settings-applications/api/remoteAppsApi'

export interface ModuleAppGroup {
  id: string
  key: string
  name: string
  isHost: boolean
  iconKey?: string | null
  modules: AssignableModuleDto[]
}

/**
 * Groups the flat assignable-module catalog by owning application: Host Platform first, then every
 * registered remote app, then a catch-all for any remote module that doesn't match a registered app
 * (e.g. its app was deregistered after modules were already assigned). Shared by the Checker
 * Assignment list (per-app section headers) and the assignment form (bulk "whole application" scope)
 * so both stay in sync with exactly the same grouping rules.
 */
export function groupModulesByApp(modules: AssignableModuleDto[], remoteApps: RemoteAppDto[]): ModuleAppGroup[] {
  const groups: ModuleAppGroup[] = []

  const hostModules = modules.filter((m) => m.key.startsWith('host.') || !m.key.startsWith('remote.'))
  if (hostModules.length > 0 || remoteApps.length === 0) {
    groups.push({
      id: 'host',
      key: 'host.platform',
      name: 'Host Platform (Core)',
      isHost: true,
      iconKey: 'Shield',
      modules: hostModules,
    })
  }

  const assignedModuleKeys = new Set(hostModules.map((m) => m.key))

  for (const app of remoteApps) {
    const appModules = modules.filter((m) => {
      const key = m.key.toLowerCase()
      const appKey = app.key.toLowerCase()
      return key === `remote.${appKey}` || key.startsWith(`remote.${appKey}.`) || key.includes(appKey)
    })
    appModules.forEach((m) => assignedModuleKeys.add(m.key))

    groups.push({
      id: app.id,
      key: app.key,
      name: app.displayName,
      isHost: false,
      iconKey: app.iconKey,
      modules: appModules,
    })
  }

  const remainingRemoteModules = modules.filter((m) => !assignedModuleKeys.has(m.key) && m.key.startsWith('remote.'))
  if (remainingRemoteModules.length > 0) {
    groups.push({
      id: 'other-remotes',
      key: 'remote.extensions',
      name: 'Other Remote Microfrontends',
      isHost: false,
      iconKey: 'Layers',
      modules: remainingRemoteModules,
    })
  }

  return groups
}
