/**
 * Materialize the bundled web-design skills into the agent skills directory.
 *
 * The DeepSeek Harness filesystem skill provider discovers directory bundles
 * under `$DSH_AGENTS_HOME/skills` (`~/.agents/skills` by default). Copying the
 * plugin's bundled skills there is what makes them appear in a session's skill
 * catalog, including for agents that never load this plugin's own Host half.
 *
 * Ownership is explicit: every directory this module writes carries a marker
 * file recording the plugin and version that wrote it. A directory without that
 * marker belongs to the user and is never overwritten or removed; a directory
 * whose content drifted from the bundled source is refreshed only when it is
 * still marked as ours.
 *
 * @module @guowenzhang/dsh-web-design/skills
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, mkdir, rm, stat, writeFile, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

/** Marker filename identifying a directory this plugin owns. */
export const MARKER_NAME = '.dsh-web-design.json'

/** Summary of one materialization pass. */
export interface MaterializeReport {
  /** Directory the skills were written to. */
  readonly targetDir: string
  /** Skill directory names written or refreshed in this pass. */
  readonly installed: readonly string[]
  /** Skill directory names already current, so nothing was written. */
  readonly unchanged: readonly string[]
  /** Skill names skipped because the target directory is not owned by this plugin. */
  readonly foreign: readonly string[]
}

/** The marker payload written into every owned skill directory. */
interface OwnershipMarker {
  /** Owner identity; a different value makes the directory foreign. */
  readonly owner: string
  /** Plugin version that last wrote the directory. */
  readonly version: string
  /** Content digest of the skill's files, so a stale copy can be refreshed. */
  readonly digest: string
}

/** Plugin identity recorded in ownership markers. */
export const OWNER = '@guowenzhang/dsh-web-design'

/**
 * Resolve the agent skills directory the same way the filesystem skill provider
 * does, so both halves agree without importing it.
 * @param configured - explicit `targetDir` from plugin config, when set.
 * @returns the absolute target directory.
 */
export function resolveSkillsDir(configured?: string): string {
  if (configured !== undefined && configured.length > 0) return resolve(expandHome(configured))
  const agentsHome = process.env.DSH_AGENTS_HOME
  const base = agentsHome !== undefined && agentsHome.length > 0
    ? resolve(expandHome(agentsHome))
    : join(homedir(), '.agents')
  return join(base, 'skills')
}

/** Expand a leading `~` against the user's home directory. */
function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * List the skill directory names bundled with this plugin.
 * @param sourceDir - absolute `assets/skills` directory.
 * @returns sorted skill names, excluding the generated index file.
 */
export async function listBundledSkills(sourceDir: string): Promise<string[]> {
  const entries = await readdir(sourceDir, { withFileTypes: true })
  return entries
    .filter(entry => entry.isDirectory() && existsSync(join(sourceDir, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort()
}

/**
 * Copy every bundled skill into the agent skills directory.
 *
 * A skill already present with the same digest is left untouched, so repeated
 * applies do not rewrite files the session watcher would then report as
 * changed. A skill present but stale is replaced, because a stale copy from an
 * older plugin version is exactly what would otherwise keep a fixed skill
 * broken forever.
 * @param options - bundled and target directories, plugin version, and the
 *   skill allowlist from plugin config.
 * @returns what the pass installed, left alone, and refused to touch.
 * @throws when the bundled source directory does not exist, since silently
 *   installing nothing would look like a working plugin.
 */
export async function materializeSkills(options: {
  readonly sourceDir: string
  readonly targetDir: string
  readonly version: string
  readonly skillNames?: readonly string[]
}): Promise<MaterializeReport> {
  const { sourceDir, targetDir, version } = options
  if (!existsSync(sourceDir)) {
    throw new Error(`web-design: bundled skills directory not found at ${sourceDir}`)
  }
  const bundled = await listBundledSkills(sourceDir)
  const selected = options.skillNames === undefined || options.skillNames.length === 0
    ? bundled
    : bundled.filter(name => options.skillNames?.includes(name) === true)
  const unknown = (options.skillNames ?? []).filter(name => !bundled.includes(name))
  if (unknown.length > 0) {
    throw new Error(`web-design: unknown skill name(s) in config: ${unknown.join(', ')}`)
  }

  await mkdir(targetDir, { recursive: true })
  const installed: string[] = []
  const unchanged: string[] = []
  const foreign: string[] = []

  for (const name of selected) {
    const source = join(sourceDir, name)
    const target = join(targetDir, name)
    const digest = await digestDirectory(source)
    const marker = await readMarker(target)
    if (marker !== undefined && marker.owner !== OWNER) {
      foreign.push(name)
      continue
    }
    const present = existsSync(join(target, 'SKILL.md'))
    if (present && marker?.digest === digest && marker.version === version) {
      unchanged.push(name)
      continue
    }
    if (present && marker === undefined) {
      // An unmarked directory is the user's own work; never replace it.
      foreign.push(name)
      continue
    }
    await rm(target, { recursive: true, force: true })
    await cp(source, target, { recursive: true })
    const written: OwnershipMarker = { owner: OWNER, version, digest }
    await writeFile(join(target, MARKER_NAME), `${JSON.stringify(written, null, 2)}\n`, 'utf8')
    installed.push(name)
  }

  return { targetDir, installed, unchanged, foreign }
}

/**
 * Remove every skill directory this plugin owns.
 *
 * Called when the plugin stops. Directories the user created are left alone,
 * and the target directory itself is never removed, because other producers
 * share it.
 * @param options - target directory and optional allowlist matching the one
 *   {@link materializeSkills} was given.
 * @returns the skill names removed.
 */
export async function removeMaterializedSkills(options: {
  readonly targetDir: string
  readonly skillNames?: readonly string[]
}): Promise<string[]> {
  const { targetDir } = options
  if (!existsSync(targetDir)) return []
  const removed: string[] = []
  for (const name of await listBundledSkillsOrAny(targetDir)) {
    if (options.skillNames !== undefined && options.skillNames.length > 0 && !options.skillNames.includes(name)) {
      continue
    }
    const target = join(targetDir, name)
    const marker = await readMarker(target)
    if (marker?.owner !== OWNER) continue
    await rm(target, { recursive: true, force: true })
    removed.push(name)
  }
  return removed
}

/** List skill directories under a directory, tolerating individual read failures. */
async function listBundledSkillsOrAny(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter(entry => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort()
}

/** Read one directory's ownership marker, or `undefined` when absent or unreadable. */
async function readMarker(dir: string): Promise<OwnershipMarker | undefined> {
  try {
    const raw = await readFile(join(dir, MARKER_NAME), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const candidate = parsed as Partial<OwnershipMarker>
    if (typeof candidate.owner !== 'string' || typeof candidate.version !== 'string' || typeof candidate.digest !== 'string') {
      return undefined
    }
    return { owner: candidate.owner, version: candidate.version, digest: candidate.digest }
  } catch {
    // A missing or malformed marker means "not ours"; the caller treats that as foreign.
    return undefined
  }
}

/**
 * Digest a skill directory's contents, excluding the ownership marker itself
 * so a marker write cannot change the digest it records.
 * @param dir - skill directory.
 * @returns a stable hex digest over sorted relative paths and file bytes.
 */
export async function digestDirectory(dir: string): Promise<string> {
  const hash = createHash('sha256')
  for (const file of await listRelativeFiles(dir)) {
    if (file === MARKER_NAME) continue
    hash.update(file)
    hash.update('\0')
    hash.update(await readFile(join(dir, file)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** Recursively list files under a directory as sorted slash-separated relative paths. */
async function listRelativeFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await listRelativeFiles(full, base))
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join('/'))
  }
  return out.sort()
}

/** Whether a path exists and is a directory. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    // An absent path is simply not a directory.
    return false
  }
}
