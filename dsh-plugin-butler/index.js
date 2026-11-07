/**
 * Plugin Butler — host half.
 *
 * Owns the switchboard: it reads the live plugin inventory from the plugin
 * manager service, flips individual rows and whole bundles, and applies a
 * startup policy so a lean boot only pays for the core plugins.
 *
 * The browser half (./client.js) is a plain settings page that talks to the
 * routes registered here; there is no RPC bridge to import.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'plugin-butler'

const API = '/dsh-butler/api'
const BUTLER_MODULE = 'dsh-plugin-butler'
const CORE_PREFIX = '@deepseek-ai/'
const MODES = ['observe', 'lean', 'all']
const MAX_BODY = 8192

/** Identifies this launch; leases recorded for another boot are stale. */
const BOOT_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Bumped whenever the profile composition may have changed. */
let revision = 0

function bumpRevision() {
  revision += 1
  return revision
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveStateDir() {
  const home = (process.env.DSH_HOME || '').trim()
  if (home) return join(home, 'butler')
  const profile = (process.env.DSH_PROFILE_DIR || '').trim()
  if (profile) {
    const root = dirname(dirname(profile))
    if (root && root !== profile) return join(root, 'butler')
  }
  return join(homedir(), '.dsh', 'butler')
}

const STATE_FILE = join(resolveStateDir(), 'state.json')

/** @type {{version: number, mode: string, pinned: string[], leases: Record<string, string>} | null} */
let stateCache = null

function normalizeState(input) {
  const mode = input && MODES.includes(input.mode) ? input.mode : 'observe'
  const pinned = Array.isArray(input && input.pinned)
    ? [...new Set(input.pinned.filter((value) => typeof value === 'string' && value))]
    : []
  const leases = input && typeof input.leases === 'object' && input.leases ? { ...input.leases } : {}
  return { version: 1, mode, pinned, leases }
}

async function loadState() {
  if (stateCache) return stateCache
  try {
    stateCache = normalizeState(JSON.parse(await readFile(STATE_FILE, 'utf8')))
  } catch {
    stateCache = normalizeState(null)
  }
  return stateCache
}

async function saveState(next) {
  stateCache = normalizeState(next)
  await mkdir(dirname(STATE_FILE), { recursive: true })
  const tmp = `${STATE_FILE}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(stateCache, null, 2)}\n`, 'utf8')
  await rename(tmp, STATE_FILE)
  return stateCache
}

/**
 * Drop pins whose row no longer exists (a bundle was removed or a patch id
 * changed). Returns the dropped entry ids; writes only when something changed.
 */
async function prunePins(pluginManager) {
  const state = await loadState()
  if (!state.pinned.length) return []
  const plugins = await pluginManager.listPlugins()
  const known = new Set(plugins.map((entry) => entry.entryId))
  const dropped = state.pinned.filter((entryId) => !known.has(entryId))
  if (!dropped.length) return []
  state.pinned = state.pinned.filter((entryId) => known.has(entryId))
  await saveState(state)
  return dropped
}

function pickTitle(meta) {
  if (!meta || typeof meta !== 'object') return null
  const title = meta.title
  if (typeof title === 'string' && title.trim()) return title.trim()
  if (title && typeof title === 'object') {
    for (const key of ['zh', 'zh-CN', 'en']) {
      const value = title[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    for (const value of Object.values(title)) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return null
}

function pickDescription(meta) {
  if (!meta || typeof meta !== 'object') return null
  const description = meta.description
  if (typeof description === 'string' && description.trim()) return description.trim()
  return null
}

function isCoreModule(moduleName) {
  const value = String(moduleName || '')
  return value === BUTLER_MODULE || value.startsWith(CORE_PREFIX)
}

function describe(entry, state) {
  const moduleName = String(entry.moduleName || '')
  const patchId = typeof entry.patchId === 'string' ? entry.patchId : null
  const readOnlyReason = entry.readOnlyReason || null
  const core = isCoreModule(moduleName)
  const writable = Boolean(patchId) && !readOnlyReason
  return {
    entryId: entry.entryId,
    moduleName,
    patchId,
    title: pickTitle(entry.meta),
    description: pickDescription(entry.meta),
    enabled: Boolean(entry.enabled),
    fiberPhase: entry.fiberPhase || null,
    readOnlyReason,
    core,
    self: moduleName === BUTLER_MODULE,
    writable,
    managed: writable && !core,
    pinned: state.pinned.includes(entry.entryId),
    leased: state.leases[entry.entryId] === BOOT_ID,
  }
}

function sortEntries(a, b) {
  if (a.core !== b.core) return a.core ? -1 : 1
  return a.moduleName.localeCompare(b.moduleName)
}

/**
 * A bundle can be switched from here when the manager actually addresses it:
 * profile-installed bundles and enabled composition rows. Installation-available
 * bundles that are not installed (or read-only bundles) are refused.
 */
function bundleWritable(bundle) {
  if (!bundle || bundle.readOnlyReason) return false
  const availability = bundle.availability
  if (availability === 'missing') return false
  if (availability === 'profile') return true
  return Boolean(bundle.installed) || Boolean(bundle.enabled)
}

function bundleReason(bundle) {
  if (!bundle) return 'unknown bundle'
  if (bundle.readOnlyReason) return bundle.readOnlyReason
  if (bundle.availability === 'missing') return 'bundle is missing from the profile'
  if (!bundleWritable(bundle)) return 'bundle cannot be switched here'
  return null
}

function describeBundle(bundle) {
  const rows = Array.isArray(bundle.rows) ? bundle.rows : []
  const error =
    bundle.error && typeof bundle.error === 'object'
      ? { code: bundle.error.code || null, diagnostic: bundle.error.diagnostic || null }
      : null
  return {
    name: String(bundle.name || ''),
    version: bundle.version || null,
    description: bundle.description || null,
    official: Boolean(bundle.official),
    enabled: Boolean(bundle.enabled),
    installed: Boolean(bundle.installed),
    availability: bundle.availability || null,
    removable: Boolean(bundle.removable),
    optional: Boolean(bundle.optional),
    readOnlyReason: bundle.readOnlyReason || null,
    writable: bundleWritable(bundle),
    self: String(bundle.name || '') === BUTLER_MODULE,
    error,
    rowCount: rows.length,
    rows: rows.map((row) => String(row.moduleName || row.rowId || '')).filter(Boolean),
    overrides: Array.isArray(bundle.overrides) ? bundle.overrides.length : 0,
  }
}

function sortBundles(a, b) {
  if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
  if (a.installed !== b.installed) return a.installed ? -1 : 1
  return a.name.localeCompare(b.name)
}

/**
 * What the next launch will do with the current policy. Leases granted in this
 * session are exactly the rows that fold away, so this doubles as the
 * "enabled now, gone after restart" preview.
 */
function planNextBoot(entries, mode) {
  if (mode !== 'lean' && mode !== 'all') {
    return { mode, active: false, disable: [], enable: [] }
  }
  const candidates = entries.filter((entry) => entry.managed && !entry.pinned)
  const disable = mode === 'lean' ? candidates.filter((entry) => entry.enabled).map((entry) => entry.entryId) : []
  const enable = mode === 'all' ? candidates.filter((entry) => !entry.enabled).map((entry) => entry.entryId) : []
  return { mode, active: true, disable, enable }
}

function summarizeChange(entryId, enabled, result) {
  return {
    entryId,
    enabled,
    changed: result && typeof result.changed === 'boolean' ? result.changed : null,
    application: (result && result.application) || null,
    restartReason: (result && result.restartReason) || null,
    error: result && result.error ? String(result.error) : null,
    warnings: result && Array.isArray(result.warnings) ? result.warnings.map(String) : [],
  }
}

async function readSnapshot(pluginManager, state) {
  const plugins = await pluginManager.listPlugins()
  const entries = plugins.map((entry) => describe(entry, state)).sort(sortEntries)
  let bundles = []
  try {
    const list = await pluginManager.listBundles()
    bundles = list.map(describeBundle).sort(sortBundles)
  } catch {
    bundles = []
  }
  const managed = entries.filter((entry) => entry.managed)
  const plan = planNextBoot(entries, state.mode)
  return {
    ok: true,
    bootId: BOOT_ID,
    revision,
    mode: state.mode,
    pinned: state.pinned,
    statePath: STATE_FILE,
    counts: {
      total: entries.length,
      enabled: entries.filter((entry) => entry.enabled).length,
      managed: managed.length,
      managedEnabled: managed.filter((entry) => entry.enabled).length,
      bundles: bundles.length,
      bundlesEnabled: bundles.filter((bundle) => bundle.enabled).length,
      pinned: entries.filter((entry) => entry.pinned).length,
    },
    plan,
    entries,
    bundles,
  }
}

async function applySweep(pluginManager, mode) {
  const state = await loadState()
  const plugins = await pluginManager.listPlugins()
  const changes = []
  for (const entry of plugins) {
    const row = describe(entry, state)
    if (!row.managed) continue
    const want = mode === 'all'
    if (!want && row.pinned) continue
    if (row.enabled === want) continue
    try {
      const result = await pluginManager.setPluginEnabled(row.entryId, want)
      changes.push(summarizeChange(row.entryId, want, result))
      if (want) state.leases[row.entryId] = BOOT_ID
      else delete state.leases[row.entryId]
    } catch (error) {
      changes.push({
        entryId: row.entryId,
        enabled: want,
        changed: null,
        application: 'failed',
        restartReason: null,
        error: String((error && error.message) || error),
        warnings: [],
      })
    }
  }
  await saveState(state)
  if (changes.length) bumpRevision()
  return changes
}

async function withRetry(task, attempts = 6, firstDelay = 900) {
  let delay = firstDelay
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1) break
      await sleep(delay)
      delay = Math.min(Math.round(delay * 1.8), 8000)
    }
  }
  throw lastError
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function hostnameOf(hostHeader) {
  const value = String(hostHeader || '').trim().toLowerCase()
  if (!value) return ''
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1)
  const colon = value.lastIndexOf(':')
  return colon === -1 ? value : value.slice(0, colon)
}

function sameOrigin(request) {
  const host = String(request.headers.host || '')
  if (!host) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const name = hostnameOf(host)
  const loopback = name === '127.0.0.1' || name === 'localhost' || name === '::1' || name === '[::1]'
  if (!loopback) return false
  const origin = request.headers.origin
  if (!origin) return true
  try {
    return new URL(String(origin)).host === host
  } catch {
    return false
  }
}

function admissionStatus(connection, request) {
  if (!connection || typeof connection.requestRejection !== 'function') return null
  let ruling = null
  try {
    ruling = connection.requestRejection(request)
  } catch {
    return null
  }
  if (!ruling) return null
  if (typeof ruling === 'number') return ruling
  if (typeof ruling.status === 'number') return ruling.status
  return 403
}

async function readJsonBody(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > MAX_BODY) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be a JSON object')
  return parsed
}

export function apply(ctx) {
  let queue = Promise.resolve()

  function serial(task) {
    const run = queue.then(task, task)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  // Any composition change made anywhere in the profile bumps the revision the
  // settings page polls, so an install from the market or another panel shows
  // up here without a manual refresh.
  if (typeof ctx.on === 'function') {
    ctx.effect(() => {
      const off = ctx.on('plugin-manager/changed', () => {
        bumpRevision()
      })
      return () => {
        try {
          if (typeof off === 'function') off()
        } catch {
          /* disposed already */
        }
      }
    }, 'plugin-butler: revision feed')
  }

  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = hostCtx.webServer
    const connection = () => {
      try {
        return hostCtx.get('connection') || ctx.get('connection') || null
      } catch {
        return null
      }
    }
    const pluginManager = () => {
      try {
        return hostCtx.get('pluginManager') || ctx.get('pluginManager') || null
      } catch {
        return null
      }
    }

    const route = (path, handler) => {
      const off = webServer.register({
        kind: 'exact',
        path: API + path,
        handler: async (request, response) => {
          try {
            if (!sameOrigin(request)) {
              sendJson(response, 403, { ok: false, error: 'cross-origin request refused' })
              return
            }
            const status = admissionStatus(connection(), request)
            if (status) {
              sendJson(response, status, { ok: false, error: 'request not admitted' })
              return
            }
            const pm = pluginManager()
            if (!pm) {
              sendJson(response, 503, { ok: false, error: 'plugin manager unavailable' })
              return
            }
            await handler({ request, response, pm })
          } catch (error) {
            sendJson(response, 500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      })
      if (typeof off !== 'function') return () => {}
      return () => {
        try {
          off()
        } catch {
          /* disposed already */
        }
      }
    }

    const requirePost = (request, response) => {
      if (request.method === 'POST') return true
      sendJson(response, 405, { ok: false, error: 'POST required' })
      return false
    }

    hostCtx.effect(() => {
      const disposers = []

      disposers.push(
        route('/state', async ({ response, pm }) => {
          const state = await loadState()
          sendJson(response, 200, await readSnapshot(pm, state))
        }),
      )

      disposers.push(
        route('/revision', async ({ response }) => {
          sendJson(response, 200, { ok: true, revision, bootId: BOOT_ID })
        }),
      )

      disposers.push(
        route('/mode', async ({ request, response, pm }) => {
          if (!requirePost(request, response)) return
          const body = await readJsonBody(request)
          const mode = String(body.mode || '')
          if (!MODES.includes(mode)) {
            sendJson(response, 400, { ok: false, error: `mode must be one of ${MODES.join(', ')}` })
            return
          }
          const changes = await serial(async () => {
            const state = await loadState()
            state.mode = mode
            await saveState(state)
            if (mode === 'observe') return []
            return applySweep(pm, mode)
          })
          const state = await loadState()
          sendJson(response, 200, { ok: true, mode: state.mode, changes, snapshot: await readSnapshot(pm, state) })
        }),
      )

      disposers.push(
        route('/sweep', async ({ request, response, pm }) => {
          if (!requirePost(request, response)) return
          const body = await readJsonBody(request)
          const mode = String(body.mode || 'lean')
          if (mode !== 'lean' && mode !== 'all') {
            sendJson(response, 400, { ok: false, error: 'sweep mode must be lean or all' })
            return
          }
          const changes = await serial(() => applySweep(pm, mode))
          const state = await loadState()
          sendJson(response, 200, { ok: true, mode: state.mode, changes, snapshot: await readSnapshot(pm, state) })
        }),
      )

      disposers.push(
        route('/set', async ({ request, response, pm }) => {
          if (!requirePost(request, response)) return
          const body = await readJsonBody(request)
          const entryId = String(body.entryId || '')
          const enabled = Boolean(body.enabled)
          if (!entryId) {
            sendJson(response, 400, { ok: false, error: 'entryId is required' })
            return
          }
          const state = await loadState()
          const plugins = await pm.listPlugins()
          const target = plugins.find((entry) => entry.entryId === entryId)
          if (!target) {
            sendJson(response, 404, { ok: false, error: 'unknown entryId' })
            return
          }
          const row = describe(target, state)
          // Switching the butler off from its own panel tears down the panel
          // mid-request and leaves the user without the view they need to put
          // it back. Refuse it here; the plugin manager can still do it.
          if (row.self) {
            sendJson(response, 409, { ok: false, error: 'the butler cannot switch itself' })
            return
          }
          if (!row.writable) {
            sendJson(response, 409, { ok: false, error: row.readOnlyReason || 'row is read-only' })
            return
          }
          const changes = await serial(async () => {
            const result = await pm.setPluginEnabled(entryId, enabled)
            const fresh = await loadState()
            if (enabled) fresh.leases[entryId] = BOOT_ID
            else delete fresh.leases[entryId]
            await saveState(fresh)
            return [summarizeChange(entryId, enabled, result)]
          })
          bumpRevision()
          const fresh = await loadState()
          sendJson(response, 200, { ok: true, changes, snapshot: await readSnapshot(pm, fresh) })
        }),
      )

      disposers.push(
        route('/bundle', async ({ request, response, pm }) => {
          if (!requirePost(request, response)) return
          const body = await readJsonBody(request)
          const name = String(body.name || '')
          const enabled = Boolean(body.enabled)
          if (!name) {
            sendJson(response, 400, { ok: false, error: 'name is required' })
            return
          }
          if (typeof pm.setBundleEnabled !== 'function') {
            sendJson(response, 501, { ok: false, error: 'bundle switching is unavailable' })
            return
          }
          if (name === BUTLER_MODULE) {
            sendJson(response, 409, { ok: false, error: 'the butler cannot switch its own bundle' })
            return
          }
          const bundles = await pm.listBundles()
          const bundle = bundles.find((item) => item.name === name)
          if (!bundle) {
            sendJson(response, 404, { ok: false, error: 'unknown bundle' })
            return
          }
          const reason = bundleReason(bundle)
          if (reason) {
            sendJson(response, 409, { ok: false, error: reason })
            return
          }
          const changes = await serial(async () => {
            const result = await pm.setBundleEnabled(name, enabled)
            return [summarizeChange(name, enabled, result)]
          })
          bumpRevision()
          const state = await loadState()
          sendJson(response, 200, { ok: true, changes, snapshot: await readSnapshot(pm, state) })
        }),
      )

      disposers.push(
        route('/pin', async ({ request, response, pm }) => {
          if (!requirePost(request, response)) return
          const body = await readJsonBody(request)
          const entryId = String(body.entryId || '')
          const pinned = Boolean(body.pinned)
          if (!entryId) {
            sendJson(response, 400, { ok: false, error: 'entryId is required' })
            return
          }
          const plugins = await pm.listPlugins()
          if (!plugins.some((entry) => entry.entryId === entryId)) {
            sendJson(response, 404, { ok: false, error: 'unknown entryId' })
            return
          }
          const next = await serial(async () => {
            const state = await loadState()
            const set = new Set(state.pinned)
            if (pinned) set.add(entryId)
            else set.delete(entryId)
            state.pinned = [...set]
            return saveState(state)
          })
          sendJson(response, 200, { ok: true, changes: [], snapshot: await readSnapshot(pm, next) })
        }),
      )

      return () => {
        for (const off of disposers) off()
      }
    }, 'plugin-butler: http routes')
  })

  ctx.inject(['pluginManager'], (hostCtx) => {
    hostCtx.effect(() => {
      let cancelled = false
      const run = async () => {
        const pm = hostCtx.pluginManager
        await withRetry(async () => {
          const dropped = await prunePins(pm)
          if (dropped.length) {
            console.info(`[plugin-butler] dropped stale pins: ${dropped.join(', ')}`)
          }
          const state = await loadState()
          if (Object.keys(state.leases).length > 0) {
            state.leases = {}
            await saveState(state)
          }
          if (state.mode === 'observe') return
          await applySweep(pm, state.mode)
        })
        bumpRevision()
      }
      run().catch((error) => {
        if (cancelled) return
        console.warn('[plugin-butler] startup policy skipped:', (error && error.message) || error)
      })
      return () => {
        cancelled = true
      }
    }, 'plugin-butler: startup policy')
  })
}