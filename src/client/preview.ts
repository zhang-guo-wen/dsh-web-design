/**
 * Address of the Host's preview asset route, for the browser half.
 *
 * The Host registers the route (see `src/preview-server.ts`) and this module
 * spells the same prefix for the iframe. It is kept apart so the Client bundle
 * never imports the Host module, whose `node:` imports cannot run in a page.
 *
 * @module @guowenzhang/dsh-web-design/client/preview
 */

/** Absolute path prefix of the preview asset route; must match the Host's. */
export const PREVIEW_ROUTE = '/api/web-design/preview'

/**
 * Build the iframe address for one previewed file.
 *
 * Relative references on the reviewed page resolve against this address, so it
 * carries the file's own directory rather than a synthetic root.
 * @param sessionId - Session whose workspace confines the route.
 * @param path - absolute host path of the reviewed file.
 * @returns the route URL, or `undefined` when the path has no file name.
 */
export function previewUrlFor(sessionId: string, path: string): string | undefined {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (separator < 0) return undefined
  const root = path.slice(0, separator + 1)
  const name = path.slice(separator + 1)
  if (name.length === 0) return undefined
  return `${PREVIEW_ROUTE}/${encodeURIComponent(sessionId)}/${encodeRoot(root)}/${encodeURIComponent(name)}`
}

/**
 * Encode an absolute host path as one URL segment.
 * @param path - absolute host path ending in the platform separator.
 * @returns a URL-safe segment with no padding.
 */
export function encodeRoot(path: string): string {
  const bytes = new TextEncoder().encode(path)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}