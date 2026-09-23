// tests/skills.mjs — every bundled skill must load under the DSH provider's rules.
//
// The filesystem skill provider silently ignores a skill whose frontmatter is
// invalid, which would ship a broken port without any visible failure. This
// check applies the same rules it does, plus the layout rule this plugin adds:
// the directory name must equal the frontmatter name, so the catalog name and
// the installed directory agree.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillsDir = join(root, 'assets', 'skills')
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const problems = []
let valid = 0
let referenceFiles = 0

for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const name = entry.name
  const dir = join(skillsDir, name)
  const skillFile = join(dir, 'SKILL.md')
  if (!existsSync(skillFile)) {
    problems.push(`${name}: no SKILL.md`)
    continue
  }
  const raw = readFileSync(skillFile, 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  if (match === null) {
    problems.push(`${name}: frontmatter is not a closed '---' block`)
    continue
  }
  let data
  try {
    data = parse(match[1])
  } catch (error) {
    problems.push(`${name}: frontmatter is not valid YAML: ${error.message}`)
    continue
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    problems.push(`${name}: frontmatter is not a mapping`)
    continue
  }
  if (typeof data.name !== 'string' || !SKILL_NAME.test(data.name)) {
    problems.push(`${name}: name "${String(data.name)}" is not kebab-case`)
    continue
  }
  if (data.name !== name) {
    problems.push(`${name}: directory name does not match frontmatter name "${data.name}"`)
    continue
  }
  if (typeof data.description !== 'string' || data.description.trim().length === 0) {
    problems.push(`${name}: description is missing or empty`)
    continue
  }
  if (data.description.length > 1024) {
    problems.push(`${name}: description is ${data.description.length} characters`)
    continue
  }
  // The DSH provider reads the body as instructions; an empty body would
  // advertise a skill that loads to nothing.
  if (raw.slice(match[0].length).trim().length === 0) {
    problems.push(`${name}: body is empty`)
    continue
  }
  valid += 1
  referenceFiles += countFiles(dir) - 1
}

/** Count regular files under a directory. */
function countFiles(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countFiles(join(dir, entry.name))
    else if (entry.isFile()) total += 1
  }
  return total
}

if (problems.length > 0) {
  console.error(`skills: ${problems.length} problem(s)`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

const index = JSON.parse(readFileSync(join(skillsDir, 'INDEX.json'), 'utf8'))
if (index.length !== valid) {
  console.error(`skills: INDEX.json lists ${index.length} skills but ${valid} are installed`)
  process.exit(1)
}

console.log(`skills: ${valid} valid, ${referenceFiles} reference file(s), index consistent`)
