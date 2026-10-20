/**
 * Build the preview document from a file's bytes.
 *
 * The preview needs scripts to run (an injected runtime observes hover and
 * selection and applies edits), so the frame is sandboxed with `allow-scripts`
 * but without `allow-same-origin`. That gives the page a unique opaque origin:
 * it cannot read the parent document, cookies, or storage, while the runtime
 * still reaches the parent over `postMessage`.
 *
 * The file's own markup is preserved. The runtime is appended as the last node
 * in the body so the page's DOM is complete before it installs its listeners.
 *
 * @module @guowenzhang/dsh-web-design/client/document
 */

import { frameRuntime } from './frame-runtime.ts'

/**
 * Decode a file's bytes as UTF-8 text.
 * @param data - the file's complete bytes.
 * @returns the decoded source, or `undefined` when the bytes are not valid UTF-8.
 */
export function decodeSource(data: Uint8Array<ArrayBuffer>): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    // Malformed UTF-8 cannot produce a document to review.
    return undefined
  }
}

/**
 * Inject the design-tools runtime into an HTML source.
 *
 * A document with no `<body>` gets one appended rather than rejected: partial
 * fragments are common while an agent is still writing the file, and a preview
 * that refuses to open them is useless for reviewing work in progress.
 * @param source - the file's decoded HTML source.
 * @returns a complete document carrying the runtime.
 */
export function withRuntime(source: string): string {
  const script = `<script data-dsh-design-runtime>${frameRuntime()}</script>`
  const bodyClose = source.lastIndexOf('</body>')
  if (bodyClose >= 0) return `${source.slice(0, bodyClose)}${script}${source.slice(bodyClose)}`
  const htmlClose = source.lastIndexOf('</html>')
  if (htmlClose >= 0) return `${source.slice(0, htmlClose)}${script}${source.slice(htmlClose)}`
  return `${source}${script}`
}

/**
 * Build the complete preview document for one file.
 * @param data - the file's complete bytes.
 * @returns the document source, or `undefined` when the bytes are not text.
 */
export function buildPreviewDocument(data: Uint8Array<ArrayBuffer>): string | undefined {
  const source = decodeSource(data)
  return source === undefined ? undefined : withRuntime(source)
}

/**
 * Collect the sibling stylesheets and scripts a page refers to by relative path.
 *
 * The preview renders from a Blob document with no directory, so these are the
 * references that cannot resolve on their own. Absolute URLs keep pointing at
 * their origin, and a document that declares `<base>` has said where its
 * references belong, so both are left out.
 * @param source - the page's decoded HTML source.
 * @returns each relative reference once, in document order, without query or fragment.
 */
export function siblingReferences(source: string): string[] {
  if (/<base[\s>]/iu.test(source)) return []
  // A comment quoting markup is not a reference; collecting it would read a file
  // the page never asked for.
  const markup = source.replace(/<!--[\s\S]*?-->/gu, '')
  const references: string[] = []
  const seen = new Set<string>()
  const attribute = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/giu
  for (const match of markup.matchAll(attribute)) {
    const raw = (match[1] ?? match[2] ?? '').trim()
    if (raw.length === 0) continue
    // Absolute, protocol-relative, root-absolute and fragment-only references
    // never point at a sibling, and a data URL is already self-contained.
    if (/^(?:[a-z][a-z\d+.-]*:|[/\\#])/iu.test(raw)) continue
    const suffix = raw.search(/[?#]/u)
    const bare = suffix === -1 ? raw : raw.slice(0, suffix)
    if (!/\.(?:css|js|mjs|svg|png|jpe?g|gif|webp|ico)$/iu.test(bare) || seen.has(bare)) continue
    seen.add(bare)
    references.push(bare)
  }
  return references
}

/**
 * Replace references to siblings with the text read from disk.
 *
 * A stylesheet becomes an inline `<style>` and a script an inline `<script>`,
 * each in its original position so cascade order and execution sequence
 * survive. A reference that could not be read keeps its element untouched: it
 * then fails exactly as it did before rather than silently disappearing.
 * @param source - the page's decoded HTML source.
 * @param assets - text read for each reference, keyed by reference.
 * @returns the source with readable siblings inlined.
 */
export function inlineSiblings(source: string, assets: ReadonlyMap<string, string>): string {
  if (assets.size === 0) return source
  // Comments are left byte-for-byte: the previews this plugin edits often carry
  // a comment quoting the very markup being replaced, and rewriting it would
  // corrupt the file a later Save to file writes back.
  const segments = source.split(/(<!--[\s\S]*?-->)/u)
  return segments.map((segment, index) => index % 2 === 1 ? segment : inlineSegment(segment, assets)).join('')
}

/**
 * Inline readable siblings within markup that contains no comments.
 * @param segment - one run of the page's markup.
 * @param assets - text read for each reference, keyed by reference.
 * @returns the segment with every occurrence of a readable reference replaced.
 */
function inlineSegment(segment: string, assets: ReadonlyMap<string, string>): string {
  let result = segment
  for (const [reference, text] of assets) {
    // A closing tag inside a script body would end the inline element early, so
    // a script carrying one stays a reference rather than being corrupted.
    if (/<\/script/iu.test(text)) continue
    const quoted = `(?:"${escapeRegExp(reference)}"|'${escapeRegExp(reference)}')`
    const stylesheet = new RegExp(`<link\\b[^>]*\\brel\\s*=\\s*['"]stylesheet['"][^>]*\\bhref\\s*=\\s*${quoted}[^>]*>`, 'giu')
    const script = new RegExp(`<script\\b[^>]*\\bsrc\\s*=\\s*${quoted}[^>]*>\\s*</script\\s*>`, 'giu')
    const inlined = escapeAttribute(reference)
    // Every occurrence is replaced: a page may repeat the same reference, and a
    // leftover anywhere would still ask for an address that cannot resolve.
    if (stylesheet.test(result)) {
      result = result.replace(stylesheet, () => `<style data-dsh-design-inlined="${inlined}">${text}</style>`)
    }
    if (script.test(result)) {
      result = result.replace(script, () => `<script data-dsh-design-inlined="${inlined}">${text}</script>`)
    }
    if (text.startsWith('data:')) {
      // An image or other binary sibling arrives as a data URL, so its every
      // reference can simply point at it: no directory is needed.
      const selfContained = new RegExp(`\\b(src|href)(\\s*=\\s*)${quoted}`, 'giu')
      result = result.replace(selfContained, (_match, name: string, equals: string) => `${name}${equals}"${escapeAttribute(text)}"`)
    }
  }
  return result
}

/** Escape one string for literal use inside a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** Escape one string for use inside a double-quoted attribute. */
function escapeAttribute(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;')
}

/**
 * The directory a reviewed file resolves its relative references against.
 *
 * The preview document is delivered as a Blob, whose base URL has no directory,
 * so a relative `href` there resolves to a URL that cannot exist. This value is
 * written into the document as its `<base>` before the frame parses it.
 * @param url - absolute address of the reviewed file on the asset route.
 * @returns the directory URL, ending in `/`.
 */
export function baseFor(url: string): string {
  return url.slice(0, url.lastIndexOf('/') + 1)
}

/**
 * Insert one element into a document head, creating a head when the source has
 * none.
 *
 * The element has to be in the parsed document to affect it: a base added after
 * parsing cannot re-issue the requests the parser already made.
 * @param source - the document source.
 * @param element - the markup to place last in the head.
 * @returns the source carrying the element.
 */
export function withHead(source: string, element: string): string {
  const headClose = source.search(/<\/head\s*>/iu)
  if (headClose >= 0) return `${source.slice(0, headClose)}${element}${source.slice(headClose)}`
  const htmlOpen = source.match(/<html[^>]*>/iu)
  if (htmlOpen?.index !== undefined) {
    const after = htmlOpen.index + htmlOpen[0].length
    return `${source.slice(0, after)}<head>${element}</head>${source.slice(after)}`
  }
  // A fragment with neither head nor html still needs one for the base to apply.
  return `<head>${element}</head>${source}`
}
