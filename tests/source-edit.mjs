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
const removal = (selector, text, classes = []) => ({ selector, text, classes })

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
check('rejects an unescaped special-character id', parseSelector('section#cards:large > h2') === undefined)
check('rejects zero nth-of-type', parseSelector('li:nth-of-type(0)') === undefined)

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

const moved = applySourceEdits('<html><body><div id="card" style="color: red">Card</div></body></html>', [
  edit('div#card', { position: 'relative', left: '12px', top: '-4px', transform: 'rotate(3deg)', translate: '12px -4px' }),
])
check('writes element movement through its existing inline style', moved.source.includes('color: red; position: relative; left: 12px; top: -4px; transform: rotate(3deg); translate: 12px -4px'))
check('reports the movement as applied', moved.applied.includes('div#card') && moved.skipped.length === 0)

section('text write-back')
const texted = applySourceEdits(SOURCE, [], { [H1]: 'Goodbye & <welcome>' })
check('replaces the element text', texted.source.includes('>Goodbye &amp; &lt;welcome&gt;</h1>'))
check('leaves the surrounding markup alone', texted.source.includes('<h1 class="title"'))
check('reports the text edit as applied', texted.applied.includes(H1))

const foot = '<html><body><p class="foot">还没有账号？<a href="/register"><strong>免费注册</strong></a></p></body></html>'
const footResult = applySourceEdits(foot, [], { 'body > p': '已有账号 & <登录>？' })
check('rewrites the one direct text node beside a link', footResult.source
  === foot.replace('还没有账号？', '已有账号 &amp; &lt;登录&gt;？'))
check('preserves the nested link and its attributes byte for byte', footResult.source.includes('<a href="/register"><strong>免费注册</strong></a>'))
check('reports the mixed-content text edit as applied', footResult.applied.includes('body > p') && footResult.skipped.length === 0)

const spacedFoot = '<html><body><p id="foot">还没有账号？<a>免费注册</a>\n  </p></body></html>'
const spacedFootResult = applySourceEdits(spacedFoot, [], { 'p#foot': '已有账号？' })
check('ignores a whitespace-only direct text node after the link', spacedFootResult.source
  === spacedFoot.replace('还没有账号？', '已有账号？'))

const nested = '<html><body><p>a <b>bold</b> c</p></body></html>'
const nestedResult = applySourceEdits(nested, [], { 'body > p': 'plain' })
check('refuses multiple meaningful direct text nodes around nested markup', nestedResult.skipped.some(entry => entry.reason === 'element has no editable text'))
check('leaves an ambiguous mixed element unchanged', nestedResult.source === nested)
const mixed = '<html><body><div id="card"><span>inside</span> tail</div></body></html>'
const mixedResult = applySourceEdits(mixed, [], { 'div#card': 'replacement' })
check('rewrites a sole direct text node after nested markup', mixedResult.source
  === mixed.replace(' tail', 'replacement'))
check('preserves the child element while editing its parent direct text', mixedResult.source.includes('<span>inside</span>replacement'))
const innerResult = applySourceEdits(mixed, [], { 'div#card > span': 'changed' })
check('edits the clicked nested text element alone', innerResult.source.includes('<span>changed</span> tail'))

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

section('ambiguous or stale selectors cannot rewrite a different element')
const duplicateId = '<html><body><section id="dupe"><p>first</p></section><section id="dupe"><p>second</p></section></body></html>'
const duplicateResult = applySourceEdits(duplicateId, [edit('section#dupe > p', { color: 'red' })])
check('reports a duplicate id anchor', duplicateResult.skipped.some(entry => entry.reason === 'duplicate id in source'))
check('does not rewrite either duplicate id target', duplicateResult.source === duplicateId)

const staleChild = applySourceEdits('<html><body><section id="hero"><p>original</p></section></body></html>', [
  edit('section#hero > h2', { color: 'red' }),
])
check('a missing child is reported instead of falling back to its parent', staleChild.skipped.some(entry => entry.reason === 'element not found in source'))
check('a missing child does not style its parent', !staleChild.source.includes('style='))

const mismatchedTag = applySourceEdits('<html><body><section id="hero">original</section></body></html>', [
  edit('div#hero', { color: 'red' }),
])
check('an id with a different tag is rejected', mismatchedTag.skipped.some(entry => entry.reason === 'id anchor tag differs from source'))
check('an id with a different tag changes nothing', !mismatchedTag.source.includes('style='))

const ambiguousSiblings = '<html><body><main><p>first</p><p>second</p></main></body></html>'
const ambiguousResult = applySourceEdits(ambiguousSiblings, [edit('body > main > p', { color: 'red' })])
check('a path missing nth-of-type is reported as ambiguous', ambiguousResult.skipped.some(entry => entry.reason === 'ambiguous selector in source'))
check('an ambiguous path changes nothing', ambiguousResult.source === ambiguousSiblings)

const changedSiblings = applySourceEdits('<html><body><main><p>only source child</p></main></body></html>', [
  edit('body > main > p:nth-of-type(1)', { color: 'red' }),
])
check('a preview sibling count that differs from source is reported', changedSiblings.skipped.some(entry => entry.reason === 'sibling count differs from preview'))
check('a changed sibling count leaves the source unchanged', !changedSiblings.source.includes('style='))

const duplicateEdit = applySourceEdits('<html><body><p>one</p></body></html>', [
  edit('body > p', { color: 'red' }),
  edit('body > p', { color: 'blue' }),
])
check('overlapping replacements are reported', duplicateEdit.skipped.some(entry => entry.reason === 'overlapping source edits'))
check('only one style attribute is added for duplicate requests', (duplicateEdit.source.match(/style=/g) ?? []).length === 1)

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

section('element deletion preserves every byte outside the selected span')
const deletedHeading = applySourceEdits(SOURCE, [], {}, [removal(H1, 'Hello', ['title'])])
check('removes the selected element and its text', !deletedHeading.source.includes('<h1 class="title">Hello</h1>'))
check('preserves all source outside the element span', deletedHeading.source === SOURCE.replace('<h1 class="title">Hello</h1>', ''))
check('reports the deletion as applied', deletedHeading.applied.includes(H1) && deletedHeading.skipped.length === 0)

const blockSource = '<!doctype html>\n<html><body><main id="page"><section id="drop"><h2>Title</h2><p>Body</p></section><section id="keep">Keep</section></main></body></html>\n'
const deletedBlock = applySourceEdits(blockSource, [], {}, [removal('section#drop', 'TitleBody')])
check('deletes a whole nested block', deletedBlock.source === blockSource.replace('<section id="drop"><h2>Title</h2><p>Body</p></section>', ''))
check('does not touch a sibling block', deletedBlock.source.includes('<section id="keep">Keep</section>'))
const imageSource = '<html><body><main><img id="old" src="old.png"><p>Keep</p></main></body></html>'
const deletedImage = applySourceEdits(imageSource, [], {}, [removal('img#old', '')])
check('deletes a void element by its complete source span', deletedImage.source === imageSource.replace('<img id="old" src="old.png">', ''))

section('deletion takes priority over edits and nested deletion requests')
const deletedWithEdits = applySourceEdits(blockSource, [
  edit('section#drop', { color: 'red' }),
  edit('section#drop > h2', { color: 'blue' }),
  edit('section#keep', { color: 'green' }),
], { 'section#drop > h2': 'Changed' }, [removal('section#drop > h2', 'Title'), removal('section#drop', 'TitleBody')])
check('parent and child deletions are both reported applied', deletedWithEdits.applied.includes('section#drop')
  && deletedWithEdits.applied.includes('section#drop > h2'))
check('edits inside a deleted block do not cause a conflict', deletedWithEdits.skipped.length === 0)
check('deletion does not absorb a sibling style edit', deletedWithEdits.source.includes('<section id="keep" style="color: green">Keep</section>'))
check('the block and all of its edits are gone', !deletedWithEdits.source.includes('id="drop"')
  && !deletedWithEdits.source.includes('Changed') && !deletedWithEdits.source.includes('color: blue'))
const deletedSiblings = applySourceEdits(blockSource, [], {}, [removal('section#drop', 'TitleBody'), removal('section#keep', 'Keep')])
check('two disjoint deletions apply in one pass', deletedSiblings.applied.length === 2
  && deletedSiblings.skipped.length === 0 && !deletedSiblings.source.includes('<section'))
const sameDeletionTwice = applySourceEdits(blockSource, [], {}, [removal('section#drop', 'TitleBody'), removal('section#drop', 'TitleBody')])
check('duplicate deletion requests are idempotent', sameDeletionTwice.applied.length === 1
  && sameDeletionTwice.skipped.length === 0)

const positionedList = '<html><body><ul><li class="item">First</li><li class="item">Second</li></ul></body></html>'
const deletedSecond = applySourceEdits(positionedList, [], {}, [removal('body > ul > li:nth-of-type(2)', 'Second', ['item'])])
check('a uniquely fingerprinted positional element can be deleted', deletedSecond.source
  === positionedList.replace('<li class="item">Second</li>', ''))
const reorderedPreview = applySourceEdits(positionedList, [], {}, [removal('body > ul > li:nth-of-type(2)', 'First', ['item'])])
check('a reordered positional target cannot delete the other sibling', reorderedPreview.source === positionedList
  && reorderedPreview.skipped.some(entry => entry.reason === 'element fingerprint differs from source'))
const identicalList = '<html><body><ul><li class="item">Same</li><li class="item">Same</li></ul></body></html>'
const identicalResult = applySourceEdits(identicalList, [], {}, [removal('body > ul > li:nth-of-type(2)', 'Same', ['item'])])
check('indistinguishable positional siblings cannot be deleted', identicalResult.source === identicalList
  && identicalResult.skipped.some(entry => entry.reason === 'element fingerprint is not unique in source'))
const changedIdText = applySourceEdits(blockSource, [], {}, [removal('section#drop', 'Different')])
check('an id target with changed text is refused', changedIdText.source === blockSource
  && changedIdText.skipped.some(entry => entry.reason === 'element fingerprint differs from source'))
const changedIdClasses = applySourceEdits(blockSource, [], {}, [removal('section#drop', 'TitleBody', ['different'])])
check('an id target with changed classes is refused', changedIdClasses.source === blockSource
  && changedIdClasses.skipped.some(entry => entry.reason === 'element fingerprint differs from source'))

section('unsafe deletions are reported and leave source unchanged')
for (const [label, source, deletion, reason] of [
  ['missing element', blockSource, removal('section#gone', ''), 'element not found in source'],
  ['unsupported selector', blockSource, removal('section.drop', ''), 'unsupported selector grammar'],
  ['duplicate id', duplicateId, removal('section#dupe', ''), 'duplicate id in source'],
  ['ambiguous sibling', blockSource, removal('main#page > section', ''), 'ambiguous selector in source'],
  ['document body', blockSource, removal('body', ''), 'document structure cannot be deleted'],
]) {
  const result = applySourceEdits(source, [], {}, [deletion])
  check(`${label} is reported`, result.skipped.some(entry => entry.selector === deletion.selector && entry.reason === reason))
  check(`${label} changes no source bytes`, result.source === source && result.applied.length === 0)
}

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
  ['a lone sibling drops nth-of-type', 'body > section > div > p'],
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
