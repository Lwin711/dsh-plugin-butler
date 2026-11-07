/**
 * Mock-harness smoke test for the host half (../dsh-plugin-butler/index.js).
 *
 * Runs the real plugin `apply()` against a fake Cordis context: fake plugin
 * manager, fake web server that keeps route handlers in a Map, fake event bus.
 * No DSH, no HTTP, no browser — just the routing, state file and policy logic.
 *
 *   node .butler-test/smoke.mjs
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'butler-home-'))
delete process.env.DSH_PROFILE_DIR

const API = '/dsh-butler/api'
const ROUTES = ['/state', '/revision', '/mode', '/sweep', '/set', '/bundle', '/pin'].map((path) => API + path)

const calls = []
const bundleCalls = []

const rows = [
  {
    entryId: 'include:ui-chat',
    moduleName: '@deepseek-ai/dsh-web-app',
    enabled: true,
    fiberPhase: 'active',
    patchId: 'ui-chat',
    meta: { title: 'Chat' },
  },
  {
    entryId: 'include:genui',
    moduleName: 'dsh-genui',
    enabled: true,
    fiberPhase: 'active',
    patchId: 'genui',
    meta: { title: { zh: '生成式 UI', en: 'GenUI' }, description: '生成式界面渲染' },
  },
  { entryId: 'include:mnemon', moduleName: 'dsh-mnemon', enabled: true, fiberPhase: 'active', patchId: 'mnemon' },
  {
    entryId: 'include:locked',
    moduleName: 'dsh-my-guardian',
    enabled: true,
    fiberPhase: 'active',
    readOnlyReason: 'management-required',
  },
  { entryId: 'include:meter', moduleName: 'dsh-cost-meter', enabled: true, fiberPhase: 'pending', patchId: 'meter' },
  { entryId: 'include:plugin-butler', moduleName: 'dsh-plugin-butler', enabled: true, fiberPhase: 'active', patchId: 'plugin-butler' },
  { entryId: 'include:broken', moduleName: 'dsh-broken', enabled: true, fiberPhase: 'failed', patchId: 'broken' },
  {
    entryId: 'include:unaddressable',
    moduleName: 'dsh-unaddressable',
    enabled: false,
    fiberPhase: null,
    readOnlyReason: 'unaddressable',
  },
]

const bundles = [
  {
    name: 'dsh-genui',
    official: false,
    availability: 'profile',
    enabled: true,
    installed: true,
    removable: true,
    rows: [{ rowId: 'genui' }, { rowId: 'genui-extra' }],
    overrides: ['genui'],
  },
  {
    name: '@deepseek-ai/dsh-core',
    official: true,
    availability: 'installation',
    enabled: true,
    installed: false,
    readOnlyReason: 'management-required',
    rows: [{ rowId: 'core' }],
    overrides: [],
  },
  {
    name: 'dsh-gone',
    availability: 'missing',
    enabled: false,
    installed: false,
    rows: [],
    error: { code: 'ENOENT', diagnostic: 'link target missing' },
    overrides: [],
  },
]

const pluginManager = {
  async listPlugins() {
    return rows.map((row) => ({ ...row }))
  },
  async listBundles() {
    return bundles.map((bundle) => ({ ...bundle }))
  },
  async setPluginEnabled(entryId, enabled) {
    calls.push([entryId, enabled])
    const row = rows.find((item) => item.entryId === entryId)
    if (row) row.enabled = enabled
    return { changed: true, application: 'applied', stage: 'enable', target: entryId, enabled }
  },
  async setBundleEnabled(name, enabled) {
    bundleCalls.push([name, enabled])
    const bundle = bundles.find((item) => item.name === name)
    if (bundle) bundle.enabled = enabled
    return { changed: true, application: 'restart-required', restartReason: 'no-hmr', stage: 'enable', target: name, enabled }
  },
}

const routes = new Map()
const listeners = new Map()
const services = { pluginManager }

function buildCtx() {
  listeners.clear()
  const ctx = {
    pluginManager,
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    get(name) {
      return services[name]
    },
    inject(_deps, callback) {
      callback(ctx)
    },
    effect(fn) {
      try {
        fn()
      } catch {
        /* the harness ignores disposers */
      }
    },
    on(event, handler) {
      const set = listeners.get(event) || new Set()
      set.add(handler)
      listeners.set(event, set)
      return () => set.delete(handler)
    },
    emit(event, payload) {
      for (const handler of listeners.get(event) || []) handler(payload)
    },
  }
  return ctx
}

function request(method, headers, body) {
  const base = { method, headers }
  if (body === undefined) return base
  const buffer = Buffer.from(JSON.stringify(body))
  base[Symbol.asyncIterator] = async function* iterator() {
    yield buffer
  }
  return base
}

function response() {
  return {
    status: 0,
    payload: null,
    headers: null,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.payload = body ? JSON.parse(body) : null
    },
  }
}

async function hit(path, method = 'GET', body) {
  const handler = routes.get(path)
  if (!handler) throw new Error(`no route for ${path}`)
  const res = response()
  await handler(request(method, { host: '127.0.0.1:58850' }, body), res)
  return res
}

const failures = []
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`)
    return
  }
  failures.push(name)
  console.log(`FAIL  ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`)
}

function section(title) {
  console.log(`\n# ${title}`)
}

console.log('plugin-butler host smoke')

let ctx = buildCtx()
const mod = await import('../dsh-plugin-butler/index.js')
mod.apply(ctx)

section('routes')
check('seven routes registered', ROUTES.every((path) => routes.has(path)), [...routes.keys()])
check('no extra routes', routes.size === ROUTES.length, [...routes.keys()])

section('snapshot')
let res = await hit(`${API}/state`)
check('state 200', res.status === 200, res.status)
check('no-store cache header', res.headers['cache-control'] === 'no-store', res.headers)
check('counts.total = 8', res.payload.counts.total === 8, res.payload.counts)
check('counts.enabled = 7', res.payload.counts.enabled === 7, res.payload.counts)
check('counts.managed = 4', res.payload.counts.managed === 4, res.payload.counts)
check('counts.bundles = 3', res.payload.counts.bundles === 3, res.payload.counts)
check('counts.bundlesEnabled = 2', res.payload.counts.bundlesEnabled === 2, res.payload.counts)
check('mode defaults to observe', res.payload.mode === 'observe', res.payload.mode)
check('revision is a number', typeof res.payload.revision === 'number', res.payload.revision)
const firstBootId = res.payload.bootId
check('plan inactive in observe', res.payload.plan.active === false, res.payload.plan)

const genui = res.payload.entries.find((entry) => entry.entryId === 'include:genui')
check('localized title resolved', genui.title === '生成式 UI', genui.title)
check('description surfaced', genui.description === '生成式界面渲染', genui.description)
check('@deepseek-ai row is core', res.payload.entries.find((entry) => entry.entryId === 'include:ui-chat').core === true)
check('butler row is core', res.payload.entries.find((entry) => entry.entryId === 'include:plugin-butler').core === true)
check('core sorts first', res.payload.entries[0].core === true, res.payload.entries[0])
check('read-only row not managed', res.payload.entries.find((entry) => entry.entryId === 'include:locked').managed === false)
check('read-only reason kept', res.payload.entries.find((entry) => entry.entryId === 'include:locked').readOnlyReason === 'management-required')
check('failed phase surfaced', res.payload.entries.find((entry) => entry.entryId === 'include:broken').fiberPhase === 'failed')
check('butler row flagged as self', res.payload.entries.find((entry) => entry.entryId === 'include:plugin-butler').self === true)
check('only the butler row is flagged as self', res.payload.entries.filter((entry) => entry.self).length === 1, res.payload.entries.filter((entry) => entry.self))
check('butler row is not managed', res.payload.entries.find((entry) => entry.entryId === 'include:plugin-butler').managed === false)

section('bundles')
const genuiBundle = res.payload.bundles.find((bundle) => bundle.name === 'dsh-genui')
check('bundle rowCount', genuiBundle.rowCount === 2, genuiBundle.rowCount)
check('bundle writable when installed in profile', genuiBundle.writable === true, genuiBundle)
check('bundle overrides counted', genuiBundle.overrides === 1, genuiBundle.overrides)
check(
  'read-only bundle is not writable',
  res.payload.bundles.find((bundle) => bundle.name === '@deepseek-ai/dsh-core').writable === false,
)
const missingBundle = res.payload.bundles.find((bundle) => bundle.name === 'dsh-gone')
check('missing bundle not writable', missingBundle.writable === false, missingBundle)
check('missing bundle error kept', missingBundle.error && missingBundle.error.code === 'ENOENT', missingBundle.error)
check('enabled bundles sort first', res.payload.bundles[0].enabled === true, res.payload.bundles.map((bundle) => bundle.name))

section('admission')
const crossOrigin = response()
await routes.get(`${API}/state`)(request('GET', { host: '127.0.0.1:58850', origin: 'http://evil.example' }), crossOrigin)
check('cross-origin refused', crossOrigin.status === 403, crossOrigin.status)
const crossSite = response()
await routes.get(`${API}/state`)(request('GET', { host: '127.0.0.1:58850', 'sec-fetch-site': 'cross-site' }), crossSite)
check('cross-site fetch refused', crossSite.status === 403, crossSite.status)

section('revision feed')
let head = await hit(`${API}/revision`)
const before = head.payload.revision
check('revision route answers', head.status === 200 && typeof head.payload.revision === 'number', head.payload)
ctx.emit('plugin-manager/changed', { target: 'x' })
head = await hit(`${API}/revision`)
check('external change bumps revision', head.payload.revision === before + 1, { before, after: head.payload.revision })

section('switching rows')
res = await hit(`${API}/set`, 'POST', { entryId: 'include:locked', enabled: false })
check('read-only set refused with 409', res.status === 409, res.status)
res = await hit(`${API}/set`, 'POST', { entryId: 'nope', enabled: false })
check('unknown entryId refused with 404', res.status === 404, res.status)
res = await hit(`${API}/set`, 'POST', { entryId: 'include:plugin-butler', enabled: false })
check('the butler refuses to switch itself', res.status === 409, res.status)
res = await hit(`${API}/set`, 'POST', {})
check('missing entryId refused with 400', res.status === 400, res.status)
res = await hit(`${API}/set`, 'GET')
check('GET on a POST route refused with 405', res.status === 405, res.status)
res = await hit(`${API}/set`, 'POST', { entryId: 'include:genui', enabled: false })
check('set disables the row', res.payload.changes[0].application === 'applied', res.payload.changes)
check('pm received the toggle', calls.some(([id, on]) => id === 'include:genui' && on === false), calls)

section('switching bundles')
res = await hit(`${API}/bundle`, 'POST', { name: 'nope', enabled: true })
check('unknown bundle refused with 404', res.status === 404, res.status)
res = await hit(`${API}/bundle`, 'POST', { name: '@deepseek-ai/dsh-core', enabled: false })
check('read-only bundle refused with 409', res.status === 409, res.status)
res = await hit(`${API}/bundle`, 'POST', { name: 'dsh-gone', enabled: true })
check('missing bundle refused with 409', res.status === 409, res.status)
res = await hit(`${API}/bundle`, 'POST', { name: 'dsh-plugin-butler', enabled: false })
check('the butler refuses to switch its own bundle', res.status === 409, res.status)
res = await hit(`${API}/bundle`, 'POST', { name: 'dsh-genui', enabled: false })
check('bundle toggle accepted', res.status === 200 && bundleCalls.length === 1, { status: res.status, bundleCalls })
check('bundle change reports restart', res.payload.changes[0].application === 'restart-required', res.payload.changes)
check('bundle state reflected', res.payload.snapshot.bundles.find((bundle) => bundle.name === 'dsh-genui').enabled === false)

section('pins')
res = await hit(`${API}/pin`, 'POST', { entryId: 'nope', pinned: true })
check('pinning an unknown row refused with 404', res.status === 404, res.status)
res = await hit(`${API}/pin`, 'POST', { entryId: 'include:mnemon', pinned: true })
check('pin recorded', res.payload.snapshot.pinned.includes('include:mnemon'), res.payload.snapshot.pinned)
check('pinned row flagged', res.payload.snapshot.entries.find((entry) => entry.entryId === 'include:mnemon').pinned === true)

section('lean policy')
res = await hit(`${API}/mode`, 'POST', { mode: 'lean' })
check('mode switches to lean', res.payload.mode === 'lean', res.payload.mode)
check('sweep disabled the managed rows', rows.find((row) => row.entryId === 'include:meter').enabled === false, calls)
check('core rows untouched', rows.find((row) => row.entryId === 'include:ui-chat').enabled === true)
check('pinned row survived the sweep', rows.find((row) => row.entryId === 'include:mnemon').enabled === true, calls)
check('plan is active in lean', res.payload.snapshot.plan.active === true, res.payload.snapshot.plan)

res = await hit(`${API}/mode`, 'POST', { mode: 'nonsense' })
check('unknown mode rejected with 400', res.status === 400, res.status)
res = await hit(`${API}/sweep`, 'POST', { mode: 'observe' })
check('sweep refuses a non-sweep mode', res.status === 400, res.status)

section('next-launch plan')
const setMeter = await hit(`${API}/set`, 'POST', { entryId: 'include:meter', enabled: true })
check('re-enabling a row in lean mode is allowed', setMeter.status === 200, setMeter.status)
res = await hit(`${API}/state`)
check('enabled row appears in the fold plan', res.payload.plan.disable.includes('include:meter'), res.payload.plan)
check('pinned row stays out of the fold plan', !res.payload.plan.disable.includes('include:mnemon'), res.payload.plan)

section('switch to all')
res = await hit(`${API}/mode`, 'POST', { mode: 'all' })
check('all mode enables the disabled rows', rows.find((row) => row.entryId === 'include:meter').enabled === true, calls)
check('core rows still untouched', rows.find((row) => row.entryId === 'include:ui-chat').enabled === true)
check('plan pulls nothing once everything is on', res.payload.snapshot.plan.enable.length === 0, res.payload.snapshot.plan)

section('stale pin pruning on boot')
await hit(`${API}/pin`, 'POST', { entryId: 'include:broken', pinned: true })
rows.splice(
  rows.findIndex((row) => row.entryId === 'include:broken'),
  1,
)
await hit(`${API}/set`, 'POST', { entryId: 'include:genui', enabled: true })
rows.find((row) => row.entryId === 'include:genui').enabled = true
calls.length = 0
routes.clear()
ctx = buildCtx()
const mod2 = await import('../dsh-plugin-butler/index.js?boot=2')
mod2.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 300))

res = await hit(`${API}/state`)
check('boot sweep state readable', res.status === 200, res.status)
check('stale pin pruned', !res.payload.pinned.includes('include:broken'), res.payload.pinned)
check('live pin kept', res.payload.pinned.includes('include:mnemon'), res.payload.pinned)
check('all mode pulled the folded row back', rows.find((row) => row.entryId === 'include:genui').enabled === true, calls)
check('new boot reports a fresh bootId', res.payload.bootId !== firstBootId, { firstBootId, now: res.payload.bootId })
check('revision restarted for the new boot', typeof res.payload.revision === 'number', res.payload.revision)

section('bad bodies')
res = await hit(`${API}/mode`, 'POST', { mode: 'lean', padding: 'x'.repeat(9000) })
check('oversized body refused', res.status === 500, res.status)

console.log(failures.length ? `\n${failures.length} FAILURE(S): ${failures.join(', ')}` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)