// @vitest-environment jsdom
//
// What the preview's render path costs while the reviewer points at the page.
//
// The frame runtime reports the element under the pointer so the frame can draw
// its hover outline. That report used to travel through the preview's React
// store, so every element the pointer crossed committed the whole preview
// subtree (toolbar, frame, and a floating editor when one is open) even though
// nothing the preview renders depends on the hovered element. This spec
// measures that cost with React's own Profiler and keeps the regression out:
// hovering must not commit the preview at all.
//
// The measurement is a jsdom measurement. It proves the commit count, not
// frame timings on a real browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { Profiler, createElement, useSyncExternalStore } from 'react'
import { HtmlDesignBody } from '../src/client/HtmlDesignBody.tsx'
import type { HtmlDesignBodyProps } from '../src/client/HtmlDesignBody.tsx'
import { fileRefOf } from '../src/client/index.ts'
import { createDesignStore } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'
import { CHANNEL } from '../src/client/frame-runtime.ts'

const PATH = 'C:/workspace/index.html'
const RESOURCE_ADDRESS = 'dsh-resource://file/session/test/workspace/index.html'
/** Distinct hover targets, the rate at which a pointer crosses elements. */
const HOVER_TARGETS = 120

const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

interface Commit {
  readonly phase: string
  readonly duration: number
}

/**
 * Mount the preview under a Profiler and hover distinct elements.
 * @returns the commits React reported and the measured wall time of the hover run.
 */
async function measureHover(): Promise<{ readonly commits: readonly Commit[]; readonly wallMs: number }> {
  const store = createDesignStore(PATH).create()
  const props = {
    content: { kind: 'bytes', data: new TextEncoder().encode('<!doctype html><html><body><h1 id="headline">Original heading</h1></body></html>') },
    resourceAddress: RESOURCE_ADDRESS,
    wrap: false,
    addResource: () => {},
    setResources: () => {},
    scrollportRef: () => {},
    useStore: <S,>(selector: (state: ReturnType<typeof store.getSnapshot>) => S): S =>
      selector(useSyncExternalStore(store.subscribe, store.getSnapshot)),
    actions: store.actions,
    t: (key: string) => zh[key as keyof typeof zh] ?? key,
    loadReview: async () => ({ path: PATH, document: null, storePath: `${PATH}.design.json` }),
    saveReview: async () => {},
    applyToFile: async () => ({ path: PATH, applied: [], skipped: [], bytes: 0, changed: false }),
    fileRefOf,
  } as unknown as HtmlDesignBodyProps

  const commits: Commit[] = []
  const view = render(createElement(
    Profiler,
    {
      id: 'web-design-preview',
      onRender: (_id: string, phase: string, actualDuration: number) => { commits.push({ phase, duration: actualDuration }) },
    },
    createElement(HtmlDesignBody, props),
  ))
  const frame = await waitFor(() => {
    const mounted = view.container.querySelector('iframe[data-html-design-preview]')
    if (!(mounted instanceof HTMLIFrameElement) || mounted.contentWindow === null) {
      throw new Error('HTML preview frame has not mounted yet')
    }
    return mounted
  })
  const afterMount = commits.length
  const started = performance.now()
  for (let index = 0; index < HOVER_TARGETS; index += 1) {
    // Each `postMessage` from the frame is its own task, so each hover is its
    // own act(): one commit per crossed element, never one batched commit.
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        data: { channel: CHANNEL, kind: 'hover', selector: `h1#target-${index}`, tag: 'h1' },
      }))
    })
  }
  const wallMs = performance.now() - started
  return { commits: commits.slice(afterMount), wallMs }
}

beforeEach(() => {
  let nextUrl = 0
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => `blob:web-design-cost-${++nextUrl}` })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalCreateObjectURL === undefined) Reflect.deleteProperty(URL, 'createObjectURL')
  else Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
  if (originalRevokeObjectURL === undefined) Reflect.deleteProperty(URL, 'revokeObjectURL')
  else Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
  vi.unstubAllGlobals()
})

describe('preview render cost', () => {
  it('commits nothing while the pointer moves across elements', async () => {
    const { commits, wallMs } = await measureHover()
    const total = commits.reduce((sum, commit) => sum + commit.duration, 0)
    // Reported rather than asserted: jsdom commit durations are not browser frame times.
    console.log(
      `hover targets=${HOVER_TARGETS} commits=${commits.length} `
      + `reactDuration=${total.toFixed(1)}ms wall=${wallMs.toFixed(1)}ms phases=${JSON.stringify(commits.map(commit => commit.phase).slice(0, 3))}`,
    )
    expect(commits).toHaveLength(0)
  })
})
