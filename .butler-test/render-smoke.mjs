/**
 * render-smoke.mjs — render the butler settings panel outside a browser.
 *
 * client-smoke.mjs stops at "the slot is registered and the client names all
 * seven endpoints". That leaves the interesting half untested: the panel body
 * itself only executes inside a browser, so a stray `undefined` or a missing
 * translation key would reach the user instead of the test suite.
 *
 * This harness provides a miniature React (hooks + re-render loop), a fetch
 * stub serving one snapshot, and a tree walker. It then asserts that the panel
 * renders, that every text node is real UI copy rather than a raw key, and that
 * a row toggle actually posts to /set.
 */
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = resolve(here, '..', 'dsh-plugin-butler', 'client.js')
const CLEAN = '\u001B[32mok\u001B[0m'
const DIRTY = '\u001B[31mFAIL\u001B[0m'
const notes = []
const failures = []

function check(name, condition, detail) {
  if (condition) {
    notes.push(name)
    console.log(`  ${CLEAN}  ${name}`)
  } else {
    failures.push({ name, detail })
    console.log(`  ${DIRTY}  ${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`)
  }
}

function section(title) {
  console.log(`\n# ${title}`)
}

/* ------------------------------------------------------------------ fixtures */

const snapshot = {
  ok: true,
  bootId: 'boot-render-1',
  revision: 7,
  mode: 'lean',
  pinned: ['include:genui'],
  statePath: 'C:/Users/LwinL/.dsh/butler/state.json',
  counts: { total: 4, enabled: 4, managed: 2, managedEnabled: 2, bundles: 4, bundlesEnabled: 2, pinned: 1 },
  plan: { mode: 'lean', active: true, disable: ['include:mnemon'], enable: [] },
  entries: [
    {
      entryId: 'include:ui-chat',
      moduleName: '@deepseek-ai/dsh-client-ui-chat',
      patchId: 'ui-chat',
      title: '聊天界面',
      description: '内置对话视图',
      enabled: true,
      fiberPhase: 'active',
      readOnlyReason: 'management-required',
      core: true,
      writable: false,
      managed: false,
      pinned: false,
      leased: false,
    },
    {
      entryId: 'include:genui',
      moduleName: 'dsh-genui',
      patchId: 'genui',
      title: '生成式 UI',
      description: '卡片渲染插件',
      enabled: true,
      fiberPhase: 'active',
      core: false,
      writable: true,
      managed: true,
      pinned: true,
      leased: false,
    },
    {
      entryId: 'include:mnemon',
      moduleName: 'dsh-mnemon',
      patchId: 'mnemon',
      title: null,
      description: null,
      enabled: true,
      fiberPhase: 'pending',
      core: false,
      writable: true,
      managed: true,
      pinned: false,
      leased: true,
    },
    {
      entryId: 'include:plugin-butler',
      moduleName: 'dsh-plugin-butler',
      patchId: 'plugin-butler',
      title: '插件管家',
      description: '按模式管理系统插件的启用状态',
      enabled: true,
      fiberPhase: 'active',
      core: true,
      self: true,
      writable: true,
      managed: false,
      pinned: false,
      leased: false,
    },
  ],
  bundles: [
    {
      name: 'dsh-genui',
      version: '0.3.1',
      description: 'card renderer',
      official: false,
      enabled: true,
      installed: true,
      availability: 'profile',
      removable: true,
      optional: false,
      writable: true,
      rowCount: 2,
      rows: [
        {
          rowId: 'row-genui-main',
          entryId: 'include:genui',
          moduleName: 'dsh-genui',
          meta: { title: { zh: '生成式 UI', en: 'Generative UI' } },
        },
        { rowId: 'row-genui-dashboard', moduleName: 'dsh-genui/dashboard', meta: { title: '仪表盘' } },
      ],
      overrides: 1,
    },
    {
      name: '@deepseek-ai/dsh-core',
      version: '1.0.0',
      enabled: false,
      installed: false,
      availability: 'installation',
      official: false,
      removable: false,
      optional: false,
      readOnlyReason: 'management-required',
      writable: false,
      rowCount: 5,
      rows: [],
      overrides: 0,
    },
    {
      name: 'dsh-gone',
      enabled: false,
      installed: false,
      availability: 'missing',
      error: { code: 'ENOENT', diagnostic: 'link target is gone' },
      writable: false,
      rowCount: 0,
      rows: [],
      overrides: 0,
    },
    {
      name: 'dsh-plugin-butler',
      version: '0.2.0',
      description: '插件管家',
      official: false,
      enabled: true,
      installed: true,
      availability: 'profile',
      removable: true,
      optional: false,
      self: true,
      writable: true,
      rowCount: 1,
      rows: [],
      overrides: 0,
    },
  ],
}

/* --------------------------------------------------------------- react stub */

let slots = []
let cursor = 0
let queue = []
let dirty = false
const effects = new Map()

function sameDeps(a, b) {
  if (!a || !b || a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

function useState(initial) {
  const index = cursor++
  if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
  const set = (next) => {
    const value = typeof next === 'function' ? next(slots[index]) : next
    if (Object.is(value, slots[index])) return
    slots[index] = value
    dirty = true
  }
  return [slots[index], set]
}

function useRef(initial) {
  const index = cursor++
  if (!(index in slots)) slots[index] = { current: initial }
  return slots[index]
}

function useCallback(fn, deps) {
  const index = cursor++
  const previous = slots[index]
  if (previous && sameDeps(previous.deps, deps)) return previous.fn
  slots[index] = { fn, deps }
  return fn
}

function useEffect(fn, deps) {
  const index = cursor++
  queue.push({ index, fn, deps })
}

const React = {
  createElement(type, props, ...children) {
    const merged = Object.assign({}, props || {})
    const flat = children.flat(Infinity).filter((child) => child !== undefined)
    if (flat.length) merged.children = flat.length === 1 ? flat[0] : flat
    return { type, props: merged }
  },
  Fragment: 'Fragment',
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo: (fn) => fn(),
}

/* ------------------------------------------------------------- environment */

const requests = []
const restarts = []
let closes = 0

function respond(data) {
  return { ok: true, status: 200, json: async () => data }
}

let revisionSupported = true

globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input)
  const method = String((init && init.method) || 'GET').toUpperCase()
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '')
  requests.push({ method, path, body: init && init.body ? JSON.parse(init.body) : null })
  if (path.endsWith('/revision')) {
    if (!revisionSupported) {
      return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
    }
    return respond({ ok: true, revision: snapshot.revision, bootId: snapshot.bootId })
  }
  if (path.endsWith('/state')) return respond(snapshot)
  return respond({
    ok: true,
    changes: [{ entryId: 'include:mnemon', enabled: false, changed: true, application: 'applied' }],
    snapshot: Object.assign({}, snapshot, { revision: snapshot.revision + 1 }),
  })
}

const timers = []
globalThis.setInterval = (fn, ms) => {
  timers.push({ fn, ms })
  return timers.length
}
globalThis.clearInterval = () => {}

const listeners = []
globalThis.window = {
  __dshHostShell: {
    restart() {
      restarts.push(Date.now())
    },
  },
  addEventListener(name, handler) {
    listeners.push({ target: 'window', name, handler })
  },
  removeEventListener() {},
}
globalThis.document = {
  addEventListener(name, handler) {
    listeners.push({ target: 'document', name, handler })
  },
  removeEventListener() {},
}

/* ------------------------------------------------------- module under test */

let payload = null
globalThis.window.__ModuleLoader__ = {
  load(next) {
    payload = next
  },
}

await import(pathToFileURL(clientPath).href)

section('module bootstrap')
check('loader captured a payload', Boolean(payload))
check('payload id is dsh-plugin-butler', Boolean(payload) && payload.id === 'dsh-plugin-butler')

let registration = null
let element = null
const zh = {}
const en = {}

const moduleExports = payload.factory((id) => (id === 'react' ? React : {}))
const ctx = {
  locale: {
    register(namespace, language, dictionary) {
      if (language === 'zh') Object.assign(zh, dictionary)
      if (language === 'en') Object.assign(en, dictionary)
    },
    bind() {
      return (key) => (Object.prototype.hasOwnProperty.call(zh, key) ? zh[key] : key)
    },
  },
  slots: {
    register(next, nextElement) {
      registration = next
      element = nextElement
      return () => {
        registration = null
        element = null
      }
    },
    inject(name, callback) {
      callback(ctx.slots)
      return () => {}
    },
  },
  effect(fn) {
    fn()
    return () => {}
  },
}

moduleExports.apply(ctx)

/* ------------------------------------------------------------ render loop */

function renderOnce() {
  cursor = 0
  queue = []
  const tree = element({ close: () => (closes += 1) })
  return tree
}

function runEffects() {
  for (const { index, fn, deps } of queue) {
    const previous = effects.get(index)
    if (previous && sameDeps(previous.deps, deps)) continue
    if (previous && typeof previous.cleanup === 'function') previous.cleanup()
    const cleanup = fn()
    effects.set(index, { deps, cleanup: typeof cleanup === 'function' ? cleanup : null })
  }
}

const flush = () => new Promise((done) => setTimeout(done, 0))

async function mount() {
  let resolvedTree = null
  for (let pass = 0; pass < 40; pass += 1) {
    dirty = false
    const elementTree = renderOnce()
    // Resolving the element tree is what actually executes the component
    // bodies; hooks only exist once those have run.
    resolvedTree = resolveTree(elementTree)
    runEffects()
    await flush()
    if (!dirty) return resolvedTree
  }
  throw new Error('panel never settled: a state update keeps re-rendering')
}

section('render')
let tree = null
let renderError = null
try {
  tree = await mount()
} catch (error) {
  renderError = error && error.message ? error.message : String(error)
}
check('panel rendered without throwing', renderError === null, renderError)

/* --------------------------------------------------------------- the tree */

function resolveTree(node) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map(resolveTree)
  if (typeof node === 'function') return resolveTree(node({}))
  if (typeof node.type === 'function') {
    const saved = cursor
    const rendered = node.type(node.props)
    cursor = saved
    return resolveTree(rendered)
  }
  const children = node.props ? node.props.children : undefined
  return {
    type: node.type,
    props: node.props || {},
    children: children === undefined ? [] : [].concat(resolveTree(children)).flat(Infinity).filter((c) => c !== null && c !== undefined),
  }
}

const resolved = tree

function walk(node, visit, ancestors = []) {
  if (node === null || node === undefined) return
  if (typeof node === 'string' || typeof node === 'number') {
    visit(node, ancestors)
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, ancestors)
    return
  }
  visit(node, ancestors)
  const next = ancestors.concat(node)
  for (const child of node.children || []) walk(child, visit, next)
}

function collectText(node) {
  const out = []
  walk(node, (hit) => {
    if (typeof hit === 'string' || typeof hit === 'number') out.push(String(hit))
  })
  return out.join(' ')
}

const text = collectText(resolved)
check('rendered a non-trivial tree', text.length > 200, text.length)

const interactive = []
walk(resolved, (hit, ancestors) => {
  if (hit && hit.props && typeof hit.props.onClick === 'function') {
    interactive.push({ node: hit, ancestors, label: collectText(hit) })
  }
})
check('rendered interactive controls', interactive.length >= 4, interactive.length)

/* ------------------------------------------------------ copy, not raw keys */

const rawKeys = new Set()
const bareToken = /^[a-z][a-zA-Z0-9]{2,}$/
const allowedBare = new Set(['active', 'pending', 'loading', 'failed', 'unloading', 'observe', 'lean', 'all'])
walk(resolved, (hit) => {
  if (typeof hit !== 'string') return
  const value = hit.trim()
  if (!bareToken.test(value)) return
  if (allowedBare.has(value)) return
  if (Object.prototype.hasOwnProperty.call(zh, value)) return
  rawKeys.add(value)
})
check('no raw translation keys leaked into the UI', rawKeys.size === 0, [...rawKeys])

check('the section heading is translated', text.includes(zh.nav || '插件管家'), zh.nav)
check('the pinned entry title is shown', text.includes('生成式 UI'))
check('an untitled entry falls back to its module name', text.includes('dsh-mnemon'))
check('a bundle version is shown', text.includes('0.3.1'))
check('the missing bundle is listed so the user can see the failure', text.includes('dsh-gone'))
check(
  'installable-but-absent bundles stay out of the list',
  !text.includes('@deepseek-ai/dsh-core'),
  text.includes('@deepseek-ai/dsh-core'),
)
check('the state file location is surfaced', text.includes('state.json'))

/* ------------------------------------------------------ self-protection UI */

const selfBadgeText = zh.selfBadge || '管家自身'
check('the butler labels itself in both lists', (text.match(new RegExp(selfBadgeText, 'g')) || []).length >= 2, text)

const switchNodes = []
walk(resolved, (hit) => {
  if (hit && hit.props && hit.props.role === 'switch') switchNodes.push(hit)
})
const liveSwitches = switchNodes.filter((node) => typeof node.props.onClick === 'function')
const expectedLive =
  snapshot.entries.filter((entry) => entry.writable && !entry.core && !entry.self).length +
  snapshot.bundles.filter((bundle) => bundle.writable && !bundle.self).length
check(
  'only switchable rows carry a handler',
  liveSwitches.length === expectedLive,
  { live: liveSwitches.length, expected: expectedLive },
)
check('every row and bundle renders exactly one switch', switchNodes.length === 7, switchNodes.length)
check(
  'a switch without a handler is marked disabled',
  switchNodes.filter((node) => typeof node.props.onClick !== 'function').every((node) => node.props.disabled === true),
  switchNodes.filter((node) => typeof node.props.onClick !== 'function').map((node) => node.props.title),
)

const lockedTitles = switchNodes
  .filter((node) => typeof node.props.onClick !== 'function')
  .map((node) => node.props.title)
const selfTitle = zh.selfLocked || '管家自身，请到插件市场里切换'
check(
  'a locked switch explains itself',
  lockedTitles.every((label) => typeof label === 'string' && label.trim() && !/^(开|关)$/.test(label)),
  lockedTitles,
)
check(
  'the butler switch names itself in both lists',
  lockedTitles.filter((label) => label === selfTitle).length === 2,
  lockedTitles,
)

section('interaction')
// The row container is the smallest ancestor subtree that mentions the entry
// and still owns a control: text alone would resolve to the module-name span.
const rowRoot = (() => {
  let best = null
  for (const item of interactive) {
    for (let index = item.ancestors.length - 1; index >= 0; index -= 1) {
      const node = item.ancestors[index]
      const text = collectText(node)
      if (!text.includes('dsh-mnemon')) continue
      if (!best || text.length < best.size) best = { size: text.length, node }
      break
    }
  }
  return best && best.node
})()
const rowClicks = []
if (rowRoot) {
  walk(rowRoot, (hit) => {
    if (hit && hit.props && typeof hit.props.onClick === 'function') rowClicks.push(hit)
  })
}
check('a managed row exposes controls', rowClicks.length >= 2, rowClicks.length)

let setRequest = null
for (const control of rowClicks) {
  requests.length = 0
  control.props.onClick({ preventDefault() {}, stopPropagation() {} })
  await flush()
  const posted = requests.find((request) => request.method === 'POST' && request.path === '/dsh-butler/api/set')
  if (posted) {
    setRequest = posted
    break
  }
}
check('toggling a row posts to /set', Boolean(setRequest), requests)
check(
  'the posted body names the entry and the flipped value',
  Boolean(setRequest) && setRequest.body.entryId === 'include:mnemon' && setRequest.body.enabled === false,
  setRequest && setRequest.body,
)

section('lifecycle')
check('no implicit host restart happened while rendering', restarts.length === 0, restarts.length)
check(
  'the panel registered a poll timer',
  timers.some((timer) => timer.ms >= 1000 && timer.ms <= 30000),
  timers.map((timer) => timer.ms),
)
check('the panel follows window focus', listeners.some((listener) => listener.target === 'window' && listener.name === 'focus'))
check(
  'the panel follows tab visibility',
  listeners.some((listener) => listener.target === 'document' && listener.name === 'visibilitychange'),
)
check('the dictionary covers zh and en equally', Object.keys(zh).length === Object.keys(en).length)

/* -------------------------------------------------------- bundle contents */

section('bundle modules')
let expandNode = null
walk(resolved, (hit) => {
  if (hit && hit.props && hit.props['aria-label'] === (zh.expand || '展开包内模块')) expandNode = hit
})
check('a bundle with modules can be expanded', Boolean(expandNode))
if (expandNode) {
  requests.length = 0
  expandNode.props.onClick({ preventDefault() {}, stopPropagation() {} })
  const nested = await mount()
  const nestedText = collectText(nested)
  check('expanding a bundle lists its modules', nestedText.includes('dsh-genui/dashboard'), nestedText.slice(-260))
  check('a module title comes from its meta', nestedText.includes('仪表盘'))
  check('a module without a live row is marked detached', nestedText.includes(zh.rowDetached || '未挂载'))
  check('expanding a bundle does not write anything', requests.length === 0, requests)
  let collapseNode = null
  walk(nested, (hit) => {
    if (hit && hit.props && hit.props['aria-label'] === (zh.collapse || '收起包内模块')) collapseNode = hit
  })
  check('the expanded bundle can be collapsed again', Boolean(collapseNode))
}

section('host compatibility')
const focusListener = listeners.find((listener) => listener.target === 'window' && listener.name === 'focus')
revisionSupported = false
requests.length = 0
if (focusListener) await focusListener.handler()
await flush()
check(
  'a host without /revision still gets a full refresh',
  requests.some((request) => request.path.endsWith('/state')),
  requests.map((request) => request.path),
)
const afterFallback = await mount()
check('the panel keeps its data when /revision is missing', collectText(afterFallback).includes('生成式 UI'))
revisionSupported = true

/* ------------------------------------------------------- legacy host shape */
// A host running an older build serves neither bundles, plan nor revision.
// Refreshing the page before DSH restarts must still render a usable panel.

section('legacy snapshot')
delete snapshot.bundles
delete snapshot.plan
delete snapshot.revision
delete snapshot.counts.bundles
delete snapshot.counts.bundlesEnabled
delete snapshot.counts.pinned
const legacy = await mount()
const legacyText = collectText(legacy)
check('a snapshot without bundles or plan still renders', legacyText.includes('dsh-mnemon'), legacyText.slice(-200))
check(
  'no undefined or NaN leaks into a legacy render',
  !legacyText.includes('undefined') && !legacyText.includes('NaN'),
  legacyText.slice(-200),
)

console.log('')
if (failures.length) {
  console.log(`${failures.length} check(s) failed:`)
  for (const failure of failures) console.log(`  - ${failure.name}`)
  process.exitCode = 1
} else {
  console.log(`all ${notes.length} checks passed`)
}