/** Type surface for the shared federation preset. Kept hand-written and tiny — the package is plain ESM config, not compiled source. */

export interface SharedDependencyConfig {
  singleton: boolean
  requiredVersion: string
}

export declare const sharedDependencies: Record<string, SharedDependencyConfig>

export declare const REMOTE_ENTRY_MODULE: './App'

export declare const BASELINE_SHARED: string[]

export interface RemoteRelease {
  version: string
  requiredHostBridge: string
}

export interface RemoteFederationOptions {
  name: string
  filename: string
  manifest: { additionalData: (args: { stats: { metaData?: Record<string, unknown> } }) => unknown }
  dts: boolean
  exposes: Record<string, string>
  shared: Record<string, SharedDependencyConfig>
}

export interface HostFederationOptions {
  name: string
  shared: Record<string, SharedDependencyConfig>
}

export declare function remoteFederationConfig(name: string, entry: string, uses?: string[], release?: RemoteRelease): RemoteFederationOptions

/** Reads a remote's version and requiredHostBridge from <appDir>/package.json; throws if either is missing. */
export declare function readRemoteRelease(appDir: string): RemoteRelease

export declare function hostFederationConfig(name: string, provides?: string[]): HostFederationOptions
