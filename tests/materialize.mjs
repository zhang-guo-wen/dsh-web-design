// tests/materialize.mjs — the bundled skills install, refresh, and uninstall safely.
//
// The install writes into the user's own agent skills directory, so the risky
// behaviors are the ones that touch something this plugin did not create. Each
// case below drives those paths directly rather than asserting on a happy install.
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(root, 'assets', 'skills')
const { materializeSkills, removeMaterializedSkills, MARKER_NAME, OWNER, resolveSkillsDir } = await import('../lib/index.mjs')

const failures = []
const check = (label, condition) => {
  if (condition) console.log(`  ok  ${label}`)
  else failures.push(label)
}

const work = await mkdtemp(join(tmpdir(), 'dsh-web-design-mat-'))
const targetDir = join(work, 'skills')
const opts = { sourceDir, targetDir, version: '1.0.0' }

try {
  // First install writes every bundled skill and marks each one as owned.
  const first = await materializeSkills(opts)
  check('first install writes skills', first.installed.length >= 60)
  check('first install leaves nothing unchanged', first.unchanged.length === 0)
  check('first install touches nothing foreign', first.foreign.length === 0)
  check('marker file is written', existsSync(join(targetDir, first.installed[0], MARKER_NAME)))
  const marker = JSON.parse(await readFile(join(targetDir, first.installed[0], MARKER_NAME), 'utf8'))
  check('marker records this owner', marker.owner === OWNER)
  check('marker records the version', marker.version === '1.0.0')

  // A second run at the same version must not rewrite the tree: the session
  // watcher would otherwise report every skill as changed on every boot.
  const second = await materializeSkills(opts)
  check('second install writes nothing', second.installed.length === 0)
  check('second install reports everything unchanged', second.unchanged.length === first.installed.length)

  // A version bump refreshes the recorded marker so a fixed skill replaces a
  // stale copy instead of staying broken forever.
  const bumped = await materializeSkills({ ...opts, version: '1.1.0' })
  check('version bump refreshes every skill', bumped.installed.length === first.installed.length)
  const refreshed = JSON.parse(await readFile(join(targetDir, first.installed[0], MARKER_NAME), 'utf8'))
  check('marker records the new version', refreshed.version === '1.1.0')

  // A user-authored skill with the same name must never be replaced or removed.
  const userSkill = join(targetDir, 'frontend-design')
  const userMarkerBefore = existsSync(join(userSkill, MARKER_NAME))
  await rm(join(userSkill, MARKER_NAME), { force: true })
  await writeFile(join(userSkill, 'SKILL.md'), '---\nname: frontend-design\ndescription: mine\n---\n\nmine\n', 'utf8')
  const withForeign = await materializeSkills(opts)
  check('an unmarked directory is left alone', withForeign.foreign.includes('frontend-design'))
  check('the user file survives', (await readFile(join(userSkill, 'SKILL.md'), 'utf8')).includes('mine'))

  // Uninstall removes exactly the owned skills.
  const removed = await removeMaterializedSkills({ targetDir })
  check('uninstall removes the owned skills', removed.length > 0)
  check('uninstall keeps the user directory', existsSync(userSkill))
  check('the target directory itself survives', existsSync(targetDir))
  check('uninstall left only the user skill', (await readdir(targetDir)).join(',') === 'frontend-design')

  // A selection installs only the named skills and removes only those.
  const subsetDir = join(work, 'subset')
  const subset = await materializeSkills({ sourceDir, targetDir: subsetDir, version: '1.0.0', skillNames: ['web-design-guidelines', 'frontend-design'] })
  check('subset install writes only the selection', subset.installed.length === 2)
  const subsetRemoved = await removeMaterializedSkills({ targetDir: subsetDir, skillNames: ['web-design-guidelines'] })
  check('subset uninstall removes only the selection', subsetRemoved.length === 1 && subsetRemoved[0] === 'web-design-guidelines')
  check('the unselected skill survives', existsSync(join(subsetDir, 'frontend-design')))

  // An unknown name is a configuration error, not a silent no-op.
  let rejected = false
  try {
    await materializeSkills({ sourceDir, targetDir: join(work, 'bad'), version: '1.0.0', skillNames: ['nope'] })
  } catch (error) {
    rejected = String(error).includes('unknown skill name')
  }
  check('an unknown skill name throws', rejected)

  // A missing bundle is a broken install and must surface.
  let missingRejected = false
  try {
    await materializeSkills({ sourceDir: join(work, 'absent'), targetDir: join(work, 'x'), version: '1.0.0' })
  } catch (error) {
    missingRejected = String(error).includes('not found')
  }
  check('a missing bundle throws', missingRejected)

  // Target resolution follows DSH_AGENTS_HOME, the same root the skill provider reads.
  const previous = process.env.DSH_AGENTS_HOME
  process.env.DSH_AGENTS_HOME = work
  check('target resolves under DSH_AGENTS_HOME', resolveSkillsDir() === join(work, 'skills'))
  check('explicit targetDir wins', resolveSkillsDir(join(work, 'custom')) === join(work, 'custom'))
  if (previous === undefined) delete process.env.DSH_AGENTS_HOME
  else process.env.DSH_AGENTS_HOME = previous
} finally {
  await rm(work, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\nmaterialize: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nmaterialize: install, refresh, ownership, and uninstall behave')
