/**
 * Browser-half smoke test (../dsh-plugin-butler/client.js).
 *
 * The client is a module-loader payload, not an ES module, so this test stubs
 * `window.__ModuleLoader__` to capture the factory, hands it a minimal React
 * stub, and then drives the real `apply()` against a fake slots/locale context.
 *
 * That exercises everything except rendering: dictionary parity, the slot
 * registration, and every `t('…')` key written literally in the source.
 *
 *   node .butler-test/client-smoke.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'dsh-plugin-butler', 'client.js')
const source = readFileSync(clientPath, 'utf8')

let spec = null
globalThis.window = {
  __ModuleLoader__: {
    load(next) {
      spec = next
    },
  },
}

await import(`file:///${clientPath.replace(/\\/g, '/')}`)

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

console.log('plugin-butler client smoke')

section('module payload')
check('module loader received a payload', Boolean(spec), spec && Object.keys(spec))
check('payload id is dsh-plugin-butler', spec && spec.id === 'dsh-plugin-butler', spec && spec.id)
check('factory is a function', spec && typeof spec.factory === 'function')

const ReactStub = {
  createElement: () => null,
  useState: () => [null, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
}

const mod = spec.factory((id) => (id === 'react' ? ReactStub : {}))
check('factory returned an apply hook', mod && typeof mod.apply === 'function', mod && Object.keys(mod))
check('injects the slots service', Array.isArray(mod.inject) && mod.inject.includes('slots'), mod.inject)

const dicts = {}
let registration = null
let element = null
let disposer = null
const boundCalls = []

const ctx = {
  locale: {
    register(namespace, language, dictionary) {
      dicts[namespace] = dicts[namespace] || {}
      dicts[namespace][language] = dictionary
    },
    bind(namespace) {
      boundCalls.push(namespace)
      return (key) => (dicts[namespace] && dicts[namespace].zh ? dicts[namespace].zh[key] : undefined)
    },
  },
  slots: {
    inject(slot, factory) {
      check('slot injected is settings.section', slot === 'settings.section', slot)
      disposer = factory()
    },
    register(next, nextElement) {
      registration = next
      element = nextElement
      return () => {
        registration = null
      }
    },
  },
  effect: (fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
  },
}

mod.apply(ctx)

section('locale')
check('registered the zh dictionary', Boolean(dicts['dsh-plugin-butler'] && dicts['dsh-plugin-butler'].zh))
check('registered the en dictionary', Boolean(dicts['dsh-plugin-butler'] && dicts['dsh-plugin-butler'].en))
check('bound the namespace', boundCalls.includes('dsh-plugin-butler'), boundCalls)

const zh = dicts['dsh-plugin-butler'] && dicts['dsh-plugin-butler'].zh ? dicts['dsh-plugin-butler'].zh : {}
const en = dicts['dsh-plugin-butler'] && dicts['dsh-plugin-butler'].en ? dicts['dsh-plugin-butler'].en : {}
const zhKeys = Object.keys(zh).sort()
const enKeys = Object.keys(en).sort()
const missingEn = zhKeys.filter((key) => !(key in en))
const missingZh = enKeys.filter((key) => !(key in zh))
check('zh and en define the same keys', missingEn.length === 0 && missingZh.length === 0, { missingEn, missingZh })
check('dictionaries are non-trivial', zhKeys.length >= 60, zhKeys.length)

section('literal translation keys')
const literal = new Set()
for (const match of source.matchAll(/\bt\('([A-Za-z0-9_]+)'\)/g)) literal.add(match[1])
for (const match of source.matchAll(/\[\s*'([A-Za-z0-9_]+)'\s*,\s*T\./g)) literal.add(match[1])
const unknown = [...literal].filter((key) => !(key in zh))
check('every literal t() key exists in the dictionary', unknown.length === 0, unknown)

const required = [
  'bundlesTitle',
  'bundlesHint',
  'avInstall',
  'avMissing',
  'bundleErr',
  'rowsUnit',
  'planObserve',
  'planClean',
  'planDisable',
  'planEnable',
  'statBundles',
  'statPinned',
  'phasePending',
  'phaseLoading',
  'phaseUnloading',
  'phaseFailed',
  'roManaged',
  'roUnaddress',
  'warnCount',
  'emptyBundles',
]
const absent = required.filter((key) => !(key in zh) || !(key in en))
check('v0.2.0 keys are present in both languages', absent.length === 0, absent)

section('slot registration')
check('registered something', Boolean(registration), registration)
check('slot name is settings.section', registration && registration.name === 'settings.section', registration && registration.name)
check('slot id is plugin-butler', registration && registration.id === 'plugin-butler', registration && registration.id)
check('slot order is 45', registration && registration.order === 45, registration && registration.order)
check('slot label resolves', Boolean(registration && typeof registration.label === 'function' && registration.label()), registration && typeof registration.label === 'function' && registration.label())
check('slot locale namespace set', registration && registration.locale === 'dsh-plugin-butler', registration && registration.locale)
check('element factory provided', typeof element === 'function')

section('endpoints')
for (const path of ['/state', '/revision', '/mode', '/sweep', '/set', '/pin', '/bundle']) {
  check(`client references ${path}`, source.includes(`'${path}'`))
}
check('polls on an interval', /setInterval\(tick, POLL_MS\)/.test(source))
check('listens for window focus', source.includes("addEventListener('focus'"))
check('listens for visibility changes', source.includes("addEventListener('visibilitychange'"))

section('teardown')
check('slot inject returned a disposer', typeof disposer === 'function')
if (typeof disposer === 'function') {
  disposer()
  check('disposer removed the registration', registration === null)
}

console.log(failures.length ? `\n${failures.length} FAILURE(S): ${failures.join(', ')}` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)