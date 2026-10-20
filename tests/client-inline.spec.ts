// tests/client-inline.spec.ts — a page's sibling stylesheets and scripts are
// folded into the preview document.
//
// The preview renders from a Blob, which has no directory, so `href="app.css"`
// resolves nowhere. Folding the file's text in is what makes a multi-file
// prototype render on both hosts, the IPC desktop host included. These cases
// pin the parts that are easy to get subtly wrong: comments must survive a
// later write-back, repeated references must all be replaced, and a script
// whose body contains its own closing tag must not be corrupted.
import { expect, it } from 'vitest'
import { inlineSiblings, siblingReferences } from '../src/client/document.ts'

const PAGE = `<!doctype html><html><head>
  <!-- the demo quotes <link rel="stylesheet" href="assets/app.css"> here -->
  <link rel="stylesheet" href="assets/app.css">
  <link rel="stylesheet" href="https://example.invalid/remote.css">
  </head><body><h1>x</h1>
  <script src="assets/app.js"></script>
  <script src="https://example.invalid/remote.js"></script>
  </body></html>`

it('collects only the relative stylesheets and scripts', () => {
  expect(siblingReferences(PAGE)).toEqual(['assets/app.css', 'assets/app.js'])
})

it('leaves a page that declares its own base alone', () => {
  expect(siblingReferences('<html><head><base href="https://example.invalid/">'
    + '<link rel="stylesheet" href="app.css"></head></html>')).toEqual([])
})

it('inlines each readable sibling in place and keeps the rest as references', () => {
  const html = inlineSiblings(PAGE, new Map([
    ['assets/app.css', 'h1{color:red}'],
    ['assets/app.js', 'window.__ready=true'],
  ]))
  expect(html).toContain('<style data-dsh-design-inlined="assets/app.css">h1{color:red}</style>')
  expect(html).toContain('<script data-dsh-design-inlined="assets/app.js">window.__ready=true</script>')
  // Remote origins are not siblings and must keep pointing at their origin.
  expect(html).toContain('https://example.invalid/remote.css')
  expect(html).toContain('https://example.invalid/remote.js')
})

it('keeps comments byte-for-byte, including one quoting the replaced markup', () => {
  const html = inlineSiblings(PAGE, new Map([['assets/app.css', 'h1{color:red}']]))
  expect(html).toContain('<!-- the demo quotes <link rel="stylesheet" href="assets/app.css"> here -->')
})

it('replaces every occurrence of a repeated reference', () => {
  const page = '<html><head><link rel="stylesheet" href="a.css"><link rel="stylesheet" href="a.css"></head></html>'
  const html = inlineSiblings(page, new Map([['a.css', 'p{margin:0}']]))
  expect((html.match(/<style data-dsh-design-inlined/gu) ?? [])).toHaveLength(2)
  expect(html).not.toContain('href="a.css"')
})

it('leaves a script whose body closes itself as a reference rather than corrupting the page', () => {
  const page = '<html><body><script src="a.js"></script></body></html>'
  const html = inlineSiblings(page, new Map([['a.js', 'const s = "</script>"']]))
  expect(html).toContain('src="a.js"')
  expect(html).not.toContain('data-dsh-design-inlined="a.js"')
})

it('points an image reference at the data URL read from disk', () => {
  // An image has no text form to inline, so its every reference is rewritten to
  // the data URL instead: that needs no directory either.
  const page = '<html><body><img src="assets/mark.svg" alt=""><img src="assets/mark.svg" alt="again"></body></html>'
  const html = inlineSiblings(page, new Map([['assets/mark.svg', 'data:image/svg+xml;base64,PHN2Zz4=']]))
  expect((html.match(/src="data:image\/svg\+xml;base64,PHN2Zz4="/gu) ?? [])).toHaveLength(2)
  expect(html).not.toContain('src="assets/mark.svg"')
})

it('collects the image references a page uses', () => {
  expect(siblingReferences('<html><body><img src="assets/mark.svg"></body></html>')).toEqual(['assets/mark.svg'])
})

it('reports no references for a page that has none', () => {
  expect(siblingReferences('<html><body><p>x</p></body></html>')).toEqual([])
  expect(inlineSiblings('<p>x</p>', new Map())).toBe('<p>x</p>')
})