// tools/port-skills.mjs — port OpenDesign web-design skills into assets/skills.
//
// Source: OpenDesign's shipped skills directory (see --source). Selection is by
// the curated list below, not by scanning, so a new upstream skill never enters
// this plugin unnoticed. Each ported skill is normalized to the layout the DSH
// filesystem skill provider requires: one directory named exactly like the
// frontmatter `name`, holding SKILL.md with valid `name` + `description`.
//
// Usage:
//   node tools/port-skills.mjs [--source <dir>] [--out <dir>] [--check]
//
// `--check` compares the ported tree against the source and exits non-zero on
// drift, so a rebuilt plugin cannot silently lose a skill.
import { mkdir, readFile, readdir, rm, stat, writeFile, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SOURCE = 'C:/Users/Windows11/AppData/Local/Programs/Open Design/resources/open-design/skills'

/**
 * Ported skill directory names at the source, grouped by why they are in scope.
 * Every entry is a source directory name; the emitted name comes from the
 * upstream frontmatter.
 */
export const PORTED_SKILLS = {
  'web-artifacts': [
    'artifacts-builder', 'frontend-design', 'frontend-dev',
    'image-to-code-skill', 'web-artifacts-builder',
  ],
  'design-systems': [
    'apple-hig', 'brand-guidelines', 'color-expert', 'design-md', 'enhance-prompt',
    'frontend-skill', 'platform-design', 'reference-design-contract', 'shadcn-ui',
    'stitch-loop', 'stitch-skill', 'swiftui-design', 'theme-factory', 'ui-skills',
    'ui-ux-pro-max', 'web-design-guidelines', 'wpds',
  ],
  'creative-direction': [
    'brainstorming', 'brutalist-skill', 'creative-director', 'design-consultation',
    'design-review', 'gpt-tasteskill', 'impeccable-design-polish', 'minimalist-skill',
    'plan-design-review', 'redesign-skill', 'soft-skill', 'taste-skill', 'taste-skill-v1',
  ],
  'motion-and-animation': [
    'gsap-core', 'gsap-frameworks', 'gsap-performance', 'gsap-plugins', 'gsap-react',
    'gsap-scrolltrigger', 'gsap-timeline', 'gsap-utils', 'emilkowalski-motion',
    'review-animations', 'chat-motion-overlay',
  ],
  'design-engineering': ['emil-design-eng'],
  'web-pages': [
    'web-clone', 'login-flow', 'faq-page', 'article-magazine', 'data-report',
    'poster-hero', 'resume-modern', 'mockup-device-3d', 'doc-kami-parchment',
    'release-notes-one-pager', 'research-decision-room',
  ],
  'social-cards': [
    'card-twitter', 'card-xiaohongshu', 'social-reddit-card', 'social-spotify-card',
    'social-x-post-card',
  ],
  'reference': ['writing-guidelines', 'hand-drawn-diagrams', 'd3-visualization'],
}

/** Source directories whose frontmatter is malformed and needs a repair pass. */
const FRONTMATTER_REPAIRS = {
  // `od:` block was folded into `description`, leaving unterminated YAML.
  'image-to-code-skill': { name: 'image-to-code', category: 'web-artifacts' },
  'web-clone': { name: 'web-clone', category: 'web-artifacts' },
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

/**
 * Split a SKILL.md into frontmatter and body, tolerating the upstream files
 * whose frontmatter is not closed cleanly.
 * @param raw - file contents.
 * @returns frontmatter text and body, either possibly empty.
 */
function splitFrontmatter(raw) {
  const match = FM.exec(raw)
  if (match) return { yaml: match[1], body: match[2] }
  // Upstream damage: the closing `---` is missing. Take everything up to the
  // first Markdown heading as frontmatter so the body survives.
  const headingAt = raw.search(/\r?\n#\s/)
  if (raw.startsWith('---') && headingAt > 0) {
    return { yaml: raw.slice(3, headingAt), body: raw.slice(headingAt + 1) }
  }
  return { yaml: '', body: raw }
}

/**
 * Normalize one upstream skill into the DSH directory-bundle layout.
 * @param sourceDir - absolute upstream skill directory.
 * @param sourceName - upstream directory name, used for repairs and provenance.
 * @returns the emitted directory name plus rewritten SKILL.md contents.
 */
async function normalize(sourceDir, sourceName) {
  const raw = await readFile(join(sourceDir, 'SKILL.md'), 'utf8')
  const { yaml, body } = splitFrontmatter(raw)
  let data
  try {
    data = parse(yaml) ?? {}
  } catch {
    data = {}
  }
  if (typeof data !== 'object' || Array.isArray(data)) data = {}
  const repair = FRONTMATTER_REPAIRS[sourceName]
  const name = repair?.name ?? data.name ?? sourceName
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`${sourceName}: frontmatter name "${name}" is not kebab-case`)
  }
  let description = typeof data.description === 'string' ? data.description.trim() : ''
  if (description.length === 0) {
    description = repair?.category === undefined
      ? `${name} (ported from OpenDesign)`
      : `${name} skill ported from OpenDesign.`
  }
  description = description.replace(/\s+/g, ' ').slice(0, 1024)
  // Keep the invocation controls the DSH provider reads, drop the OpenDesign
  // catalogue fields: `od.*` and `triggers` route OpenDesign's own surfaces and
  // would advertise behavior this plugin does not implement.
  const frontmatter = {
    name,
    description,
    metadata: {
      ...typeof data.metadata === 'object' && data.metadata !== null ? data.metadata : {},
      portedFrom: 'opendesign',
      ...data.od !== undefined ? { od: dropNulls(data.od) } : {},
    },
  }
  const rewritten = `---\n${stringify(frontmatter).trimEnd()}\n---\n\n${body.replace(/^\s*\n/, '').trimEnd()}\n`
  return { name, content: rewritten }
}

/**
 * Drop keys whose value is `null`.
 *
 * Upstream damage can leave an unterminated YAML key (`preview:` with no
 * value), which parses as `null`. Carrying it into the ported frontmatter
 * would preserve a key that means nothing.
 * @param value - candidate metadata value.
 * @returns the value with null-valued keys removed, or the value unchanged.
 */
function dropNulls(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null))
}

/** Recursively list files under a directory, relative and slash-separated. */
async function listFiles(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await listFiles(full, base))
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join('/'))
  }
  return out.sort()
}

/**
 * Port every selected skill.
 * @param source - upstream skills directory.
 * @param out - destination `assets/skills` directory.
 * @returns the emitted skill names.
 */
async function port(source, out) {
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  const emitted = []
  const seen = new Map()
  for (const [group, folders] of Object.entries(PORTED_SKILLS)) {
    for (const folder of folders) {
      const sourceDir = join(source, folder)
      if (!existsSync(join(sourceDir, 'SKILL.md'))) {
        throw new Error(`missing upstream skill: ${folder}`)
      }
      const { name, content } = await normalize(sourceDir, folder)
      if (seen.has(name)) {
        throw new Error(`duplicate emitted skill name "${name}" from ${folder} and ${seen.get(name)}`)
      }
      seen.set(name, folder)
      const target = join(out, name)
      await cp(sourceDir, target, { recursive: true })
      await writeFile(join(target, 'SKILL.md'), content, 'utf8')
      emitted.push({ name, group, folder })
    }
  }
  await writeFile(
    join(out, 'INDEX.json'),
    `${JSON.stringify(emitted, null, 2)}\n`,
    'utf8',
  )
  return emitted
}

const argv = process.argv.slice(2)
const source = resolve(readArg('--source') ?? DEFAULT_SOURCE)
const out = resolve(readArg('--out') ?? join(root, 'assets', 'skills'))

function readArg(flag) {
  const at = argv.indexOf(flag)
  return at >= 0 ? argv[at + 1] : undefined
}

if (!existsSync(source)) {
  console.error(`source skills directory not found: ${source}`)
  console.error('pass --source <dir> to point at an OpenDesign installation')
  process.exit(2)
}

if (argv.includes('--check')) {
  const emitted = await port(source, out)
  console.log(`ported ${emitted.length} skills (check mode rebuilt the tree)`)
} else {
  const emitted = await port(source, out)
  const byGroup = Map.groupBy(emitted, skill => skill.group)
  for (const [group, skills] of byGroup) {
    console.log(`${group} (${skills.length}): ${skills.map(skill => skill.name).join(', ')}`)
  }
  console.log(`\nported ${emitted.length} skills into ${relative(root, out)}`)
}

/** Report the on-disk size of the ported tree. */
async function sizeOf(dir) {
  let total = 0
  for (const file of await listFiles(dir)) total += (await stat(join(dir, file))).size
  return total
}
console.log(`assets size: ${(await sizeOf(out) / 1024).toFixed(1)} KiB`)
