// tests/preview-route.spec.ts — the Host asset route behind the preview.
//
// The preview iframe resolves the reviewed page's own relative references
// against this route, so the two things that must never drift are the address
// it hands out and the confinement it enforces: a preview may read the file's
// siblings inside its workspace, and nothing else.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { confine, decodeRoot, encodeRoot, PREVIEW_ROUTE, registerPreviewRoute } from '../src/preview-server.ts'

/** A route registration captured instead of reaching a real HTTP server. */
interface CapturedRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly fetch: (request: Request) => Promise<Response>
}

let workspace: string
let route: CapturedRoute | undefined
let disposeCalls: number

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-web-design-route-'))
  route = undefined
  disposeCalls = 0
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/**
 * Register the route against a context whose filesystem and Session services
 * behave like the Host's: paths resolve under one workspace root.
 */
async function mountRoute(): Promise<Context> {
  const ctx = new Context()
  const root = workspace
  const fs = {
    resolve: async (path: string) => ({
      path,
      toString: () => path,
    }),
    contains: (parent: { toString(): string }, child: { toString(): string }) => {
      const base = parent.toString().replace(/[\\/]+$/u, '')
      const target = child.toString()
      return target === base || target.startsWith(`${base}/`) || target.startsWith(`${base}\\`)
    },
    processPath: (value: { toString(): string }) => value.toString(),
    stat: async () => ({ type: 'file' }),
  }
  ctx.provide('fs', fs)
  ctx.provide('sessions', { get: () => ({ header: { cwd: root } }) })
  ctx.provide('connection', {
    fetch: {
      register: (registered: CapturedRoute) => {
        route = registered
        return async () => { disposeCalls += 1 }
      },
    },
  })
  await registerPreviewRoute(ctx)
  return ctx
}

/** Build the URL the Client would request for one path under the workspace. */
function urlFor(relative: string): string {
  const root = encodeRoot(`${workspace}/`)
  return `http://127.0.0.1:9000${PREVIEW_ROUTE}/session-1/${root}/${relative}`
}

describe('preview asset route', () => {
  it('serves a file beside the reviewed page with its own content type', async () => {
    await mkdir(join(workspace, 'pages'), { recursive: true })
    await writeFile(join(workspace, 'pages', 'proto.css'), 'body{margin:0}', 'utf8')
    await mountRoute()

    const response = await route!.fetch(new Request(urlFor('pages/proto.css')))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('body{margin:0}')
  })

  it('answers HEAD without a body so the browser can revalidate cheaply', async () => {
    await writeFile(join(workspace, 'app.js'), 'console.log(1)', 'utf8')
    await mountRoute()

    const response = await route!.fetch(new Request(urlFor('app.js'), { method: 'HEAD' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await response.text()).toBe('')
  })

  it('never serves a file that lies outside the workspace', async () => {
    await mountRoute()

    // Encoded dots survive WHATWG URL normalization and reach the handler;
    // a literal climb is collapsed by the parser before it. Either layer may
    // answer, and the contract under test is only that no bytes come back.
    const encoded = await route!.fetch(new Request(urlFor('%2e%2e/etc/passwd')))
    expect(encoded.status).not.toBe(200)

    const literal = await route!.fetch(new Request(
      `http://127.0.0.1:9000${PREVIEW_ROUTE}/session-1/${encodeRoot(`${workspace}/`)}/../../etc/passwd`,
    ))
    expect(literal.status).not.toBe(200)
  })

  it('refuses a file type it does not serve rather than guessing one', async () => {
    await mountRoute()

    const response = await route!.fetch(new Request(urlFor('notes.exe')))
    expect(response.status).toBe(415)
  })

  it('answers 404 for an unknown Session instead of reading anything', async () => {
    await mountRoute()

    const response = await route!.fetch(new Request(
      `http://127.0.0.1:9000${PREVIEW_ROUTE}/missing/${encodeRoot(`${workspace}/`)}/app.css`,
    ))
    expect(response.status).toBe(404)
  })

  it('releases the registration when its plugin fiber is disposed', async () => {
    const ctx = await mountRoute()
    expect(route).toBeDefined()
    await ctx.fiber.dispose()
    expect(disposeCalls).toBe(1)
  })
})

describe('preview route addressing', () => {
  it('round-trips an absolute path through one URL segment', () => {
    const path = `${tmpdir()}/a b/prototype/`
    expect(decodeRoot(encodeRoot(path))).toBe(path)
  })

  it('rejects a segment that was not produced by encodeRoot', () => {
    expect(decodeRoot('not-a-path')).toBeUndefined()
    expect(decodeRoot('')).toBeUndefined()
  })

  it('normalizes a sibling reference and refuses escape', () => {
    expect(confine('pages/proto.css')).toBe('pages/proto.css')
    expect(confine('./pages/../shared/app.css')).toBe('shared/app.css')
    expect(confine('../etc/passwd')).toBeUndefined()
    expect(confine('a/../../b')).toBeUndefined()
    expect(confine('back\\slash.css')).toBeUndefined()
  })
})

// Keep the module's own URL import meaningful for bundlers that tree-shake.
void pathToFileURL