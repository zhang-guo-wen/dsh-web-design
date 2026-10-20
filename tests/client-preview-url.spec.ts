// tests/client-preview-url.spec.ts — the address the preview frame is pointed at.
//
// This half runs in the browser: it must spell the same route prefix the Host
// registers and encode the reviewed file's directory as one segment, without
// importing anything from the Host module (whose `node:` imports cannot run in
// a page). A drift between the two halves silently breaks every relative
// reference on the reviewed page, so the prefix is asserted verbatim.
import { expect, it } from 'vitest'
import { baseFor } from '../src/client/document.ts'
import { encodeRoot, PREVIEW_ROUTE, previewUrlFor } from '../src/client/preview.ts'

it('spells the route prefix the Host registers', () => {
  // Must equal PREVIEW_ROUTE in src/preview-server.ts.
  expect(PREVIEW_ROUTE).toBe('/api/web-design/preview')
})

it('addresses a file inside its own directory', () => {
  const url = previewUrlFor('session-1', 'C:\\work\\proto\\01-工艺路线列表.html')
  expect(url).toBeDefined()
  expect(url).toContain(`${PREVIEW_ROUTE}/session-1/`)
  // The Chinese file name survives as one encoded segment.
  expect(url!.endsWith('%E5%B7%A5%E8%89%BA%E8%B7%AF%E7%BA%BF%E5%88%97%E8%A1%A8.html')
    || decodeURIComponent(url!.split('/').pop()!) === '01-工艺路线列表.html').toBe(true)
})

it('takes the directory, not the file name, as the base', () => {
  const url = previewUrlFor('s', '/work/pages/index.html')!
  const base = baseFor(url)
  expect(base.endsWith('/')).toBe(true)
  expect(base).toBe(url.slice(0, url.lastIndexOf('/') + 1))
  // A sibling reference resolves under the reviewed file's directory.
  expect(new URL('proto.css', `http://host${base}`).pathname).toMatch(/\/api\/web-design\/preview\/s\/[^/]+\/proto\.css$/u)
})

it('declines a path with no file name', () => {
  expect(previewUrlFor('s', 'index.html')).toBeUndefined()
  expect(previewUrlFor('s', '/work/pages/')).toBeUndefined()
})

it('encodes a directory so its separators survive the URL', () => {
  for (const path of ['C:\\work\\a\\', '/work/a/', 'C:\\工 作\\a\\']) {
    const encoded = encodeRoot(path)
    expect(encoded).not.toMatch(/[+/=]/u)
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/gu, '+').replace(/_/gu, '/')), c => c.charCodeAt(0)))
    expect(decoded).toBe(path)
  }
})