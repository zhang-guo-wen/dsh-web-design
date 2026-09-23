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
