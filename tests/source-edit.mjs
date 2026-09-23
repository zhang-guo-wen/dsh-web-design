// tests/source-edit.mjs — writing edits back into the source preserves the file.
//
// This is the one operation that mutates the user's own artifact, so the cases
// below pin the two ways it could go wrong: rewriting bytes it was not asked to
// touch, and reporting success for an edit that never reached the file.
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { applySourceEdits, parseSelector } = await import('../lib/index.mjs')

const failures = []
const check = (label, condition) => {
  if (condition) console.log(`  ok  ${label}`)
  else failures.push(label)
}
const section = (label) => { console.log(`\n- ${label}`) }
const edit = (selector, declarations) => ({ selector, declarations, updatedAt: 'now' })

const SOURCE = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <!-- keep this comment -->',
  '  <title>Demo</title>',
  '  <style>',
  '    h1 { color: red; }',
  '  </style>',
  '</head>',
  '<body>',
  '  <main class="page">',
  '    <h1 class="title">Hello</h1>',
  '    <p>Body copy</p>',
  '  </main>',
  '</body>',
  '</html>',
  '',
].join('\n')

section('selector grammar')
check('parses a plain tag', JSON.stringify(parseSelector('h1')) === JSON.stringify([{ tag: 'h1' }]))
check('parses an id step', JSON.stringify(parseSelector('main#page > h1')).includes('"id":"page"'))
check('parses nth-of-type', JSON.stringify(parseSelector('ul > li:nth-of-type(2)')).includes('"nth":2'))
check('rejects a class selector', parseSelector('h1.title') === undefined)
check('rejects a descendant selector', parseSelector('main h1') === undefined)
check('rejects an empty selector', parseSelector('   ') === undefined)

section('style write-back')
const H1 = 'body > main > h1'
const styled = applySourceEdits(SOURCE, [edit(H1, { 'font-size': '56px', color: '#123456' })])
check('reports the edit as applied', styled.applied.includes(H1))
check('reports nothing skipped', styled.skipped.length === 0)
check('adds a style attribute to the element', styled.source.includes('<h1 class="title" style="font-size: 56px; color: #123456">'))
check('keeps the element text', styled.source.includes('>Hello</h1>'))
check('keeps the existing class attribute', styled.source.includes('class="title"'))

// Everything outside the one start tag must be byte-identical.
const beforeLines = SOURCE.split('\n').filter(line => !line.includes('<h1 class="title"'))
const afterLines = styled.source.split('\n').filter(line => !line.includes('<h1 class="title"'))
check('leaves every other line untouched', beforeLines.join('\n') === afterLines.join('\n'))
check('keeps html comments', styled.source.includes('<!-- keep this comment -->'))
check('keeps the inline stylesheet', styled.source.includes('h1 { color: red; }'))
check('keeps doctype and lang', styled.source.startsWith('<!doctype html>') && styled.source.includes('lang="en"'))
check('preserves the trailing newline', styled.source.endsWith('</html>\n'))

section('existing style attribute is merged, not duplicated')
const inline = applySourceEdits('<html><body><p style="color: red; margin: 0">x</p></body></html>', [
  edit('body > p', { color: 'blue', 'font-size': '18px' }),
])
check('did not add a second style attribute', (inline.source.match(/style=/g) ?? []).length === 1)
check('overrode the existing declaration', inline.source.includes('color: blue'))
check('kept the untouched declaration', inline.source.includes('margin: 0'))
check('added the new declaration', inline.source.includes('font-size: 18px'))

section('text write-back')
const texted = applySourceEdits(SOURCE, [], { [H1]: 'Goodbye & <welcome>' })
check('replaces the element text', texted.source.includes('>Goodbye &amp; &lt;welcome&gt;</h1>'))
check('leaves the surrounding markup alone', texted.source.includes('<h1 class="title"'))
check('reports the text edit as applied', texted.applied.includes(H1))

// An element with nested markup is refused rather than flattened.
const nested = applySourceEdits('<html><body><p>a <b>bold</b> c</p></body></html>', [], { 'body > p': 'plain' })
check('refuses an element with nested markup', nested.skipped.some(entry => entry.reason === 'element has no editable text'))
check('leaves a refused element unchanged', nested.source.includes('<b>bold</b>'))

section('unresolvable edits are reported, never silently dropped')
const missing = applySourceEdits(SOURCE, [edit('body > section', { color: 'red' })])
check('reports the missing element', missing.skipped.some(entry => entry.reason === 'element not found in source'))
check('did not change the file', missing.source === SOURCE)

const badSelector = applySourceEdits(SOURCE, [edit('h1.some-class', { color: 'red' })])
check('reports an unsupported selector', badSelector.skipped.some(entry => entry.reason === 'unsupported selector grammar'))
check('did not change the file for a bad selector', badSelector.source === SOURCE)

// nth-of-type addresses the right sibling among same-tag children.
const list = '<html><body><ul><li>one</li><li>two</li><li>three</li></ul></body></html>'
const second = applySourceEdits(list, [edit('body > ul > li:nth-of-type(2)', { color: 'red' })])
check('nth-of-type picks the right sibling', second.source.includes('<li style="color: red">two</li>'))
check('leaves other siblings alone', second.source.includes('<li>one</li>') && second.source.includes('<li>three</li>'))

section('multiple edits in one pass')
const multi = applySourceEdits(SOURCE, [
  edit(H1, { color: 'red' }),
  edit('body > main > p', { 'font-size': '14px' }),
], { 'body > main > p': 'New copy' })
check('applies every style edit', multi.source.includes('<h1 class="title" style="color: red">')
  && multi.source.includes('<p style="font-size: 14px">'))
check('applies the text edit alongside', multi.source.includes('New copy</p>'))
check('skipped nothing', multi.skipped.length === 0)
// Later offsets must not shift earlier replacements.
check('preserves content between the edited elements', multi.source.indexOf('<h1') < multi.source.indexOf('<p style'))

section('idempotence and no-op input')
check('empty edit list returns the source unchanged', applySourceEdits(SOURCE, []).source === SOURCE)
const once = applySourceEdits(SOURCE, [edit(H1, { color: 'red' })])
const twice = applySourceEdits(once.source, [edit(H1, { color: 'red' })])
check('re-applying the same edit is stable', twice.source === once.source)
check('re-applying still finds the element', twice.applied.length === 1)

section('malformed input does not corrupt the file')
// `parse` wraps a bare fragment in html/head/body, so the path a frame viewing
// it would produce is rooted at body — and that is what resolves here.
const fragment = applySourceEdits('<p>partial', [edit('body > p', { color: 'red' })])
check('a fragment without html/body is still editable', fragment.source.includes('style="color: red"'))
check('a fragment keeps its text', fragment.source.includes('partial'))
check('a fragment path that does not exist is reported', applySourceEdits('<p>x</p>', [edit('p', { color: 'red' })]).skipped.length === 1)

const emptyDoc = applySourceEdits('', [edit('body', { color: 'red' })])
check('an empty document reports the miss', emptyDoc.skipped.length === 1)
check('an empty document stays empty', emptyDoc.source === '')

section('the frame selector and the source locator agree')
// The preview computes a selector from the rendered DOM; this module resolves it
// against the source text. If the two disagree, every Save to file silently
// misses, so each selector shape the frame emits is pinned here.
const SEAM = '<!doctype html>\n<html><body>\n  <section class="hero">\n    <h1 id="title" class="big">A</h1>\n    <ul><li>one</li><li>two</li><li>three</li></ul>\n    <div><p>inside</p></div>\n  </section>\n</body></html>\n'
for (const [label, selector] of [
  ['an element with an id stops the walk', 'body > section > h1#title'],
  ['second of same-tag siblings', 'body > section > ul > li:nth-of-type(2)'],
  ['third of same-tag siblings', 'body > section > ul > li:nth-of-type(3)'],
  ['a lone sibling drops nth-of-type', 'body > section > ul > li'],
  ['an ancestor without an id', 'body > section'],
  ['a nested path', 'body > section > div > p'],
]) {
  const resolved = applySourceEdits(SEAM, [edit(selector, { color: 'red' })])
  check(label, resolved.applied.includes(selector))
}

// The frame stops its walk at the nearest ancestor carrying an id, so a path can
// begin at that ancestor rather than at body. Such a path is relative to the
// anchor, not to the document root, and must resolve at whatever depth the
// anchor sits.
const ANCHORED = '<!doctype html>\n<html><body>\n  <main>\n    <section id="features">\n      <div class="wrap">\n        <div class="head"><h2>Title</h2></div>\n        <div class="grid"><article><h3>Card</h3></article><article><h3>Two</h3></article></div>\n      </div>\n    </section>\n  </main>\n</body></html>\n'
for (const [label, selector] of [
  ['id-anchored path into a deep child', 'section#features > div > div:nth-of-type(1) > h2'],
  ['id-anchored path to a sibling group', 'section#features > div > div:nth-of-type(2) > article:nth-of-type(2)'],
  ['id-anchored path one level down', 'section#features > div'],
  ['the anchor itself', 'section#features'],
]) {
  const resolved = applySourceEdits(ANCHORED, [edit(selector, { color: 'red' })])
  check(label, resolved.applied.includes(selector))
}

// A path shape the frame never produces stays unresolved rather than guessing.
check('a bare tag is not a frame selector', applySourceEdits(ANCHORED, [edit('h2', { color: 'red' })]).applied.length === 0)
check('an unknown id anchor does not resolve', applySourceEdits(ANCHORED, [edit('section#nope > div', { color: 'red' })]).applied.length === 0)

if (failures.length > 0) {
  console.error(`\nsource-edit: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nsource-edit: write-back is targeted, preserved, and honest about misses')
