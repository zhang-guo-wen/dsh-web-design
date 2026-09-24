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
check('exports inject', Array.isArray(plugin.inject) && plugin.inject.length === 0)
check('exports apply', typeof plugin.apply === 'function')
check('exports WebDesignRemote', typeof plugin.WebDesignRemote === 'function')
check('exports TYPERT_REMOTE with every descriptor', plugin.TYPERT_REMOTE?.descriptors?.length === 3)
check('descriptors cover read, write, and apply', ['read', 'write', 'apply'].every(
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
  let applied = true
  try {
    plugin.apply(ctx)
  } catch (error) {
    applied = false
    console.error(`apply threw: ${error?.stack ?? error}`)
  }
  check('apply does not throw', applied)
  check('registers the Remote on the context', ctx.get('webDesignReview') !== undefined)

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

if (failures.length > 0) {
  console.error(`\nsmoke: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nsmoke: host half applies cleanly')
