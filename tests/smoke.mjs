// tests/smoke.mjs — the host half applies against a real Cordis context.
//
// A plugin that throws at import or at apply takes down the host that loads it,
// and the failure class (a decorator left un-lowered, a missing service, a
// duplicated registration) is only visible by actually applying the built entry
// to a real context. This uses Cordis itself rather than a hand-written mock, so
// the service base classes see the context they expect.
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'

const failures = []
const check = (label, condition) => {
  if (condition) console.log(`  ok  ${label}`)
  else failures.push(label)
}

const plugin = await import('../lib/index.mjs')

check('exports name', plugin.name === 'web-design')
// `connection` carries the HTTP route registry and exists on the web host only.
// Requiring it would keep the whole plugin, review Remote included, from loading
// on the desktop host, which speaks IPC and has no such service.
check('requires only the filesystem, not the web-only connection service', Array.isArray(plugin.inject)
  && plugin.inject.includes('fs') && !plugin.inject.includes('connection'))
check('exports apply', typeof plugin.apply === 'function')
check('exports WebDesignRemote', typeof plugin.WebDesignRemote === 'function')
check('exports TYPERT_REMOTE with every descriptor', plugin.TYPERT_REMOTE?.descriptors?.length === 4)
check('descriptors cover read, write, apply, and assets', ['read', 'write', 'apply', 'assets'].every(
  method => plugin.TYPERT_REMOTE.descriptors.some(descriptor => descriptor.method === method),
))
check('remote namespace', plugin.REMOTE_NAMESPACE === 'webDesignReview')
check('exports no skill installer', !('materializeSkills' in plugin) && !('resolveSkillsDir' in plugin))

const root = await mkdtemp(join(tmpdir(), 'dsh-web-design-smoke-'))
/** An agents home the plugin must leave untouched: it owns no skill directory. */
const agentsHome = join(root, 'agents-home')
const previousAgentsHome = process.env.DSH_AGENTS_HOME
process.env.DSH_AGENTS_HOME = agentsHome
try {
  const ctx = new Context()
  // The asset route is registered from `apply`, so the services it needs are
  // present first — the same order the Loader guarantees through `inject`.
  /** Routes the fake Connection accepted. */
  const routes = []
  ctx.provide('connection', { fetch: { register: (route) => { routes.push(route); return async () => {} } } })
  ctx.provide('fs', {
    resolve: async (path) => path,
    contains: () => true,
    processPath: (value) => value,
    stat: async () => ({ type: 'file' }),
  })
  ctx.provide('sessions', { get: () => ({ header: { cwd: root } }) })
  let applied = true
  try {
    plugin.apply(ctx)
  } catch (error) {
    applied = false
    console.error(`apply threw: ${error?.stack ?? error}`)
  }
  check('apply does not throw', applied)
  check('registers the Remote on the context', ctx.get('webDesignReview') !== undefined)
  // The route installs through `ctx.inject`, so it lands a turn after apply.
  await new Promise(resolve => setTimeout(resolve, 200))
  check('registers the preview asset route', routes.some(route => route.path === plugin.PREVIEW_ROUTE))

  // Skill installation used to run beside the effect, so give a stray write the
  // same turn it would have had before asserting on disk.
  await new Promise(resolve => setTimeout(resolve, 200))
  const written = existsSync(agentsHome) ? await readdir(agentsHome) : []
  check('writes nothing into the agent skills directory', written.length === 0)
} finally {
  if (previousAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME
  else process.env.DSH_AGENTS_HOME = previousAgentsHome
  await rm(root, { recursive: true, force: true })
}

// The desktop host speaks IPC and provides no `connection` service. The plugin
// must still load there: the review Remote is what the preview needs, and the
// asset route is a web-only extra. Requiring `connection` once stopped this
// plugin from loading at all on that host.
{
  const desktopRoot = await mkdtemp(join(tmpdir(), 'dsh-web-design-desktop-'))
  try {
    const ctx = new Context()
    ctx.provide('fs', {
      resolve: async (path) => path,
      contains: () => true,
      processPath: (value) => value,
      stat: async () => ({ type: 'file' }),
    })
    ctx.provide('sessions', { get: () => ({ header: { cwd: desktopRoot } }) })
    ctx.plugin({ name: plugin.name, inject: plugin.inject, apply: plugin.apply })
    await new Promise(resolve => setTimeout(resolve, 200))
    check('loads on a host without the connection service', ctx.get('webDesignReview') !== undefined)
  } finally {
    await rm(desktopRoot, { recursive: true, force: true })
  }
}

if (failures.length > 0) {
  console.error(`\nsmoke: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nsmoke: host half applies cleanly')
