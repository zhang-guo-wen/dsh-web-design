// tests/annotations.mjs — the review sidecar round-trips and refuses bad input.
//
// The Host Remote is a process boundary: the browser half submits the document,
// so the store validates it. These cases drive the write path with the payloads
// a buggy or hostile client would send, and confirm the ones that must be
// rejected are rejected rather than stored.
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { readAnnotations, writeAnnotations, validateWrite, sidecarPath, validateWrite: validate } =
  await import('../lib/index.mjs')

const failures = []
const check = (label, condition) => {
  if (condition) console.log(`  ok  ${label}`)
  else failures.push(label)
}

const work = await mkdtemp(join(tmpdir(), 'dsh-web-design-ann-'))
try {
  const file = join(work, 'index.html')
  await writeFile(file, '<!doctype html><html><body><h1>hi</h1></body></html>\n', 'utf8')

  check('sidecar sits beside the file', sidecarPath(file) === `${file}.design.json`)
  check('no review yet', (await readAnnotations(file)) === null)

  const document = {
    version: 1,
    file,
    comments: [
      {
        id: 'c-1',
        kind: 'element',
        element: {
          selector: 'body > h1',
          tag: 'h1',
          classes: [],
          text: 'hi',
          rect: { x: 0, y: 0, width: 100, height: 20 },
        },
        body: 'Headline is too small.',
        severity: 'issue',
        resolved: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'c-2',
        kind: 'region',
        region: { x: 10, y: 10, width: 50, height: 50 },
        body: 'This block feels crowded.',
        severity: 'nit',
        resolved: true,
        createdAt: new Date().toISOString(),
      },
    ],
    edits: [{ selector: 'body > h1', declarations: { 'font-size': '32px' }, updatedAt: new Date().toISOString() }],
    updatedAt: new Date().toISOString(),
  }

  const written = await writeAnnotations(file, document)
  check('write reports the comment count', written.comments === 2)
  check('write reports the edit count', written.edits === 1)

  const loaded = await readAnnotations(file)
  check('round-trips both comments', loaded?.comments.length === 2)
  check('round-trips the element anchor', loaded?.comments[0]?.element?.selector === 'body > h1')
  check('round-trips the region anchor', loaded?.comments[1]?.region?.width === 50)
  check('round-trips the resolved flag', loaded?.comments[1]?.resolved === true)
  check('round-trips the style edit', loaded?.edits[0]?.declarations['font-size'] === '32px')

  // The sidecar is JSON text a person can read and diff.
  const raw = await readFile(sidecarPath(file), 'utf8')
  check('sidecar is formatted JSON', raw.startsWith('{') && raw.includes('\n  "comments"'))

  // A corrupt sidecar reads as "no review" rather than throwing into the
  // preview's load path.
  await writeFile(sidecarPath(file), '{ not json', 'utf8')
  check('corrupt sidecar reads as absent', (await readAnnotations(file)) === null)

  // A sidecar that belongs to another file is refused, so a copy cannot attach
  // one file's review to another.
  await writeFile(sidecarPath(file), JSON.stringify({ ...document, file: '/elsewhere.html' }), 'utf8')
  check('mismatched file reads as absent', (await readAnnotations(file)) === null)

  // Write validation: a document for another path is rejected outright.
  let mismatchRejected = false
  try {
    validateWrite(file, { ...document, file: '/elsewhere.html' })
  } catch (error) {
    mismatchRejected = String(error).includes('does not match')
  }
  check('write rejects a mismatched path', mismatchRejected)

  let versionRejected = false
  try {
    validateWrite(file, { ...document, version: 2 })
  } catch (error) {
    versionRejected = String(error).includes('unsupported document version')
  }
  check('write rejects an unknown version', versionRejected)

  let shapeRejected = false
  try {
    validateWrite(file, { ...document, comments: 'nope' })
  } catch (error) {
    shapeRejected = String(error).includes('must be arrays')
  }
  check('write rejects a malformed collection', shapeRejected)

  let nullRejected = false
  try {
    validateWrite(file, null)
  } catch (error) {
    nullRejected = String(error).includes('must be an object')
  }
  check('write rejects a null document', nullRejected)

  // Bounds: an oversized comment body is capped, not stored whole.
  const huge = validate(file, {
    ...document,
    comments: [{ ...document.comments[0], body: 'x'.repeat(20000) }],
  })
  check('an oversized comment body is capped', huge.comments[0].body.length === 8000)

  // Bounds: an unknown severity falls back to the least alarming value.
  const odd = validate(file, {
    ...document,
    comments: [{ ...document.comments[0], severity: 'catastrophe' }],
  })
  check('an unknown severity falls back to note', odd.comments[0].severity === 'note')

  // Bounds: more comments than the cap are truncated.
  const many = validate(file, {
    ...document,
    comments: Array.from({ length: 600 }, (_, index) => ({ ...document.comments[0], id: `c-${index}` })),
  })
  check('excess comments are truncated', many.comments.length === 500)

  // The `apply` path is the one operation that rewrites the user's own file.
  // Drive it through the Remote so the atomic write and the reported result are
  // covered together.
  const { Context } = await import('@deepseek-ai/cordis')
  const { WebDesignRemote } = await import('../lib/index.mjs')
  const ctx = new Context()
  const sessionId = 'review-session'
  ctx.provide('sessions', { get: id => id === sessionId ? { header: { cwd: work } } : undefined })
  ctx.provide('sandboxPolicy', { workspaceRoot: work })
  ctx.provide('fs', {
    resolve: async (path, options) => ({ targetKey: await realpath(resolve(options?.cwd ?? work, path)) }),
    contains: (parent, child) => {
      const tail = relative(parent.targetKey, child.targetKey)
      return tail === '' || (!tail.startsWith('..') && !isAbsolute(tail))
    },
    stat: async target => ({ type: (await stat(target.targetKey)).isFile() ? 'file' : 'directory' }),
    processPath: target => target.targetKey,
  })
  const remote = new WebDesignRemote(ctx)
  const target = join(work, 'apply.html')
  const fileRef = { sessionId, path: 'apply.html' }
  const page = '<!doctype html>\n<html><body>\n  <h1 class="t">Hi</h1>\n</body></html>\n'
  await writeFile(target, page, 'utf8')

  const firstRead = await remote.read({ file: fileRef })
  check('read returns the Session-resolved absolute path', firstRead.path === target)
  check('read sees no sidecar yet', firstRead.document === null)
  const remoteWritten = await remote.write({ file: fileRef, document: { ...document, file: target } })
  check('write stores the review beside the Session file', remoteWritten.storePath === `${target}.design.json`)

  let mismatchedWrite = false
  try {
    await remote.write({ file: fileRef, document: { ...document, file } })
  } catch (error) {
    mismatchedWrite = String(error).includes('submitted review document was rejected')
  }
  check('write rejects a document for a different absolute path', mismatchedWrite)

  const applied = await remote.apply({
    file: fileRef,
    edits: [{ selector: 'body > h1', declarations: { color: 'red' }, updatedAt: 'now' }],
    textEdits: { 'body > h1': 'Hello' },
  })
  // One selector carries both a style edit and a text replacement, so the
  // result names it once.
  check('apply reports the edited selector', applied.applied.length === 1 && applied.applied[0] === 'body > h1')
  check('apply reports nothing skipped', applied.skipped.length === 0)
  check('apply reports the file changed', applied.changed === true)
  const rewritten = await readFile(target, 'utf8')
  check('the file on disk carries the style', rewritten.includes('<h1 class="t" style="color: red">'))
  check('the file on disk carries the new text', rewritten.includes('>Hello</h1>'))
  check('the rest of the file is untouched', rewritten.startsWith('<!doctype html>\n<html><body>\n') && rewritten.endsWith('</body></html>\n'))

  // A second identical apply is a no-op write.
  const again = await remote.apply({
    file: fileRef,
    edits: [{ selector: 'body > h1', declarations: { color: 'red' }, updatedAt: 'now' }],
    textEdits: { 'body > h1': 'Hello' },
  })
  check('re-applying reports no change', again.changed === false)

  // A selector that does not exist is reported and the file stays byte-identical.
  const beforeMiss = await readFile(target, 'utf8')
  const missed = await remote.apply({
    file: fileRef,
    edits: [{ selector: 'body > aside', declarations: { color: 'red' }, updatedAt: 'now' }],
    textEdits: {},
  })
  check('a missing selector is reported', missed.skipped.length === 1)
  check('a missing selector leaves the file alone', await readFile(target, 'utf8') === beforeMiss)

  // A malformed request is a typed failure, not a silent success.
  let rejected = false
  try {
    await remote.apply({ file: fileRef, edits: 'nope', textEdits: {} })
  } catch (error) {
    rejected = String(error).includes('edits')
  }
  check('a malformed apply request is rejected', rejected)

  let noPath = false
  try {
    await remote.apply({ file: { sessionId, path: '' }, edits: [], textEdits: {} })
  } catch (error) {
    noPath = String(error).includes('path')
  }
  check('apply requires a path', noPath)

  let unknownSession = false
  try {
    await remote.read({ file: { sessionId: 'missing-session', path: 'apply.html' } })
  } catch (error) {
    unknownSession = String(error).includes('does not exist')
  }
  check('a missing Session fails before reading the file', unknownSession)

  ctx.provide('sessionPersistence', {
    stat: async id => id === 'stored-session' ? { header: { cwd: work } } : undefined,
  })
  const storedRead = await remote.read({ file: { sessionId: 'stored-session', path: 'apply.html' } })
  check('a persisted Session resolves its relative file path', storedRead.path === target)

  const outsideName = `${basename(work)}-outside-review.html`
  const outside = join(dirname(work), outsideName)
  await writeFile(outside, '<p>outside</p>')
  try {
    let escaped = false
    try {
      await remote.read({ file: { sessionId, path: `../${outsideName}` } })
    } catch (error) {
      escaped = String(error).includes('outside the Session workspace')
    }
    check('a relative path above the Session workspace is rejected', escaped)
  } finally {
    await rm(outside, { force: true })
  }

  let directoryRejected = false
  try {
    await remote.read({ file: { sessionId, path: '.' } })
  } catch (error) {
    directoryRejected = String(error).includes('not a regular file')
  }
  check('a directory cannot be used as a review file', directoryRejected)
} finally {
  await rm(work, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\nannotations: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nannotations: review sidecar round-trips and rejects invalid payloads')
