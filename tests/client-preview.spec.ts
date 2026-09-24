// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { createElement, useSyncExternalStore } from 'react'
import { HtmlDesignBody } from '../src/client/HtmlDesignBody.tsx'
import type { HtmlDesignBodyProps } from '../src/client/HtmlDesignBody.tsx'
import { fileRefOf } from '../src/client/index.ts'
import { createDesignStore } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'
import { CHANNEL } from '../src/client/frame-runtime.ts'
import type { FrameAnchor } from '../src/client/frame-runtime.ts'
import type { DesignAnnotationDocument, DesignFileRef, DesignReadResult } from '../src/types.ts'

const PATH = 'C:/workspace/index.html'
const RESOURCE_ADDRESS = 'dsh-resource://file/session/test/workspace/index.html'
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
let nextBlobUrl = 0
const createObjectURL = vi.fn((_blob: Blob) => `blob:html-design-preview-${++nextBlobUrl}`)
const revokeObjectURL = vi.fn((_url: string) => {})
const ANCHOR: FrameAnchor = {
  selector: 'h1#headline',
  parentSelector: 'main#container',
  tag: 'h1',
  id: 'headline',
  classes: [],
  text: 'Original heading',
  sourceText: 'Original heading',
  sourceClasses: [],
  editableText: 'Original heading',
  rect: { x: 24, y: 32, width: 240, height: 48 },
  computed: { 'font-size': '16px', color: 'rgb(0, 0, 0)' },
}
const PARENT_ANCHOR: FrameAnchor = {
  selector: 'main#container',
  parentSelector: 'body',
  tag: 'main',
  id: 'container',
  classes: [],
  text: 'Original heading and child copy',
  sourceText: 'Original heading and child copy',
  sourceClasses: [],
  editableText: null,
  rect: { x: 8, y: 8, width: 320, height: 240 },
  computed: { 'font-size': '16px', color: 'rgb(0, 0, 0)' },
}

function reviewWithStyle(): DesignAnnotationDocument {
  return {
    version: 1,
    file: PATH,
    comments: [],
    edits: [{ selector: ANCHOR.selector, declarations: { 'font-size': '18px' }, updatedAt: '2026-09-23T00:00:00.000Z' }],
    updatedAt: '2026-09-23T00:00:00.000Z',
  }
}

function mountPreview(
  review: DesignAnnotationDocument | null = null,
  read?: (file: DesignFileRef) => Promise<DesignReadResult>,
) {
  const store = createDesignStore(PATH).create()
  const defaultRead = async (_file: DesignFileRef): Promise<DesignReadResult> => ({
    path: PATH, document: review, storePath: `${PATH}.design.json`,
  })
  const loadReview = vi.fn(read ?? defaultRead)
  const saveReview = vi.fn(async (_file: DesignFileRef, _document: DesignAnnotationDocument): Promise<void> => {})
  const applyToFile = vi.fn(async () => ({ path: PATH, applied: [], skipped: [], bytes: 0, changed: false }))
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
    loadReview,
    saveReview,
    applyToFile,
    fileRefOf,
  } as HtmlDesignBodyProps
  const view = render(createElement(HtmlDesignBody, props))
  const frame = view.container.querySelector('iframe[data-html-design-preview]')
  if (!(frame instanceof HTMLIFrameElement) || frame.contentWindow === null) {
    throw new Error('HTML preview frame did not mount')
  }
  const postMessage = vi.spyOn(frame.contentWindow, 'postMessage')
  const dispatchFromFrame = (
    source: HTMLIFrameElement,
    kind: 'ready' | 'select' | 'edit' | 'move',
    anchor: FrameAnchor = ANCHOR,
    declarations: Readonly<Record<string, string>> = {},
    restore: Readonly<Record<string, string>> = { translate: '' },
  ) => {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: source.contentWindow,
        data: kind === 'ready' ? { channel: CHANNEL, kind }
          : kind === 'select' || kind === 'edit' ? { channel: CHANNEL, kind, anchor }
            : { channel: CHANNEL, kind, anchor, selector: anchor.selector, declarations, restore },
      }))
    })
  }
  const select = (anchor: FrameAnchor = ANCHOR) => {
    dispatchFromFrame(frame, 'edit', anchor)
  }
  const singleSelect = (anchor: FrameAnchor = ANCHOR) => {
    dispatchFromFrame(frame, 'select', anchor)
  }
  const dispatchModeApplied = (source: HTMLIFrameElement, mode: 'browse' | 'inspect') => {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: source.contentWindow,
        data: { channel: CHANNEL, kind: 'modeApplied', mode },
      }))
    })
  }
  const dispatchRemoveResult = (
    source: HTMLIFrameElement,
    selector: string,
    requestId: string,
    success: boolean,
    removedSelectors: readonly string[] = success ? [selector] : [],
  ) => {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: source.contentWindow,
        data: { channel: CHANNEL, kind: 'removeResult', requestId, selector, success, removedSelectors },
      }))
    })
  }
  return { view, frame, props, store, loadReview, saveReview, applyToFile, postMessage, dispatchFromFrame, dispatchModeApplied, dispatchRemoveResult, select, singleSelect }
}

function lastRemovalRequest(postMessage: ReturnType<typeof mountPreview>['postMessage']): { selector: string; requestId: string } {
  const message: unknown = postMessage.mock.lastCall?.[0]
  if (typeof message !== 'object' || message === null
    || !('channel' in message) || message.channel !== CHANNEL
    || !('kind' in message) || message.kind !== 'removeSelected'
    || !('selector' in message) || typeof message.selector !== 'string'
    || !('requestId' in message) || typeof message.requestId !== 'string') {
    throw new Error('The frame did not receive a selected-element removal request')
  }
  return { selector: message.selector, requestId: message.requestId }
}

beforeEach(() => {
  nextBlobUrl = 0
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
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

describe('HTML design preview interactions', () => {
  it('selects on one click and opens the exact element editor only on a double-click', async () => {
    const { view, store, select, singleSelect } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))

    singleSelect(ANCHOR)
    expect(store.getSnapshot().selectedSelector).toBe(ANCHOR.selector)
    expect(view.queryByRole('dialog')).toBeNull()

    select(ANCHOR)
    expect(view.getByRole('dialog', { name: zh.editElement })).toBeDefined()
    singleSelect(PARENT_ANCHOR)
    expect(store.getSnapshot().selectedSelector).toBe(PARENT_ANCHOR.selector)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('copies the selected element locator without changing its text draft', async () => {
    const { view, store, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select(ANCHOR)

    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(within(dialog).getByTitle(zh.elementTag).textContent).toBe('H1')
    expect(within(dialog).getByText(zh.elementLocator)).toBeDefined()
    expect(within(dialog).getByTitle(ANCHOR.selector).textContent).toBe(ANCHOR.selector)
    const input = within(dialog).getByRole('textbox', { name: zh.textContent }) as HTMLTextAreaElement
    expect(input.value).toBe(ANCHOR.editableText)

    fireEvent.change(input, { target: { value: 'Draft heading' } })
    expect(view.getByText(zh.unsaved)).toBeDefined()
    const writeText = vi.fn(async (_text: string): Promise<void> => {})
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      fireEvent.click(within(dialog).getByRole('button', { name: zh.copyLocator }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(ANCHOR.selector))
      expect(input.value).toBe('Draft heading')
      expect(view.getByText(zh.unsaved)).toBeDefined()
    } finally {
      if (originalClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
      else Object.defineProperty(navigator, 'clipboard', originalClipboard)
    }
  })

  it('can select the containing block from the dialog without guessing its thin border', async () => {
    const { view, postMessage, store, select, dispatchFromFrame, frame } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select(ANCHOR)
    fireEvent.click(within(view.getByRole('dialog', { name: zh.editElement }))
      .getByRole('button', { name: zh.selectParent }))
    expect(postMessage).toHaveBeenCalledWith({ channel: CHANNEL, kind: 'selectParent' }, '*')

    dispatchFromFrame(frame, 'edit', PARENT_ANCHOR)
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(within(dialog).getByText('MAIN')).toBeDefined()
    expect(within(dialog).getByTitle(PARENT_ANCHOR.selector).textContent).toBe(PARENT_ANCHOR.selector)
  })

  it('holds frame pointer input until the requested mode is applied', () => {
    const { view, frame, dispatchModeApplied } = mountPreview()
    expect(frame.getAttribute('data-frame-mode-ready')).toBe('false')
    dispatchModeApplied(frame, 'browse')
    expect(frame.getAttribute('data-frame-mode-ready')).toBe('true')

    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    expect(frame.getAttribute('data-frame-mode-ready')).toBe('false')
    dispatchModeApplied(frame, 'browse')
    expect(frame.getAttribute('data-frame-mode-ready')).toBe('false')
    dispatchModeApplied(frame, 'inspect')
    expect(frame.getAttribute('data-frame-mode-ready')).toBe('true')
  })

  it('shows the page frame with only preview and edit modes and localized frame messages', () => {
    const { view, frame, postMessage, dispatchFromFrame } = mountPreview()
    expect(frame.getAttribute('src')).toMatch(/^blob:html-design-preview-/)
    expect(frame.hasAttribute('srcdoc')).toBe(false)
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.getByRole('button', { name: zh.modeBrowse }).getAttribute('aria-pressed')).toBe('true')
    expect(view.getByRole('button', { name: zh.modeInspect }).getAttribute('aria-pressed')).toBe('false')
    expect(view.getAllByRole('button').filter(button => button.getAttribute('aria-pressed') !== null)).toHaveLength(2)
    dispatchFromFrame(frame, 'ready')
    expect(postMessage).toHaveBeenCalledWith({
      channel: CHANNEL, kind: 'mode', mode: 'browse', dragHandleLabel: zh.dragHandle,
    }, '*')

    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    expect(view.getByRole('button', { name: zh.modeInspect }).getAttribute('aria-pressed')).toBe('true')
    expect(postMessage).toHaveBeenCalledWith({
      channel: CHANNEL, kind: 'mode', mode: 'inspect', dragHandleLabel: zh.dragHandle,
    }, '*')
    fireEvent.click(view.getByRole('button', { name: zh.modeBrowse }))
    expect(view.getByRole('button', { name: zh.modeBrowse }).getAttribute('aria-pressed')).toBe('true')
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(frame)
  })

  it('releases each Blob URL when the document changes and the preview unmounts', () => {
    const { view, frame, props } = mountPreview()
    const firstUrl = frame.getAttribute('src')
    expect(firstUrl).toMatch(/^blob:html-design-preview-/)

    view.rerender(createElement(HtmlDesignBody, {
      ...props,
      content: { kind: 'bytes', data: new TextEncoder().encode('<html><body>Updated page</body></html>') },
    }))
    const updatedFrame = view.container.querySelector('iframe[data-html-design-preview]')
    expect(updatedFrame).toBeInstanceOf(HTMLIFrameElement)
    const secondUrl = updatedFrame?.getAttribute('src')
    expect(secondUrl).toMatch(/^blob:html-design-preview-/)
    expect(secondUrl).not.toBe(firstUrl)
    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl)

    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith(secondUrl)
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('places the editor outside a narrow Sidebar preview when the viewport has room', () => {
    vi.stubGlobal('visualViewport', undefined)
    vi.stubGlobal('innerWidth', 1280)
    vi.stubGlobal('innerHeight', 800)
    const { view, frame, select } = mountPreview()
    const stage = view.container.querySelector('[data-html-design-stage]')
    if (!(stage instanceof HTMLElement)) throw new Error('HTML preview stage did not mount')
    const sidebarBounds = new DOMRect(1000, 80, 260, 650)
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(sidebarBounds)

    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(dialog.getAttribute('data-html-design-editor')).not.toBeNull()
    expect(dialog.getAttribute('data-placement')).toBe('left')
    expect(document.body.contains(dialog)).toBe(true)
    expect(view.container.contains(dialog)).toBe(false)
    expect(Number.parseFloat(dialog.style.left) + Number.parseFloat(dialog.style.width)).toBeLessThanOrEqual(sidebarBounds.left - 16)
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(frame)
  })

  it('uses a short bottom editor when neither side of the preview has room', () => {
    vi.stubGlobal('visualViewport', undefined)
    vi.stubGlobal('innerWidth', 600)
    vi.stubGlobal('innerHeight', 800)
    const { view, frame, select } = mountPreview()
    const stage = view.container.querySelector('[data-html-design-stage]')
    if (!(stage instanceof HTMLElement)) throw new Error('HTML preview stage did not mount')
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(170, 80, 260, 660))

    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(dialog.getAttribute('data-placement')).toBe('bottom')
    expect(view.container.contains(dialog)).toBe(false)
    expect(Number.parseFloat(dialog.style.top)).toBeGreaterThanOrEqual(80 + 660 / 2)
    expect(Number.parseFloat(dialog.style.maxHeight)).toBeLessThanOrEqual(800 * 0.48)
    expect(Number.parseFloat(dialog.style.maxHeight)).toBeLessThanOrEqual(660 * 0.55)
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(frame)
  })

  it('opens the floating editor only after inspect selection and discards a cancelled draft', () => {
    const { view, frame, postMessage, saveReview, select } = mountPreview()
    select()
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.getByText(zh.saved)).toBeDefined()

    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(frame)
    const initialFontSize = (within(dialog).getByLabelText(zh.fontSize) as HTMLInputElement).value
    const initialText = (within(dialog).getByLabelText(zh.textContent) as HTMLInputElement).value
    fireEvent.change(within(dialog).getByLabelText(zh.fontSize), { target: { value: '22px' } })
    fireEvent.change(within(dialog).getByLabelText(zh.textContent), { target: { value: 'Changed heading' } })
    expect(view.getByText(zh.unsaved)).toBeDefined()

    expect(saveReview).not.toHaveBeenCalled()
    expect(postMessage.mock.calls.map(([message]) => message).filter(message =>
      typeof message === 'object' && message !== null && ('kind' in message) &&
      (message.kind === 'style' || message.kind === 'text'))).toEqual([])

    fireEvent.click(within(dialog).getByRole('button', { name: zh.cancel }))
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.getByText(zh.saved)).toBeDefined()
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(frame)
    expect(saveReview).not.toHaveBeenCalled()
    expect(postMessage.mock.calls.map(([message]) => message).filter(message =>
      typeof message === 'object' && message !== null && ('kind' in message) &&
      (message.kind === 'style' || message.kind === 'text'))).toEqual([])

    select()
    const reopened = view.getByRole('dialog', { name: zh.editElement })
    expect((within(reopened).getByLabelText(zh.fontSize) as HTMLInputElement).value).toBe(initialFontSize)
    expect((within(reopened).getByLabelText(zh.textContent) as HTMLInputElement).value).toBe(initialText)
  })

  it('does not offer aggregate child text when a parent block is selected', async () => {
    const { view, store, postMessage, saveReview, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select(PARENT_ANCHOR)
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(within(dialog).getByText(zh.textSelectionHint)).toBeDefined()
    expect(within(dialog).queryByRole('textbox', { name: zh.textContent })).toBeNull()
    expect(within(dialog).getByRole('button', { name: zh.copyLocator })).toBeDefined()

    fireEvent.change(within(dialog).getByLabelText(zh.fontSize), { target: { value: '24px' } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.save }))
    await waitFor(() => expect(saveReview).toHaveBeenCalledOnce())
    expect(saveReview).toHaveBeenCalledWith(fileRefOf(RESOURCE_ADDRESS), expect.objectContaining({
      edits: [expect.objectContaining({ selector: PARENT_ANCHOR.selector, declarations: { 'font-size': '24px' } })],
    }))
    expect(postMessage).toHaveBeenCalledWith({
      channel: CHANNEL, kind: 'style', selector: PARENT_ANCHOR.selector, declarations: { 'font-size': '24px' },
    }, '*')
    expect(postMessage.mock.calls.some(([message]) =>
      typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'text')).toBe(false)
  })

  it('stages only the selected element for deletion and writes its original identity on explicit file save', async () => {
    const { view, frame, store, postMessage, saveReview, applyToFile, dispatchRemoveResult, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select(ANCHOR)
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(within(dialog).getByText(zh.deleteHint)).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: zh.deleteElement }))
    const request = lastRemovalRequest(postMessage)
    expect(request.selector).toBe(ANCHOR.selector)
    expect(applyToFile).not.toHaveBeenCalled()
    expect(saveReview).not.toHaveBeenCalled()

    dispatchRemoveResult(frame, request.selector, request.requestId, true)
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.getByText(zh.unsaved)).toBeDefined()
    expect(store.getSnapshot().selected).toBeNull()
    expect(applyToFile).not.toHaveBeenCalled()

    applyToFile.mockResolvedValue({ path: PATH, applied: [ANCHOR.selector], skipped: [], bytes: 75, changed: true })
    const saveFile = view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement
    expect(saveFile.disabled).toBe(false)
    fireEvent.click(saveFile)
    await waitFor(() => expect(applyToFile).toHaveBeenCalledOnce())
    expect(applyToFile).toHaveBeenCalledWith({
      file: fileRefOf(RESOURCE_ADDRESS),
      edits: [],
      textEdits: {},
      deletions: [{ selector: ANCHOR.selector, text: ANCHOR.sourceText, classes: ANCHOR.sourceClasses }],
    })
    await waitFor(() => expect(view.getByText(zh.saved)).toBeDefined())
    expect(saveFile.disabled).toBe(true)
    expect(saveReview).not.toHaveBeenCalled()
  })

  it('identifies the entire selected parent block and disables deletion of page roots', async () => {
    const { view, store, postMessage, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select(PARENT_ANCHOR)
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(within(dialog).getByText('MAIN')).toBeDefined()
    expect(within(dialog).getByText(PARENT_ANCHOR.selector)).toBeDefined()
    expect(within(dialog).getByText(zh.deleteHint)).toBeDefined()
    expect((within(dialog).getByRole('button', { name: zh.deleteElement }) as HTMLButtonElement).disabled).toBe(false)

    const bodyAnchor: FrameAnchor = {
      selector: 'html > body', parentSelector: 'html', tag: 'body', classes: [], text: 'Page content',
      sourceText: 'Page content', sourceClasses: [], editableText: null,
      rect: { x: 0, y: 0, width: 320, height: 240 }, computed: {},
    }
    select(bodyAnchor)
    expect(within(dialog).getByText('BODY')).toBeDefined()
    expect(within(dialog).getByText(bodyAnchor.selector)).toBeDefined()
    expect(within(dialog).getByText(zh.deleteRootHint)).toBeDefined()
    expect((within(dialog).getByRole('button', { name: zh.deleteElement }) as HTMLButtonElement).disabled).toBe(true)
    expect(postMessage.mock.calls.some(([message]) =>
      typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'removeSelected')).toBe(false)
  })

  it('replays a pending deletion into a refreshed frame', async () => {
    const { view, frame, store, postMessage, dispatchFromFrame, dispatchRemoveResult, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    fireEvent.click(within(view.getByRole('dialog', { name: zh.editElement })).getByRole('button', { name: zh.deleteElement }))
    const request = lastRemovalRequest(postMessage)
    dispatchRemoveResult(frame, request.selector, request.requestId, true)

    act(() => store.actions.requestReload())
    const refreshedFrame = view.container.querySelector('iframe[data-html-design-preview]')
    if (!(refreshedFrame instanceof HTMLIFrameElement) || refreshedFrame.contentWindow === null) {
      throw new Error('Refreshed HTML preview frame did not mount')
    }
    const refreshedMessages = vi.spyOn(refreshedFrame.contentWindow, 'postMessage')
    dispatchFromFrame(refreshedFrame, 'ready')
    expect(refreshedMessages).toHaveBeenCalledWith({
      channel: CHANNEL, kind: 'replayRemoval', selector: ANCHOR.selector,
      requestId: expect.stringMatching(/^replay-\d+$/u),
    }, '*')
    expect(view.getByText(zh.unsaved)).toBeDefined()
  })

  it('undoes a pending deletion by refreshing the preview and omits it from the next file save', async () => {
    const { view, frame, store, postMessage, applyToFile, dispatchFromFrame, dispatchRemoveResult, select } = mountPreview(reviewWithStyle())
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    fireEvent.click(within(view.getByRole('dialog', { name: zh.editElement })).getByRole('button', { name: zh.deleteElement }))
    const request = lastRemovalRequest(postMessage)
    dispatchRemoveResult(frame, request.selector, request.requestId, true)
    expect(view.getByText(zh.unsaved)).toBeDefined()
    expect(view.getByRole('button', { name: zh.undoDeletions })).toBeDefined()
    expect(applyToFile).not.toHaveBeenCalled()

    fireEvent.click(view.getByRole('button', { name: zh.undoDeletions }))
    const refreshedFrame = view.container.querySelector('iframe[data-html-design-preview]')
    if (!(refreshedFrame instanceof HTMLIFrameElement) || refreshedFrame.contentWindow === null) {
      throw new Error('Undone deletion did not refresh the HTML preview frame')
    }
    expect(refreshedFrame).not.toBe(frame)
    expect(view.queryByRole('button', { name: zh.undoDeletions })).toBeNull()
    expect(view.getByText(zh.saved)).toBeDefined()
    const refreshedMessages = vi.spyOn(refreshedFrame.contentWindow, 'postMessage')
    dispatchFromFrame(refreshedFrame, 'ready')
    expect(refreshedMessages.mock.calls.some(([message]) =>
      typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'replayRemoval')).toBe(false)

    const saveFile = view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement
    expect(saveFile.disabled).toBe(false)
    fireEvent.click(saveFile)
    await waitFor(() => expect(applyToFile).toHaveBeenCalledOnce())
    expect(applyToFile).toHaveBeenCalledWith({
      file: fileRefOf(RESOURCE_ADDRESS),
      edits: reviewWithStyle().edits,
      textEdits: {},
      deletions: [],
    })
  })

  it('keeps earlier staged deletions when a later frame removal fails', async () => {
    const { view, frame, store, postMessage, applyToFile, dispatchRemoveResult, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select(ANCHOR)
    fireEvent.click(within(view.getByRole('dialog', { name: zh.editElement })).getByRole('button', { name: zh.deleteElement }))
    const first = lastRemovalRequest(postMessage)
    dispatchRemoveResult(frame, first.selector, first.requestId, true)
    expect(view.getByText(zh.unsaved)).toBeDefined()

    select(PARENT_ANCHOR)
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.deleteElement }))
    const second = lastRemovalRequest(postMessage)
    dispatchRemoveResult(frame, second.selector, second.requestId, false)
    expect(view.getByRole('dialog', { name: zh.editElement })).toBe(dialog)
    expect(view.getByRole('alert').textContent).toContain(zh.deleteFailed)
    expect(view.getByText(zh.unsaved)).toBeDefined()
    expect((view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement).disabled).toBe(false)
    expect((within(dialog).getByRole('button', { name: zh.deleteElement }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: zh.cancel }))
    fireEvent.click(view.getByRole('button', { name: zh.saveToFile }))
    await waitFor(() => expect(applyToFile).toHaveBeenCalledOnce())
    expect(applyToFile).toHaveBeenCalledWith(expect.objectContaining({
      deletions: [{ selector: ANCHOR.selector, text: ANCHOR.sourceText, classes: ANCHOR.sourceClasses }],
    }))
  })

  it('keeps a dragged position as a draft, restores it on cancel, and persists it on save', async () => {
    const { view, frame, store, postMessage, saveReview, applyToFile, dispatchFromFrame, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })

    dispatchFromFrame(frame, 'move', ANCHOR, { translate: '30px 40px' })
    expect(view.getByText(zh.unsaved)).toBeDefined()
    expect(saveReview).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: zh.cancel }))
    expect(view.getByText(zh.saved)).toBeDefined()
    expect(postMessage).toHaveBeenCalledWith({
      channel: CHANNEL, kind: 'style', selector: ANCHOR.selector, declarations: { translate: '' },
    }, '*')
    expect(saveReview).not.toHaveBeenCalled()
    expect((view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement).disabled).toBe(true)

    select()
    dispatchFromFrame(frame, 'move', ANCHOR, { translate: '50px 20px' })
    expect(view.getByText(zh.unsaved)).toBeDefined()
    fireEvent.click(within(view.getByRole('dialog', { name: zh.editElement })).getByRole('button', { name: zh.save }))
    await waitFor(() => expect(saveReview).toHaveBeenCalledOnce())
    expect(saveReview).toHaveBeenCalledWith(fileRefOf(RESOURCE_ADDRESS), expect.objectContaining({
      edits: [expect.objectContaining({ selector: ANCHOR.selector, declarations: { translate: '50px 20px' } })],
    }))
    const saveFile = view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement
    await waitFor(() => expect(saveFile.disabled).toBe(false))
    fireEvent.click(saveFile)
    await waitFor(() => expect(applyToFile).toHaveBeenCalledOnce())
    expect(applyToFile).toHaveBeenCalledWith({
      file: fileRefOf(RESOURCE_ADDRESS),
      edits: [expect.objectContaining({ selector: ANCHOR.selector, declarations: { translate: '50px 20px' } })],
      textEdits: {},
      deletions: [],
    })
  })

  it('waits for the review write before enabling Save to file', async () => {
    const { view, store, saveReview, applyToFile, select } = mountPreview()
    let finishSave!: () => void
    saveReview.mockImplementation(() => new Promise<void>(resolve => { finishSave = resolve }))
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    fireEvent.change(within(view.getByRole('dialog', { name: zh.editElement })).getByLabelText(zh.fontSize), {
      target: { value: '22px' },
    })
    fireEvent.click(within(view.getByRole('dialog', { name: zh.editElement })).getByRole('button', { name: zh.save }))
    const saveFile = view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement
    expect(saveFile.disabled).toBe(true)
    fireEvent.click(saveFile)
    expect(applyToFile).not.toHaveBeenCalled()
    await act(async () => { finishSave() })
    await waitFor(() => expect(saveFile.disabled).toBe(false))
  })

  it('keeps an existing style edit when reset is cancelled', async () => {
    const { view, store, postMessage, saveReview, select } = mountPreview(reviewWithStyle())
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    postMessage.mockClear()
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect((within(dialog).getByLabelText(zh.fontSize) as HTMLInputElement).value).toBe('18px')

    fireEvent.click(within(dialog).getByRole('button', { name: zh.resetStyle }))
    expect((within(dialog).getByLabelText(zh.fontSize) as HTMLInputElement).value).toBe('')
    fireEvent.click(within(dialog).getByRole('button', { name: zh.cancel }))

    expect(saveReview).not.toHaveBeenCalled()
    expect(store.getSnapshot().document?.edits).toEqual(reviewWithStyle().edits)
    expect(postMessage.mock.calls.map(([message]) => message).filter(message =>
      typeof message === 'object' && message !== null && ('kind' in message) &&
      (message.kind === 'style' || message.kind === 'text'))).toEqual([])
    select()
    expect((within(view.getByRole('dialog', { name: zh.editElement })).getByLabelText(zh.fontSize) as HTMLInputElement).value).toBe('18px')
  })

  it('replays mode, stored styles, and pending text when a refreshed frame becomes ready', async () => {
    const { view, frame, store, saveReview, dispatchFromFrame, select } = mountPreview(reviewWithStyle())
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    fireEvent.change(within(dialog).getByLabelText(zh.textContent), { target: { value: 'Pending heading' } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.save }))
    expect(saveReview).not.toHaveBeenCalled()

    act(() => store.actions.requestReload())
    const refreshedFrame = view.container.querySelector('iframe[data-html-design-preview]')
    if (!(refreshedFrame instanceof HTMLIFrameElement) || refreshedFrame.contentWindow === null) {
      throw new Error('Refreshed HTML preview frame did not mount')
    }
    expect(refreshedFrame).not.toBe(frame)
    const refreshedMessages = vi.spyOn(refreshedFrame.contentWindow, 'postMessage')
    dispatchFromFrame(refreshedFrame, 'ready')

    expect(refreshedMessages.mock.calls).toEqual([
      [{ channel: CHANNEL, kind: 'mode', mode: 'inspect', dragHandleLabel: zh.dragHandle }, '*'],
      [{ channel: CHANNEL, kind: 'style', selector: ANCHOR.selector, declarations: { 'font-size': '18px' } }, '*'],
      [{ channel: CHANNEL, kind: 'text', selector: ANCHOR.selector, value: 'Pending heading' }, '*'],
    ])
  })

  it('enables element saving only after the Host returns the canonical file path', async () => {
    let resolveRead!: (result: DesignReadResult) => void
    const pendingRead = new Promise<DesignReadResult>(resolve => { resolveRead = resolve })
    const { view, loadReview, saveReview, select } = mountPreview(null, async () => pendingRead)
    expect(loadReview).toHaveBeenCalledWith(fileRefOf(RESOURCE_ADDRESS))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    const save = within(dialog).getByRole('button', { name: zh.save }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    act(() => resolveRead({ path: PATH, document: null, storePath: `${PATH}.design.json` }))
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.change(within(dialog).getByLabelText(zh.fontSize), { target: { value: '22px' } })
    fireEvent.click(save)

    await waitFor(() => expect(saveReview).toHaveBeenCalledOnce())
    expect(saveReview).toHaveBeenCalledWith(fileRefOf(RESOURCE_ADDRESS), expect.objectContaining({
      file: PATH,
      edits: [expect.objectContaining({ selector: ANCHOR.selector })],
    }))
  })

  it('keeps file and element saving disabled when the Host read fails', async () => {
    const { view, store, saveReview, applyToFile, select } = mountPreview(null, async () => {
      throw new Error('Host read failed')
    })
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    expect(view.getByRole('alert').textContent).toContain('Host read failed')
    act(() => store.actions.upsertEdit({
      selector: ANCHOR.selector, declarations: { 'font-size': '22px' }, updatedAt: '2026-09-23T00:00:00.000Z',
    }))
    expect((view.getByRole('button', { name: zh.saveToFile }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const save = within(view.getByRole('dialog', { name: zh.editElement }))
      .getByRole('button', { name: zh.save }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(saveReview).not.toHaveBeenCalled()
    expect(applyToFile).not.toHaveBeenCalled()

  })

  it('sends saved style and text to the mounted page and persists the style review', async () => {
    const { view, frame, store, postMessage, saveReview, select } = mountPreview()
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    fireEvent.change(within(dialog).getByLabelText(zh.fontSize), { target: { value: '22px' } })
    fireEvent.change(within(dialog).getByLabelText(zh.textContent), { target: { value: 'Changed heading' } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.save }))

    await waitFor(() => expect(saveReview).toHaveBeenCalledOnce())
    expect(saveReview).toHaveBeenCalledWith(fileRefOf(RESOURCE_ADDRESS), expect.objectContaining({
      file: PATH,
      edits: [expect.objectContaining({ selector: ANCHOR.selector, declarations: { 'font-size': '22px' } })],
    }))
    expect(postMessage).toHaveBeenCalledWith({
      channel: CHANNEL, kind: 'style', selector: ANCHOR.selector, declarations: { 'font-size': '22px' },
    }, '*')
    expect(postMessage).toHaveBeenCalledWith({
      channel: CHANNEL, kind: 'text', selector: ANCHOR.selector, value: 'Changed heading',
    }, '*')
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(frame)
  })
})
