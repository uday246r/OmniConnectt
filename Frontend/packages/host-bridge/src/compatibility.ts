import { HOST_BRIDGE_VERSION } from './contract'
import { satisfies } from './semver'

/** The OmniConnect block a remote's build writes into its mf-manifest.json (`metaData.omniconnect`). */
export interface RemoteCompatibilityMetadata {
  requiredHostBridge?: string
}

export type CompatibilityVerdict =
  | { compatible: true }
  | { compatible: false; reason: string }

/**
 * Whether a remote, as described by its built manifest, can run on this host.
 *
 * A remote that declares no range is accepted: every remote built before this contract was versioned
 * is in that position, and refusing them all would take the platform down on the first deploy. Any
 * remote built from this repo today declares one (the build fails without it).
 */
export function checkRemoteCompatibility(
  metadata: RemoteCompatibilityMetadata | undefined,
  hostBridgeVersion: string = HOST_BRIDGE_VERSION,
): CompatibilityVerdict {
  const range = metadata?.requiredHostBridge?.trim()
  if (!range) return { compatible: true }
  if (satisfies(hostBridgeVersion, range)) return { compatible: true }
  return {
    compatible: false,
    reason: `needs host bridge ${range}, but this host provides ${hostBridgeVersion}`,
  }
}
