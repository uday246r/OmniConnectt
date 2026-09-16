#!/usr/bin/env node
/**
 * Runs every backend service at once, for local development: AuthService, LeadService,
 * Customer360Service and ProductsService.
 *
 *   node scripts/dev-backends.mjs              # all four
 *   node scripts/dev-backends.mjs auth lead    # a subset
 *
 * Why this exists: the desktop app's Browser pane runs at most five dev servers per worktree, and the
 * platform has eight processes (four services, the host and three remotes). Started one by one, the
 * last remotes never came up and the host showed them as "isn't responding". Grouped — this script plus
 * one entry for all remotes plus the host — the whole platform fits in three.
 *
 * Output is prefixed with the service name. Ctrl+C stops every child. If one service exits, the rest are
 * stopped too, so a crashed service is never mistaken for a running platform.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SERVICES = {
  auth: { label: 'auth    ', project: 'Backend/AuthService' },
  lead: { label: 'lead    ', project: 'Backend/LeadService' },
  c360: { label: 'c360    ', project: 'Backend/Customer360Service' },
  products: { label: 'products', project: 'Backend/ProductsService' },
}

const requested = process.argv.slice(2)
const selected = requested.length > 0 ? requested : Object.keys(SERVICES)
const unknown = selected.filter((name) => !SERVICES[name])
if (unknown.length > 0) {
  console.error(`Unknown service(s): ${unknown.join(', ')}. Choose from: ${Object.keys(SERVICES).join(', ')}.`)
  process.exit(2)
}

const children = []
let stopping = false

function prefixLines(label, stream, write) {
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) write(`[${label}] ${line}\n`)
  })
  stream.on('end', () => {
    if (buffer) write(`[${label}] ${buffer}\n`)
  })
}

function stopAll(exitCode) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode === null) child.kill()
  }
  setTimeout(() => process.exit(exitCode), 1500).unref()
}

for (const name of selected) {
  const { label, project } = SERVICES[name]
  const child = spawn('dotnet', ['run', '--project', project], {
    cwd: repoRoot,
    env: process.env,
    shell: process.platform === 'win32',
  })
  children.push(child)
  prefixLines(label, child.stdout, (s) => process.stdout.write(s))
  prefixLines(label, child.stderr, (s) => process.stderr.write(s))
  child.on('exit', (code) => {
    if (stopping) return
    process.stderr.write(`[${label}] exited with code ${code}; stopping the other services.\n`)
    stopAll(code ?? 1)
  })
}

process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))
