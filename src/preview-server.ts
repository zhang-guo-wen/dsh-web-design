/**
 * Host static-asset route behind the Sidebar preview.
 *
 * The preview renders a reviewed HTML file inside an iframe. A Blob URL has no
 * directory, so `href="proto.css"` on the reviewed page resolves to a URL that
 * cannot exist and every neighbouring stylesheet, script and image fails to
 * load. This route serves the reviewed file and its siblings over the Host's
 * own origin instead, so the browser resolves those relative references the way
 * it does for any file opened from disk.
 *
 * The route is exact and read-only. Requests are confined to the Session's
 * workspace root: a prototype laid out in sibling folders still works, while
 * nothing outside the workspace is reachable. Every response carries
 * `no-store`, so an edit saved to disk is visible on the next reload.
 *
 * Authentication is the Host's, not this module's: the route registers on the
 * shared `/api` channel, which applies the Host/Origin fence and the browser
 * session cookie before any handler here runs.
 *
 * @module @guowenzhang/dsh-web-design/preview-server
 */

import { open, stat, readFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { extname, isAbsolute, posix, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { REMOTE_NAMESPACE } from './typert.ts'

/** The filesystem operations this route needs, as the Host service exposes them. */
type FilesystemService = NonNullable<Context['fs']>

/** Absolute path prefix of the preview asset route: `{session}/{root}/{relative}` follows. */
export const PREVIEW_ROUTE = '/api/web-design/preview'

/** Content types the route serves; anything else is refused rather than guessed. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

/** A single-file response never exceeds this; larger assets are refused with 413. */
const MAX_ASSET_BYTES = 32 * 1024 * 1024

/**
 * Encode an absolute host path as one URL segment.
 *
 * The reviewed file's directory travels in the path so one route serves every
 * preview without a registry keyed by preview lifetime. Base64url keeps every
 * platform's separators and drive letter intact across the URL.
 * @param path - absolute host path ending in the platform separator.
 * @returns a URL-safe segment with no padding.
 */
export function encodeRoot(path: string): string {
  return Buffer.from(path, 'utf8').toString('base64url')
}

/**
 * Decode a segment produced by {@link encodeRoot}.
 * @param segment - the encoded path.
 * @returns the absolute host path, or `undefined` when the segment is malformed.
 */
export function decodeRoot(segment: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(segment)) return undefined
  const decoded = Buffer.from(segment, 'base64url').toString('utf8')
  // A round trip that does not reproduce the input was not made by encodeRoot.
  return encodeRoot(decoded) === segment && isAbsolute(decoded) ? decoded : undefined
}

/**
 * Map a Content-Type for one file name.
 * @param name - the file's base name.
 * @returns the response type, or `undefined` when the route does not serve it.
 */
function contentTypeOf(name: string): string | undefined {
  return CONTENT_TYPES[extname(name).toLowerCase()]
}

/**
 * Normalize a relative reference against the preview root.
 *
 * The reviewed page may ask for `../shared/app.css`, which is legitimate for a
 * prototype laid out in sibling folders, so `..` is resolved rather than banned
 * outright; what remains refused is a reference that still climbs above the
 * root, and any absolute or backslash form.
 * @param reference - the decoded relative path from the request.
 * @returns the normalized relative path, or `undefined` when it escapes.
 */
export function confine(reference: string): string | undefined {
  if (reference.includes('\0') || reference.includes('\\')) return undefined
  const normalized = posix.normalize(reference).replace(/^\/+/u, '')
  if (normalized.length === 0 || normalized === '.') return undefined
  if (normalized.startsWith('../') || normalized === '..') return undefined
  return normalized
}

/** One bodyless response that disables caching and content sniffing. */
function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })
}

/**
 * Register the preview asset route for this plugin's lifetime.
 *
 * The Connection service carries the HTTP Fetch-route registry and exists on the
 * web host only. Waiting for it through `ctx.inject` keeps the route off every
 * desktop composition without holding up the rest of the plugin: the review
 * Remote still loads there, and the Client falls back to a Blob document whose
 * relative references simply cannot be routed.
 * @param ctx - host context owning the route.
 * @returns once the route is registered, or immediately when this host has no
 *   HTTP transport to register it on.
 */
export function registerPreviewRoute(ctx: Context): void {
  const fs = ctx.get('fs')
  if (fs === undefined) return
  ctx.inject(['connection'], (connectionCtx) => {
    void connect(connectionCtx, fs)
  })
}

/**
 * Install the route once Connection is available.
 * @param ctx - context carrying the Connection service.
 * @param fs - filesystem service resolved by the caller.
 * @returns once the route is registered and owned by this fiber.
 */
async function connect(ctx: Context, fs: FilesystemService): Promise<void> {
  const connection = ctx.get('connection')
  if (connection === undefined) return
  const sessions = ctx.get('sessions')
  const persistence = ctx.get('sessionPersistence')
  const sandboxPolicy = ctx.get('sandboxPolicy')

  /** Resolve one Session to the workspace that confines it. */
  const workspaceOf = async (sessionId: string): Promise<string | undefined> => {
    const live = sessions?.get(SessionId(sessionId))?.header
    const stored = live === undefined ? await persistence?.stat(SessionId(sessionId)) : undefined
    const header = live ?? stored?.header
    if (header === undefined) return undefined
    return header.cwd ?? sandboxPolicy?.workspaceRoot
  }

  const dispose = connection.fetch.register({
    path: PREVIEW_ROUTE,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const segments = new URL(request.url).pathname
        .slice(PREVIEW_ROUTE.length)
        .split('/')
        .filter(segment => segment.length > 0)
      // The Session and the encoded root are fixed segments; everything after
      // them is the file's path relative to that root, subdirectories included.
      if (segments.length < 3) return text(404, 'not found')
      const [rawSession, rawRoot] = segments as [string, string]
      const root = decodeRoot(rawRoot)
      if (root === undefined) return text(400, 'invalid preview root')
      const reference = segments.slice(2).map(segment => decodeURIComponent(segment)).join('/')
      if (reference.length === 0) return text(404, 'not found')
      const name = confine(reference)
      if (name === undefined) return text(403, 'outside the preview root')

      const workspace = await workspaceOf(decodeURIComponent(rawSession))
      if (workspace === undefined) return text(404, 'unknown session')

      const type = contentTypeOf(name)
      if (type === undefined) return text(415, 'unsupported asset type')

      let path: string
      try {
        const rootPath = await fs.resolve(root)
        const target = await fs.resolve(`${rootPath}${name.split('/').join(sep)}`)
        const workspacePath = await fs.resolve(workspace)
        if (!fs.contains(workspacePath, target)) return text(403, 'outside the workspace')
        path = fs.processPath(target)
      } catch {
        return text(400, 'invalid asset path')
      }

      let handle: FileHandle | undefined
      try {
        const info = await stat(path)
        if (!info.isFile()) return text(404, 'not a file')
        if (info.size > MAX_ASSET_BYTES) return text(413, 'asset too large')
        const headers = { 'content-type': type, 'content-length': String(info.size), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
        if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
        handle = await open(path, 'r')
        return new Response(await readFile(handle), { status: 200, headers })
      } catch {
        return text(404, 'not found')
      } finally {
        await handle?.close()
      }
    },
  })

  ctx.effect(() => () => { void dispose() }, `${REMOTE_NAMESPACE}: preview route`)
}