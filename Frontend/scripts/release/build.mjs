#!/usr/bin/env node
/**
 * Builds ONE deployable frontend release: the host and every remote, each in its own immutable,
 * versioned folder, plus release-manifest.json describing exactly what is inside.
 *
 *   pnpm release                         # checks, builds, assembles, archives
 *   pnpm release -- --skip-checks        # skip lint/typecheck/test (CI runs them as separate jobs)
 *   pnpm release -- --only lead --reuse release/<previous>.tar.gz   # rebuild just Lead, reuse the rest
 *   pnpm release -- --since v2026.10.01 --reuse prev.tar.gz      # rebuild only what changed since a tag
 *   pnpm release -- --roll-forward-only "LeadService migration drops the Products table"
 *
 * Output (Frontend/release/):
 *
 *   <releaseId>/
 *     host/<hostVersion>/index.html, assets/…        served at /host/<version>/, index.html at /
 *     modules/<key>/<version>/mf-manifest.json, …    served at /modules/<key>/<version>/
 *     release-manifest.json
 *   <releaseId>.tar.gz  +  <releaseId>.tar.gz.sha256
 *
 * WHY VERSIONED FOLDERS. A deploy only ever ADDS folders. Making a build live is a pointer change
 * (the host's index.html; a remote's registered manifest URL), so the host, and every remote not in
 * the release, keep serving the files they already serve: no downtime, no rebuild of the host to ship
 * a remote, and a tab that already loaded the old build keeps loading the old build's chunks. Rollback
 * is moving the pointer back.
 *
 * WHY THIS IS NOT ONE JS BUNDLE. Each app is built on its own, by its own vite config; Module
 * Federation still loads the remotes at runtime. "One release" means one artifact to deploy and one
 * manifest to audit — not one compilation.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const config = JSON.parse(readFileSync(path.join(frontend, 'release.config.json'), 'utf8'))

// ── Arguments ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const skipChecks = flag('--skip-checks')
let only = option('--only')?.split(',').map((s) => s.trim()).filter(Boolean)
const since = option('--since')
const reuseSource = option('--reuse')
const rollForwardOnly = option('--roll-forward-only')
const outRoot = path.resolve(frontend, option('--out') ?? 'release')
const isCi = process.env.CI === 'true'

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(command, commandArgs, { cwd = frontend, env = {} } = {}) {
  console.log(`\n$ ${command} ${commandArgs.join(' ')}`)
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}`)
  }
}

function git(...gitArgs) {
  const result = spawnSync('git', gitArgs, { cwd: frontend, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function filesUnder(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...filesUnder(full))
    else out.push(full)
  }
  return out
}

/**
 * Content hash of a folder: every file's relative path and bytes, in sorted order. The same build
 * always hashes the same, so AuthService can refuse a version that was re-published with different
 * content — a version names one build, forever.
 */
function folderChecksum(dir) {
  const hash = createHash('sha256')
  for (const file of filesUnder(dir).sort()) {
    hash.update(path.relative(dir, file).split(path.sep).join('/'))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * Vite always loads an app's .env, whatever the mode, so a release built on a developer's machine
 * would bake that machine's settings in. The API URLs are overridden below regardless; anything else
 * found is reported, and refused outright in CI, where a .env can only be a mistake.
 */
function checkLocalEnv(appDir) {
  const found = ['.env', '.env.local', '.env.production', '.env.production.local']
    .map((name) => path.join(appDir, name))
    .filter(existsSync)
  if (found.length === 0) return

  const keys = found.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('VITE_'))
      .map((line) => line.split('=')[0]),
  )
  const message = `${path.relative(frontend, appDir)} has local env files (${found.map((f) => path.basename(f)).join(', ')}) setting ${[...new Set(keys)].join(', ') || 'nothing'}.`
  if (isCi) throw new Error(`${message} Release builds must not read local env files.`)
  console.warn(`\n⚠ ${message} API URLs are forced to same-origin; any other VITE_ value above WILL be baked into this release.`)
}

/** Fails if built remote JS points at the origin's root /assets/ — it would load the host's files. */
function assertRelativeAssets(dir, label) {
  const offenders = filesUnder(dir)
    .filter((file) => file.endsWith('.js'))
    .filter((file) => readFileSync(file, 'utf8').includes('"/assets/'))
  if (offenders.length > 0) {
    throw new Error(`${label}: built JS references "/assets/" absolutely (${offenders.map((f) => path.basename(f)).join(', ')}). Remotes must build with base './'.`)
  }
}

/**
 * A rebuilt app whose version is unchanged from the reused release must be byte-identical to it —
 * builds are reproducible, so a different hash under the same version means its code changed without a
 * version bump. Caught here, with the fix named, instead of as a refused deploy.
 */
function assertVersionBumped(label, version, sha256, previous) {
  if (previous && previous.version === version && previous.sha256 !== sha256) {
    throw new Error(`${label} changed but is still version ${version} (the previous release has different content under that version). Bump "version" in its package.json.`)
  }
}

// Same-origin API URLs and no stray value from a developer's shell.
const RELEASE_ENV = {
  VITE_API_BASE_URL: '',
  VITE_AUTH_SERVICE_URL: '',
  NODE_ENV: 'production',
}

// ── Release identity ──────────────────────────────────────────────────────────

const commit = git('rev-parse', '--short=12', 'HEAD') ?? 'nogit'
const dirty = git('status', '--porcelain') ? '-dirty' : ''
// Date and time, then commit: sortable, and unique even for two releases cut from one commit (a
// remote-only release rebuilt on top of the previous one).
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '.').slice(0, 15)
const releaseId = `${stamp}-${commit}${dirty}`
if (dirty && isCi) throw new Error('Refusing to build a release from a working tree with uncommitted changes.')

const releaseDir = path.join(outRoot, releaseId)
rmSync(releaseDir, { recursive: true, force: true })
mkdirSync(releaseDir, { recursive: true })

console.log(`Release ${releaseId} → ${path.relative(frontend, releaseDir)}`)

// ── What to rebuild ───────────────────────────────────────────────────────────

/**
 * Apps whose sources changed since a git ref. Anything every app is built from — the shared packages,
 * the lockfile, the workspace and TypeScript config, this script — counts as a change to all of them.
 */
function appsChangedSince(ref) {
  const changed = git('diff', '--name-only', `${ref}...HEAD`, '--', '.')
  if (changed === null) throw new Error(`--since ${ref}: git could not compare against it (is it fetched?).`)
  const files = changed.split('\n').filter(Boolean).map((f) => f.replace(/^Frontend\//, ''))

  const shared = ['packages/', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'tsconfig.base.json', 'release.config.json', 'scripts/release/']
  if (files.some((f) => shared.some((prefix) => f === prefix || f.startsWith(prefix)))) {
    return ['host', ...config.remotes.map((r) => r.key)]
  }

  const apps = [{ key: 'host', dir: config.host.dir }, ...config.remotes]
  return apps.filter((app) => files.some((f) => f.startsWith(`${app.dir}/`))).map((app) => app.key)
}

if (since) {
  if (only) throw new Error('Use --since or --only, not both.')
  only = appsChangedSince(since)
  console.log(`Changed since ${since}: ${only.length ? only.join(', ') : 'nothing'}`)
}

/** --reuse takes a previous release's folder or its .tar.gz (extracted next to this release). */
let reuseDir = reuseSource
if (reuseSource?.endsWith('.tar.gz')) {
  const shaFile = `${reuseSource}.sha256`
  if (existsSync(shaFile)) {
    const expected = readFileSync(shaFile, 'utf8').trim().split(/\s+/)[0]
    const actual = createHash('sha256').update(readFileSync(reuseSource)).digest('hex')
    if (expected !== actual) throw new Error(`${reuseSource} does not match its .sha256 — refusing to reuse it.`)
  }
  reuseDir = path.join(outRoot, `.reuse-${releaseId}`)
  rmSync(reuseDir, { recursive: true, force: true })
  mkdirSync(reuseDir, { recursive: true })
  // Relative, forward-slash path from the extraction folder: GNU tar (Git for Windows) reads "C:\…" as host:path.
  const archiveFromHere = path.relative(reuseDir, path.resolve(reuseSource)).split(path.sep).join('/')
  run('tar', ['-xzf', archiveFromHere], { cwd: reuseDir })
}
if (only && !reuseDir) {
  console.warn('\n⚠ No --reuse given, so every app is built (nothing to reuse unchanged builds from).')
  only = undefined
}

// ── Checks ────────────────────────────────────────────────────────────────────

if (!skipChecks) {
  run('pnpm', ['install', '--frozen-lockfile'])
  run('pnpm', ['-r', 'lint'])
  run('pnpm', ['-r', 'typecheck'])
  run('pnpm', ['-r', 'test'])
}

const wants = (key) => !only || only.includes(key)
const reused = reuseDir ? readJson(path.join(reuseDir, 'release-manifest.json')) : null

// ── Host ──────────────────────────────────────────────────────────────────────

const hostDir = path.join(frontend, config.host.dir)
const hostPkg = readJson(path.join(hostDir, 'package.json'))
// The same code the host and AuthService use (Node runs the TypeScript directly; engines: node >= 24).
const { HOST_BRIDGE_VERSION: bridgeVersion } = await import(new URL('../../packages/host-bridge/src/contract.ts', import.meta.url).href)
const { satisfies } = await import(new URL('../../packages/host-bridge/src/semver.ts', import.meta.url).href)

let host
if (wants('host') || !reused) {
  checkLocalEnv(hostDir)
  const base = `/host/${hostPkg.version}/`
  // Through the environment, not a CLI flag: pnpm forwards a literal "--" to the script, after which
  // vite ignores the flag and the host silently builds for "/".
  run('pnpm', ['--filter', hostPkg.name, 'run', 'build'], { env: { ...RELEASE_ENV, OMNI_HOST_BASE: base } })
  const builtIndex = readFileSync(path.join(hostDir, 'dist', 'index.html'), 'utf8')
  if (!builtIndex.includes(`${base}assets/`)) {
    throw new Error(`The host build did not use base ${base}; its index.html would load the wrong assets.`)
  }
  const target = path.join(releaseDir, 'host', hostPkg.version)
  cpSync(path.join(hostDir, 'dist'), target, { recursive: true })
  host = { version: hostPkg.version, bridgeVersion, path: base, sha256: folderChecksum(target) }
  assertVersionBumped('The host', host.version, host.sha256, reused?.host)
} else {
  host = reused.host
  cpSync(path.join(reuseDir, 'host', host.version), path.join(releaseDir, 'host', host.version), { recursive: true })
}

// ── Remotes ───────────────────────────────────────────────────────────────────

const remotes = {}
for (const remote of config.remotes) {
  const appDir = path.join(frontend, remote.dir)
  const pkg = readJson(path.join(appDir, 'package.json'))

  if (!wants(remote.key) && reused?.remotes?.[remote.key]) {
    const previous = reused.remotes[remote.key]
    cpSync(path.join(reuseDir, 'modules', remote.key, previous.version), path.join(releaseDir, 'modules', remote.key, previous.version), { recursive: true })
    remotes[remote.key] = previous
    continue
  }

  checkLocalEnv(appDir)
  run('pnpm', ['--filter', pkg.name, 'run', 'build'], { env: { ...RELEASE_ENV, MF_BUILD_VERSION: pkg.version } })

  const dist = path.join(appDir, 'dist')
  assertRelativeAssets(dist, remote.key)

  const target = path.join(releaseDir, 'modules', remote.key, pkg.version)
  cpSync(dist, target, { recursive: true })
  // A remote is a module, not a page: its standalone index.html (and the build's stats file) must not
  // be reachable on the platform's origin.
  for (const stray of ['index.html', 'mf-stats.json']) rmSync(path.join(target, stray), { force: true })

  const manifest = readJson(path.join(target, 'mf-manifest.json'))
  const omniconnect = manifest.metaData?.omniconnect ?? {}
  if (manifest.metaData?.buildInfo?.buildVersion !== pkg.version || omniconnect.version !== pkg.version) {
    throw new Error(`${remote.key}: mf-manifest.json says ${manifest.metaData?.buildInfo?.buildVersion}, package.json says ${pkg.version}.`)
  }

  remotes[remote.key] = {
    version: pkg.version,
    path: `/modules/${remote.key}/${pkg.version}/`,
    manifestUrl: `/modules/${remote.key}/${pkg.version}/mf-manifest.json`,
    containerName: manifest.name,
    requiredHostBridge: omniconnect.requiredHostBridge,
    shared: Object.fromEntries((manifest.shared ?? []).map((s) => [s.name, s.requiredVersion])),
    displayName: remote.displayName,
    iconKey: remote.iconKey,
    sidebarOrder: remote.sidebarOrder,
    sha256: folderChecksum(target),
  }
  assertVersionBumped(remote.key, pkg.version, remotes[remote.key].sha256, reused?.remotes?.[remote.key])
}

// ── Compatibility, before anything ships ──────────────────────────────────────

for (const [key, remote] of Object.entries(remotes)) {
  if (!satisfies(bridgeVersion, remote.requiredHostBridge)) {
    throw new Error(`${key} ${remote.version} needs host bridge ${remote.requiredHostBridge}; this release's host provides ${bridgeVersion}.`)
  }
}

// ── Manifest and archive ──────────────────────────────────────────────────────

const releaseManifest = {
  releaseVersion: releaseId,
  commit: git('rev-parse', 'HEAD'),
  builtAt: new Date().toISOString(),
  host,
  remotes,
  // Set when this release ships a backend change that cannot be undone (a destructive migration):
  // rolling the FRONTEND back past it would call endpoints that no longer exist.
  rollForwardOnly: rollForwardOnly ? { reason: rollForwardOnly } : null,
}
writeFileSync(path.join(releaseDir, 'release-manifest.json'), JSON.stringify(releaseManifest, null, 2) + '\n')

const archive = path.join(outRoot, `${releaseId}.tar.gz`)
rmSync(archive, { force: true })
// Relative paths on purpose: GNU tar (Git for Windows) reads "C:\…" as host:path.
run('tar', ['-czf', path.basename(archive), '-C', releaseId, '.'], { cwd: outRoot })
const archiveSha = createHash('sha256').update(readFileSync(archive)).digest('hex')
writeFileSync(`${archive}.sha256`, `${archiveSha}  ${path.basename(archive)}\n`)

if (reuseSource?.endsWith('.tar.gz')) rmSync(reuseDir, { recursive: true, force: true })

const rebuilt = only ?? ['host', ...config.remotes.map((r) => r.key)]
console.log(`\n✔ Release ${releaseId}`)
console.log(`  rebuilt      ${rebuilt.length ? rebuilt.join(', ') : 'nothing (all reused)'}`)
console.log(`  host         ${host.version} (bridge ${bridgeVersion})`)
for (const [key, r] of Object.entries(remotes)) console.log(`  ${key.padEnd(12)} ${r.version} (needs ${r.requiredHostBridge})`)
console.log(`  archive      ${path.relative(frontend, archive)}`)
console.log(`  sha256       ${archiveSha}`)
