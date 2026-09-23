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
check('exports inject', Array.isArray(plugin.inject))
check('exports Config', typeof plugin.Config === 'function' || typeof plugin.Config === 'object')
check('exports apply', typeof plugin.apply === 'function')
check('exports WebDesignRemote', typeof plugin.WebDesignRemote === 'function')
check('exports TYPERT_REMOTE with every descriptor', plugin.TYPERT_REMOTE?.descriptors?.length === 3)
check('descriptors cover read, write, and apply', ['read', 'write', 'apply'].every(
  method => plugin.TYPERT_REMOTE.descriptors.some(descriptor => descriptor.method === method),
))
check('remote namespace', plugin.REMOTE_NAMESPACE === 'webDesignReview')

const root = await mkdtemp(join(tmpdir(), 'dsh-web-design-smoke-'))
try {
  const targetDir = join(root, 'skills')
  const ctx = new Context()
  let applied = true
  try {
    plugin.apply(ctx, { enabled: true, targetDir, skillNames: [], verifyOnLoad: false })
  } catch (error) {
    applied = false
    console.error(`apply threw: ${error?.stack ?? error}`)
  }
  check('apply does not throw', applied)
  check('registers the Remote on the context', ctx.get('webDesignReview') !== undefined)

  // The install runs beside the effect, so give its promise a turn before
  // asserting on disk.
  await new Promise(resolve => setTimeout(resolve, 400))
  const installed = existsSync(targetDir) ? (await readdir(targetDir)).length : 0
  check('installed the bundled skills', installed >= 60)

  // A disabled plugin must install nothing but must still serve the Remote the
  // browser half always mounts.
  const offDir = join(root, 'skills-off')
  const offCtx = new Context()
  plugin.apply(offCtx, { enabled: false, targetDir: offDir, skillNames: [], verifyOnLoad: false })
  await new Promise(resolve => setTimeout(resolve, 100))
  check('disabled installs nothing', !existsSync(offDir))
  check('disabled still registers the Remote', offCtx.get('webDesignReview') !== undefined)

  // An unknown skill name is a misconfiguration and must fail loud rather than
  // silently installing a smaller catalog.
  const badCtx = new Context()
  let warned = ''
  badCtx.logger.warn = (message) => { warned = String(message) }
  plugin.apply(badCtx, { enabled: true, targetDir: join(root, 'skills-bad'), skillNames: ['no-such-skill'], verifyOnLoad: false })
  await new Promise(resolve => setTimeout(resolve, 300))
  check('unknown skill name is reported', warned.includes('unknown skill name'))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\nsmoke: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nsmoke: host half applies cleanly')
