// tests/assets-read.spec.ts — the Host reads the sibling stylesheets and scripts
// a previewed page refers to.
//
// This is the only path that works on both hosts. The web host could serve the
// siblings over an HTTP route, but the desktop host speaks IPC and has no route
// registry; reading them through the review Remote covers both. The two things
// that must hold are confinement (a page reads its own directory tree, nothing
// else) and honesty (an unreadable sibling reports why instead of failing the
// whole preview).
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
// The built entry, because the source carries `@Remote` decorators that only
// the build lowers; testing the artifact is also what the package ships.
import { WebDesignRemote } from '../lib/index.mjs'
import type { DesignFileRef } from '../src/types.ts'

let workspace: string
let page: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-web-design-assets-'))
  await mkdir(join(workspace, 'assets'), { recursive: true })
  await writeFile(join(workspace, 'assets', 'app.css'), 'body{margin:0}', 'utf8')
  await writeFile(join(workspace, 'assets', 'app.js'), 'console.log(1)', 'utf8')
  await writeFile(join(workspace, 'index.html'), '<!doctype html><html></html>', 'utf8')
  page = join(workspace, 'index.html')
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/**
 * Build the review Remote over a context whose filesystem service resolves
 * paths against this workspace, as the Host does.
 */
function mountRemote(): WebDesignRemote {
  const ctx = new Context()
  ctx.provide('fs', {
    resolve: async (path: string, options?: { cwd?: string }) => {
      const absolute = path.startsWith('/') || /^[a-z]:/iu.test(path)
        ? path
        : join(options?.cwd ?? workspace, path)
      return { path: absolute, toString: () => absolute }
    },
    contains: (parent: { toString(): string }, child: { toString(): string }) => {
      const base = parent.toString().replace(/[\\/]+$/u, '')
      const target = child.toString()
      return target === base || target.startsWith(`${base}/`) || target.startsWith(`${base}\\`)
    },
    processPath: (value: { toString(): string }) => value.toString(),
    stat: async () => ({ type: 'file' }),
  })
  ctx.provide('sessions', { get: () => ({ header: { cwd: workspace } }) })
  return new WebDesignRemote(ctx)
}

/** The preview address the browser sends for a file in this workspace. */
function refFor(path: string): DesignFileRef {
  return { sessionId: 'test', path } as DesignFileRef
}

describe('reading the siblings a page refers to', () => {
  it('returns the stylesheet and script beside the page', async () => {
    const remote = mountRemote()
    const assets = await remote.assets({ file: refFor(page), references: ['assets/app.css', 'assets/app.js'] })
    expect(assets).toHaveLength(2)
    expect(assets[0]).toMatchObject({ reference: 'assets/app.css', text: 'body{margin:0}' })
    expect(assets[1]).toMatchObject({ reference: 'assets/app.js', text: 'console.log(1)' })
  })

  it('reports a missing sibling instead of failing the page', async () => {
    const remote = mountRemote()
    const assets = await remote.assets({ file: refFor(page), references: ['assets/missing.css'] })
    expect(assets).toHaveLength(1)
    expect(assets[0]?.text).toBeNull()
    expect(assets[0]?.reason).toBeTruthy()
  })

  it('refuses a reference that climbs out of the page directory', async () => {
    const remote = mountRemote()
    const assets = await remote.assets({ file: refFor(page), references: ['../secret.css'] })
    expect(assets[0]?.text).toBeNull()
    expect(assets[0]?.reason).toBe('outside the page directory')
  })

  it('refuses a reference that is not a stylesheet or script', async () => {
    const remote = mountRemote()
    const assets = await remote.assets({ file: refFor(page), references: ['assets/secret.json'] })
    expect(assets[0]?.text).toBeNull()
    expect(assets[0]?.reason).toBe('not a stylesheet or script')
  })

  it('refuses an absolute or backslash reference', async () => {
    const remote = mountRemote()
    // A Windows-style separator is never a sibling path, whatever the host.
    const backslash = ['assets', 'app.css'].join(String.fromCharCode(92))
    const assets = await remote.assets({
      file: refFor(page),
      references: ['/etc/passwd.css', 'https://example.invalid/app.css', backslash],
    })
    for (const asset of assets) expect(asset.text).toBeNull()
  })

  it('drops a query or fragment before reading the file', async () => {
    const remote = mountRemote()
    const assets = await remote.assets({ file: refFor(page), references: ['assets/app.css?v=2'] })
    expect(assets[0]).toMatchObject({ text: 'body{margin:0}' })
  })

  it('returns an image as a data URL the preview can use without a directory', async () => {
    await writeFile(join(workspace, 'assets', 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')
    const remote = mountRemote()
    const assets = await remote.assets({ file: refFor(page), references: ['assets/mark.svg'] })
    expect(assets[0]?.text).toBe(`data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64')}`)
  })

  it('rejects a request without a references array', async () => {
    const remote = mountRemote()
    await expect(remote.assets({ file: refFor(page) } as never)).rejects.toThrow(/references/)
  })
})