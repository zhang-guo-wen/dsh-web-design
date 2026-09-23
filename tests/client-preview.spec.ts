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
  tag: 'h1',
  id: 'headline',
  classes: [],
  text: 'Original heading',
  rect: { x: 24, y: 32, width: 240, height: 48 },
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
  const dispatchFromFrame = (source: HTMLIFrameElement, kind: 'ready' | 'select') => {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: source.contentWindow,
        data: kind === 'select' ? { channel: CHANNEL, kind, anchor: ANCHOR } : { channel: CHANNEL, kind },
      }))
    })
  }
  const select = () => {
    dispatchFromFrame(frame, 'select')
  }
  return { view, frame, props, store, loadReview, saveReview, applyToFile, postMessage, dispatchFromFrame, select }
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
  it('shows the page frame immediately and keeps the review panel optional', () => {
    const { view, frame } = mountPreview()
    expect(frame.getAttribute('src')).toMatch(/^blob:html-design-preview-/)
    expect(frame.hasAttribute('srcdoc')).toBe(false)
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.queryByText(zh.noSelection)).toBeNull()

    fireEvent.click(view.getByRole('button', { name: zh.showPanel }))
    expect(view.getByText(zh.noSelection)).toBeDefined()
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(frame)

    fireEvent.click(view.getByRole('button', { name: zh.hidePanel }))
    expect(view.queryByText(zh.noSelection)).toBeNull()
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

    fireEvent.click(view.getByRole('button', { name: zh.modeInspect }))
    select()
    const dialog = view.getByRole('dialog', { name: zh.editElement })
    expect(view.container.querySelector('iframe[data-html-design-preview]')).toBe(frame)
    const initialFontSize = (within(dialog).getByLabelText(zh.fontSize) as HTMLInputElement).value
    const initialText = (within(dialog).getByLabelText(zh.textContent) as HTMLInputElement).value
    fireEvent.change(within(dialog).getByLabelText(zh.fontSize), { target: { value: '22px' } })
    fireEvent.change(within(dialog).getByLabelText(zh.textContent), { target: { value: 'Changed heading' } })

    expect(saveReview).not.toHaveBeenCalled()
    expect(postMessage.mock.calls.map(([message]) => message).filter(message =>
      typeof message === 'object' && message !== null && ('kind' in message) &&
      (message.kind === 'style' || message.kind === 'text'))).toEqual([])

    fireEvent.click(within(dialog).getByRole('button', { name: zh.cancel }))
    expect(view.queryByRole('dialog')).toBeNull()
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
      [{ channel: CHANNEL, kind: 'mode', mode: 'inspect' }, '*'],
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

    fireEvent.click(view.getByRole('button', { name: zh.modeComment }))
    expect((view.getByRole('button', { name: zh.submitComment }) as HTMLButtonElement).disabled).toBe(true)
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
