/**
 * The Sidebar's web-design HTML preview.
 *
 * The reviewed page stays visible in the preview tab. A compact toolbar
 * switches pointer modes, and double-clicking a selected element in edit
 * mode opens its inputs in a dialog. Review state reaches the Host
 * through the injected `saveReview`/`loadReview` callbacks, which the plugin
 * body binds to the `webDesignReview` Remote.
 *
 * The component holds no subscriptions of its own: the store reaches it through
 * the framework's `useStore` seat, and everything else is owner or inject data.
 * The element under the pointer is not routed through the store: the frame
 * paints its hover outline itself, so hover stays out of the render path.
 *
 * @module @guowenzhang/dsh-web-design/client/HtmlDesignBody
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, Input, Tag, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { InjectFace, PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesignAnnotationDocument, DesignApplyRequest, DesignApplyResult, DesignFileRef, DesignReadResult, ElementCommentAnchor, ElementEdit } from '../types.ts'
import { buildPreviewDocument } from './document.ts'
import { CHANNEL } from './frame-runtime.ts'
import type { FrameAnchor, FrameToParent } from './frame-runtime.ts'
import { createDesignStore } from './store.ts'
import type { DesignMode, DesignStoreState } from './store.ts'
import css from './HtmlDesignBody.module.css'

/** The store handle type this preview is registered with. */
export type DesignStore = ReturnType<typeof createDesignStore>

/**
 * Where the editor panel sits.
 *
 * `auto` keeps it beside the preview when the viewport has room and drops it to
 * a bottom sheet when it does not; `bottom` is the reviewer's own choice to
 * always keep the preview's upper half uncovered.
 */
export type EditorDock = 'auto' | 'bottom'

/** Host-bound callbacks the plugin supplies through the slot's inject face. */
export interface HtmlDesignBodyInjected {
  /**
   * Read the stored review for this document.
   * @param file - Session-scoped address of the previewed file.
   * @returns the canonical Host path and stored document.
   */
  readonly loadReview: (file: DesignFileRef) => Promise<DesignReadResult>
  /**
   * Persist the review for this document.
   * @param file - Session-scoped address of the previewed file.
   * @param document - the review to store.
   * @returns once the Host has written it.
   */
  readonly saveReview: (file: DesignFileRef, document: DesignAnnotationDocument) => Promise<void>
  /**
   * Write the reviewer's edits into the document's own source file.
   * @param request - the file path, its style edits, and its text replacements.
   * @returns what the Host applied and what it could not locate.
   */
  readonly applyToFile: (request: DesignApplyRequest) => Promise<DesignApplyResult>
  /**
   * Parse the Session address of a document from its resource address.
   * @param address - the tab's `dsh-resource://file/…` address.
   * @returns the Session and path, or `undefined` when the address is not session-scoped.
   */
  readonly fileRefOf: (address: string) => DesignFileRef | undefined
  /**
   * Read the reviewer's remembered editor dock.
   * @returns the stored preference, or `'auto'` when none is stored.
   */
  readonly readEditorDock: () => EditorDock
  /**
   * Remember the reviewer's editor dock for the next session.
   * @param dock - the preference to store.
   */
  readonly writeEditorDock: (dock: EditorDock) => void
}

/** Props the framework derives for the document slot. */
export type HtmlDesignBodyProps =
  DocumentPreviewProps
  & PropsLocale<'sidebarWebDesign'>
  & PropsStore<DesignStore>
  & InjectFace<HtmlDesignBodyInjected>

const MODES: readonly DesignMode[] = ['browse', 'inspect']

/** Editable style properties, with the locale key naming each one.
 *
 * `tier` splits the two levels the editor shows: the fields a reviewer reaches
 * for on nearly every element stay in the open grid, and the rest sit behind a
 * disclosure. A stored edit in the second tier forces it open, so a saved value
 * is never hidden. */
const STYLE_FIELDS: readonly {
  readonly key: string
  readonly label: 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing' | 'color' | 'background' | 'padding' | 'margin' | 'borderRadius'
  readonly tier: 'primary' | 'advanced'
}[] = [
  { key: 'font-size', label: 'fontSize', tier: 'primary' },
  { key: 'font-weight', label: 'fontWeight', tier: 'primary' },
  { key: 'color', label: 'color', tier: 'primary' },
  { key: 'background-color', label: 'background', tier: 'primary' },
  { key: 'line-height', label: 'lineHeight', tier: 'advanced' },
  { key: 'letter-spacing', label: 'letterSpacing', tier: 'advanced' },
  { key: 'padding', label: 'padding', tier: 'advanced' },
  { key: 'margin', label: 'margin', tier: 'advanced' },
  { key: 'border-radius', label: 'borderRadius', tier: 'advanced' },
]

/** One editable style property, as the editor lists it. */
type StyleField = typeof STYLE_FIELDS[number]

/** The two disclosure levels, split once so both lists keep a stable identity. */
const PRIMARY_STYLE_FIELDS = STYLE_FIELDS.filter(field => field.tier === 'primary')
const ADVANCED_STYLE_FIELDS = STYLE_FIELDS.filter(field => field.tier === 'advanced')

/** Placement of the editor in the visible application viewport. */
interface EditorPlacement {
  readonly side: 'left' | 'right' | 'bottom'
  readonly left: number
  readonly top: number
  readonly width: number
  readonly maxHeight: number
}

/** A removal staged in the preview until the source file is saved. */
interface PendingDeletion {
  readonly selector: string
  readonly text: string
  readonly classes: readonly string[]
  readonly removedSelectors: readonly string[]
}

/** The selected frame instance and its original source fingerprint. */
interface SelectedSource {
  readonly selector: string
  readonly text: string
  readonly classes: readonly string[]
}

/** Outcome of the explicit review or file write the toolbar reports. */
interface FileWriteState {
  readonly kind: 'idle' | 'saving' | 'saved' | 'partial' | 'failed'
  readonly detail: string
}

/**
 * Keep an editing surface beside the Sidebar when space allows.
 * @param stage - the preview stage the panel is placed against.
 * @param docked - whether the reviewer asked for the bottom sheet outright.
 * @returns the fixed placement for the panel.
 */
function placeEditor(stage: HTMLElement, docked: boolean): EditorPlacement {
  const rect = stage.getBoundingClientRect()
  const visual = window.visualViewport
  const viewportLeft = visual?.offsetLeft ?? 0
  const viewportTop = visual?.offsetTop ?? 0
  const viewportWidth = visual?.width ?? window.innerWidth
  const viewportHeight = visual?.height ?? window.innerHeight
  const inset = 12
  const gap = 16
  const viewportRight = viewportLeft + viewportWidth
  const viewportBottom = viewportTop + viewportHeight
  const leftRoom = rect.left - viewportLeft - inset - gap
  const rightRoom = viewportRight - rect.right - inset - gap
  const minimumSideWidth = 260
  const maxHeight = Math.max(0, Math.min(560, viewportHeight - inset * 2))

  if (!docked && (leftRoom >= minimumSideWidth || rightRoom >= minimumSideWidth)) {
    const side = leftRoom >= minimumSideWidth ? 'left' : 'right'
    const width = Math.min(480, side === 'left' ? leftRoom : rightRoom)
    const left = side === 'left' ? rect.left - gap - width : rect.right + gap
    const top = Math.min(Math.max(rect.top + 20, viewportTop + inset), viewportBottom - inset - maxHeight)
    return { side, left, top, width, maxHeight }
  }

  // On a narrow viewport, leave the upper half of the preview uncovered.
  const width = Math.max(0, Math.min(480, viewportWidth - inset * 2))
  const visibleStageHeight = Math.max(0, Math.min(rect.bottom, viewportBottom) - Math.max(rect.top, viewportTop))
  const maxBottomHeight = Math.max(0, Math.min(400, viewportHeight * 0.48, visibleStageHeight * 0.55))
  return {
    side: 'bottom',
    left: viewportLeft + (viewportWidth - width) / 2,
    top: viewportBottom - inset - maxBottomHeight,
    width,
    maxHeight: maxBottomHeight,
  }
}

/**
 * Render the HTML design preview.
 * @param props - document content, framework store seat, injected host callbacks, and locale.
 * @returns the preview, or the loading and failure states.
 */
export function HtmlDesignBody(props: HtmlDesignBodyProps): ReactNode {
  const { content, resourceAddress, useStore, loadReview, saveReview, applyToFile, fileRefOf, readEditorDock, writeEditorDock, actions, t } = props
  const state = useStore(selector => selector)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const focusReturnRef = useRef<HTMLElement | null>(null)
  const [editorPlacement, setEditorPlacement] = useState<EditorPlacement | null>(null)
  const [editorDock, setEditorDock] = useState<EditorDock>(readEditorDock)
  const [draftStyle, setDraftStyle] = useState<Record<string, string>>({})
  const [advancedStylesOpen, setAdvancedStylesOpen] = useState(false)
  const [computed, setComputed] = useState<Record<string, string>>({})
  const [draftText, setDraftText] = useState('')
  const [editableText, setEditableText] = useState<string | null>(null)
  const [selectedParentSelector, setSelectedParentSelector] = useState<string | null>(null)
  const [locatorCopy, setLocatorCopy] = useState<{ readonly selector: string; readonly success: boolean } | null>(null)
  const selectedSource = useRef<SelectedSource | null>(null)
  const deletionRequest = useRef<{ readonly requestId: string; readonly source: SelectedSource } | null>(null)
  const nextDeletionRequest = useRef(0)
  const [deleting, setDeleting] = useState(false)
  const [deletions, setDeletions] = useState<readonly PendingDeletion[]>([])
  const deletionsRef = useRef<readonly PendingDeletion[]>([])
  const pendingMove = useRef<{ readonly selector: string; readonly restore: Readonly<Record<string, string>> } | null>(null)
  // Text edits are held here rather than in the review store: they are a
  // source rewrite awaiting the explicit save, not review state to persist.
  const [textEdits, setTextEdits] = useState<Record<string, string>>({})
  const [pendingEdits, setPendingEdits] = useState(false)
  const editRevision = useRef(0)
  const [fileWrite, setFileWrite] = useState<FileWriteState>({ kind: 'idle', detail: '' })
  const [frameResource, setFrameResource] = useState<{ readonly source: string; readonly url: string } | null>(null)
  const [frameAppliedMode, setFrameAppliedMode] = useState<{ readonly source: string; readonly reloadToken: number; readonly mode: DesignMode } | null>(null)
  const [resolvedFile, setResolvedFile] = useState<{ readonly address: string; readonly path: string } | null>(null)
  /** Bumped to re-run the review read after a failed load. */
  const [loadAttempt, setLoadAttempt] = useState(0)
  const editorScrollRef = useRef<HTMLDivElement | null>(null)
  const editorScrollTop = useRef(0)
  // Ids in a portaled panel are unique per mounted editor, not per document.
  const advancedStylesId = useId()
  // The reviewed page's own scroll offset, replayed into a refreshed frame so a
  // reload does not move the reader to the top of the document.
  const frameScroll = useRef<{ readonly x: number; readonly y: number }>({ x: 0, y: 0 })
  const documentRef = useRef(state.document)
  documentRef.current = state.document
  /**
   * The current removal action, for the frame's Delete key.
   *
   * The message listener is installed before this callback exists, and it must
   * not re-subscribe on every edit-toolbar change; a ref carries the latest
   * closure to it without either.
   */
  const deleteSelectionRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (locatorCopy === null) return
    const timeout = window.setTimeout(() => setLocatorCopy(null), 1600)
    return () => window.clearTimeout(timeout)
  }, [locatorCopy])

  const fileRef = useMemo(() => fileRefOf(resourceAddress), [fileRefOf, resourceAddress])
  const hostPath = resolvedFile?.address === resourceAddress ? resolvedFile.path : undefined
  const source = useMemo(
    () => content.kind === 'bytes' ? buildPreviewDocument(content.data) : undefined,
    [content],
  )

  useEffect(() => {
    if (source === undefined) return
    const url = URL.createObjectURL(new Blob([source], { type: 'text/html;charset=utf-8' }))
    setFrameResource({ source, url })
    return () => { URL.revokeObjectURL(url) }
  }, [source])

  /** Restore a dragged element when its dialog is discarded. */
  const discardMove = useCallback(() => {
    const move = pendingMove.current
    if (move === null) return
    postToFrame(frameRef.current, { kind: 'style', selector: move.selector, declarations: move.restore })
    pendingMove.current = null
  }, [])

  /** Adopt a frame selection; only an explicit edit gesture opens the dialog. */
  const selectAnchor = useCallback((anchor: FrameAnchor, openEditor: boolean) => {
    selectedSource.current = { selector: anchor.selector, text: anchor.sourceText, classes: anchor.sourceClasses }
    setSelectedParentSelector(anchor.parentSelector)
    const sameSelection = state.selectedSelector === anchor.selector
    if (state.open && sameSelection) {
      actions.select(toAnchor(anchor))
      return
    }
    discardMove()
    actions.select(toAnchor(anchor))
    if (!openEditor || state.mode !== 'inspect') {
      if (state.open) actions.setOpen(false)
      return
    }
    setComputed(anchor.computed)
    focusReturnRef.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : frameRef.current
    setDraftStyle(state.document?.edits.find(edit => edit.selector === anchor.selector)?.declarations ?? {})
    setEditableText(anchor.editableText)
    setDraftText(anchor.editableText === null ? '' : textEdits[anchor.selector] ?? anchor.editableText)
    actions.setOpen(true)
  }, [actions, discardMove, state.mode, state.document, state.open, state.selectedSelector, textEdits])

  const closeEditor = useCallback(() => {
    actions.setOpen(false)
    window.requestAnimationFrame(() => {
      const previous = focusReturnRef.current
      if (previous?.isConnected) previous.focus()
      else frameRef.current?.focus()
    })
  }, [actions])

  const cancelEditor = useCallback(() => {
    discardMove()
    closeEditor()
  }, [closeEditor, discardMove])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!state.open || stage === null) {
      setEditorPlacement(null)
      return
    }
    // Reopen where the reviewer left the form, not at its first field.
    if (editorScrollRef.current !== null) editorScrollRef.current.scrollTop = editorScrollTop.current
    let frame = 0
    const update = (): void => { setEditorPlacement(placeEditor(stage, editorDock === 'bottom')) }
    const schedule = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(update)
    }
    update()
    const observer = new ResizeObserver(schedule)
    observer.observe(stage)
    window.addEventListener('resize', schedule)
    window.document.addEventListener('scroll', schedule, true)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.document.removeEventListener('scroll', schedule, true)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
    }
  }, [state.open, editorDock])

  // Push the active mode into the frame so its listeners match the switch.
  useEffect(() => {
    postToFrame(frameRef.current, { kind: 'mode', mode: state.mode, dragHandleLabel: t('dragHandle') })
  }, [state.mode, source, state.reloadToken, t])

  useEffect(() => {
    if (!state.open) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        cancelEditor()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [state.open, cancelEditor])

  // Resolve the Session path on the Host before enabling any file writes.
  useEffect(() => {
    setResolvedFile(null)
    setTextEdits({})
    setDeletions([])
    deletionsRef.current = []
    selectedSource.current = null
    setSelectedParentSelector(null)
    deletionRequest.current = null
    setDeleting(false)
    setPendingEdits(false)
    editRevision.current = 0
    pendingMove.current = null
    frameScroll.current = { x: 0, y: 0 }
    setFileWrite({ kind: 'idle', detail: '' })
    actions.load(null)
    actions.select(null)
    actions.setOpen(false)
    if (fileRef === undefined) {
      actions.endLoad()
      return
    }
    let active = true
    actions.beginLoad()
    void loadReview(fileRef)
      .then((result) => {
        if (!active) return
        setResolvedFile({ address: resourceAddress, path: result.path })
        actions.load(result.document)
        actions.endLoad()
      })
      .catch((error: unknown) => {
        if (!active) return
        setResolvedFile(null)
        actions.load(null)
        actions.endLoad()
        setFileWrite({ kind: 'failed', detail: error instanceof Error ? error.message : String(error) })
      })
    return () => { active = false }
  }, [fileRef, resourceAddress, loadReview, actions, loadAttempt])

  // Re-apply stored edits whenever the document reloads, so a saved style
  // survives a refresh of the reviewed document.
  useEffect(() => {
    const edits = state.document?.edits ?? []
    for (const edit of edits) {
      postToFrame(frameRef.current, { kind: 'style', selector: edit.selector, declarations: edit.declarations })
    }
  }, [state.document, state.reloadToken])

  // Receive selection and drag completion from the frame runtime.
  useEffect(() => {
    const listener = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null) return
      const message = data as Partial<FrameToParent>
      if (message.channel !== CHANNEL) return
      switch (message.kind) {
        case 'ready':
          // A refreshed frame starts at the top; put the reader back first.
          postToFrame(frameRef.current, { kind: 'restoreScroll', x: frameScroll.current.x, y: frameScroll.current.y })
          postToFrame(frameRef.current, { kind: 'mode', mode: state.mode, dragHandleLabel: t('dragHandle') })
          for (const edit of state.document?.edits ?? []) {
            postToFrame(frameRef.current, { kind: 'style', selector: edit.selector, declarations: edit.declarations })
          }
          for (const [selector, value] of Object.entries(textEdits)) {
            postToFrame(frameRef.current, { kind: 'text', selector, value })
          }
          for (const deletion of deletionsRef.current) {
            postToFrame(frameRef.current, {
              kind: 'replayRemoval', selector: deletion.selector, requestId: `replay-${++nextDeletionRequest.current}`,
            })
          }
          return
        case 'modeApplied':
          if (message.mode === state.mode && source !== undefined) {
            setFrameAppliedMode({ source, reloadToken: state.reloadToken, mode: message.mode })
          }
          return
        case 'deleteSelected':
          // The frame reports the gesture; the parent owns every guard on it.
          deleteSelectionRef.current()
          return
        case 'scroll':
          if (typeof message.x === 'number' && typeof message.y === 'number') {
            frameScroll.current = { x: message.x, y: message.y }
          }
          return
        case 'hover':
          // The frame draws the hover outline itself; keeping it out of the
          // render path is what stops one commit per crossed element.
          return
        case 'select':
          if (message.anchor !== undefined) selectAnchor(message.anchor, false)
          return
        case 'edit':
          if (message.anchor !== undefined) selectAnchor(message.anchor, true)
          return
        case 'move':
          if (message.anchor === undefined || message.declarations === undefined || message.restore === undefined || message.selector === undefined) return
          if (state.selectedSelector !== message.selector || !state.open) return
          if (pendingMove.current === null) {
            pendingMove.current = { selector: message.selector, restore: message.restore }
          }
          actions.select(toAnchor(message.anchor))
          setDraftStyle(current => ({ ...current, ...message.declarations }))
          setFileWrite({ kind: 'idle', detail: '' })
          return
        case 'removeResult': {
          if (typeof message.requestId !== 'string' || typeof message.selector !== 'string') return
          const request = deletionRequest.current
          if (request?.requestId === message.requestId && request.source.selector === message.selector) {
            deletionRequest.current = null
            setDeleting(false)
            const removedSelectors = Array.isArray(message.removedSelectors)
              ? message.removedSelectors.filter((selector): selector is string => typeof selector === 'string')
              : []
            if (message.success !== true || !removedSelectors.includes(message.selector)) {
              setFileWrite({ kind: 'failed', detail: t('deleteFailed') })
              return
            }
            const deletion: PendingDeletion = { ...request.source, removedSelectors }
            const next = [...deletionsRef.current.filter(current => !removedSelectors.includes(current.selector)), deletion]
            deletionsRef.current = next
            setDeletions(next)
            pendingMove.current = null
            editRevision.current += 1
            setFileWrite({ kind: 'idle', detail: '' })
            actions.select(null)
            closeEditor()
            return
          }
          if (message.requestId.startsWith('replay-') && message.success !== true) {
            setFileWrite({ kind: 'failed', detail: `${t('deleteFailed')}: ${message.selector}` })
          }
          return
        }
        default:
          return
      }
    }
    window.addEventListener('message', listener)
    return () => { window.removeEventListener('message', listener) }
  }, [actions, closeEditor, selectAnchor, source, state.mode, state.document, state.reloadToken, state.selectedSelector, state.open, textEdits, t])

  /** Write the current review to the Host. */
  const persist = useCallback(async (next: DesignAnnotationDocument) => {
    if (fileRef === undefined || hostPath === undefined) return
    const canonical = { ...next, file: hostPath }
    actions.beginSave()
    try {
      await saveReview(fileRef, canonical)
      actions.endSave(canonical)
    } catch (error) {
      actions.failSave(error instanceof Error ? error.message : String(error))
    }
  }, [fileRef, hostPath, saveReview, actions])

  /** The document with one edit applied, replacing any prior edit for the selector. */
  const withEdit = useCallback((edit: ElementEdit, path: string): DesignAnnotationDocument => {
    const base = state.document ?? {
      version: 1 as const, file: path, comments: [], edits: [], updatedAt: edit.updatedAt,
    }
    return {
      ...base,
      edits: [...base.edits.filter(existing => existing.selector !== edit.selector), edit],
      updatedAt: edit.updatedAt,
    }
  }, [state.document])

  const saveSelection = useCallback(() => {
    const selector = state.selectedSelector
    if (selector === null || hostPath === undefined) return
    const declarations = cleanDeclarations(draftStyle)
    const previous = state.document?.edits.find(edit => edit.selector === selector)
    const styleChanged = !sameDeclarations(previous?.declarations ?? {}, declarations)
    const textChanged = editableText !== null && draftText !== editableText
    if (styleChanged) {
      if (Object.keys(declarations).length > 0) {
        const edit: ElementEdit = { selector, declarations, updatedAt: new Date().toISOString() }
        actions.upsertEdit(edit)
        void persist(withEdit(edit, hostPath))
        if (previous !== undefined && Object.keys(previous.declarations).some(key => !(key in declarations))) {
          actions.requestReload()
        } else {
          postToFrame(frameRef.current, { kind: 'style', selector, declarations })
        }
      } else {
        actions.removeEdit(selector)
        void persist(withoutEdit(state.document, selector, hostPath))
        actions.requestReload()
      }
    }
    if (textChanged) {
      postToFrame(frameRef.current, { kind: 'text', selector, value: draftText })
      setTextEdits(current => ({ ...current, [selector]: draftText }))
    }
    if (styleChanged || textChanged) {
      editRevision.current += 1
      setPendingEdits(true)
    }
    pendingMove.current = null
    setFileWrite({ kind: 'idle', detail: '' })
    closeEditor()
  }, [draftStyle, draftText, editableText, state.selectedSelector, state.document, hostPath, actions, persist, withEdit, closeEditor])

  /** Remove only the selected frame element and stage its source deletion. */
  const deleteSelection = useCallback(() => {
    const source = selectedSource.current
    if (hostPath === undefined || !state.open || state.mode !== 'inspect' || deleting
      || fileWrite.kind === 'saving' || source === null || source.selector !== state.selectedSelector
      || /^(?:html|head|body)$/iu.test(state.selected?.tag ?? '')) return
    const requestId = `remove-${++nextDeletionRequest.current}`
    deletionRequest.current = { requestId, source }
    setDeleting(true)
    setFileWrite({ kind: 'idle', detail: '' })
    postToFrame(frameRef.current, { kind: 'removeSelected', selector: source.selector, requestId })
  }, [deleting, fileWrite.kind, hostPath, state.mode, state.open, state.selected?.tag, state.selectedSelector])
  deleteSelectionRef.current = deleteSelection

  /** Restore every deletion that has not yet been written into the source. */
  const undoDeletions = useCallback(() => {
    if (deletionsRef.current.length === 0 || fileWrite.kind === 'saving') return
    cancelEditor()
    deletionsRef.current = []
    setDeletions([])
    editRevision.current += 1
    setFileWrite({ kind: 'idle', detail: '' })
    actions.requestReload()
  }, [actions, cancelEditor, fileWrite.kind])

  const resetStyle = useCallback(() => {
    setDraftStyle({})
    setFileWrite({ kind: 'idle', detail: '' })
  }, [])

  /**
   * Write the reviewer's edits into the file itself.
   *
   * This is deliberately explicit: the review sidecar accumulates edits as the
   * reviewer works, and only this action changes the artifact. The Host applies
   * each edit as a span rewrite, so the result is reported back — including any
   * selector it could not locate in the source, which the reviewer must know
   * about rather than discover later.
   */
  const saveToFile = useCallback(() => {
    if (fileRef === undefined || hostPath === undefined) return
    const edits = state.document?.edits ?? []
    if (edits.length === 0 && Object.keys(textEdits).length === 0 && deletions.length === 0) {
      setFileWrite({ kind: 'idle', detail: '' })
      return
    }
    const revision = editRevision.current
    setFileWrite({ kind: 'saving', detail: '' })
    void applyToFile({ file: fileRef, edits, textEdits, deletions: deletions.map(({ selector, text, classes }) => ({ selector, text, classes })) })
      .then((result: DesignApplyResult) => {
        const skipped = new Set(result.skipped.map(entry => entry.selector))
        const applied = new Set(result.applied)
        const writtenDeletions = deletions.filter(deletion => applied.has(deletion.selector) && !skipped.has(deletion.selector))
        const missingDeletions = deletions.filter(deletion => !applied.has(deletion.selector) && !skipped.has(deletion.selector))
        if (writtenDeletions.length > 0) {
          const written = new Set(writtenDeletions.map(deletion => deletion.selector))
          const remaining = deletionsRef.current.filter(deletion => !written.has(deletion.selector))
          deletionsRef.current = remaining
          setDeletions(remaining)
          const removedSelectors = new Set(writtenDeletions.flatMap(deletion => deletion.removedSelectors))
          setTextEdits(current => Object.fromEntries(Object.entries(current)
            .filter(([selector]) => !removedSelectors.has(selector))))
          const document = documentRef.current
          if (document !== null && document.edits.some(edit => removedSelectors.has(edit.selector))) {
            const next = {
              ...document,
              edits: document.edits.filter(edit => !removedSelectors.has(edit.selector)),
              updatedAt: new Date().toISOString(),
            }
            actions.removeEdits([...removedSelectors])
            void persist(next)
          }
        }
        if (result.skipped.length > 0 || missingDeletions.length > 0) {
          const missed = [...result.skipped.map(entry => entry.selector), ...missingDeletions.map(deletion => deletion.selector)]
          setFileWrite({ kind: 'partial', detail: missed.join(', ') })
          return
        }
        setFileWrite({ kind: 'saved', detail: String(result.bytes) })
        if (editRevision.current === revision) setPendingEdits(false)
        setTextEdits(current => Object.fromEntries(Object.entries(current)
          .filter(([selector, value]) => textEdits[selector] !== value)))
      })
      .catch((error: unknown) => {
        setFileWrite({ kind: 'failed', detail: error instanceof Error ? error.message : String(error) })
      })
  }, [actions, applyToFile, deletions, fileRef, hostPath, persist, state.document, textEdits])

  const hasFileEdits = (state.document?.edits.length ?? 0) > 0 || Object.keys(textEdits).length > 0 || deletions.length > 0
  const previousStyle = state.document?.edits.find(edit => edit.selector === state.selectedSelector)?.declarations ?? {}
  const draftDirty = state.open && state.selected !== null && (
    !sameDeclarations(previousStyle, cleanDeclarations(draftStyle))
    || editableText !== null && draftText !== editableText
  )

  /** Render one editable style property; called inline so its inputs keep identity. */
  const renderStyleField = (field: StyleField): ReactNode => (
    <label key={field.key} className={css.field}>
      <span className={css.fieldLabel}>{t(field.label)}</span>
      <Input
        value={draftStyle[field.key] ?? ''}
        placeholder={computed[field.key] ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const value = event.target.value
          setDraftStyle(current => ({ ...current, [field.key]: value }))
          setFileWrite({ kind: 'idle', detail: '' })
        }}
      />
    </label>
  )

  // A stored value in the second tier keeps it open: a saved edit is never hidden.
  const showAdvancedStyles = advancedStylesOpen
    || ADVANCED_STYLE_FIELDS.some(field => (draftStyle[field.key] ?? '').trim() !== '')

  const statusDirty = state.dirty || draftDirty || pendingEdits || deletions.length > 0
  const rootSelected = /^(?:html|head|body)$/iu.test(state.selected?.tag ?? '')
  const frameInteractive = frameAppliedMode !== null && frameAppliedMode.source === source
    && frameAppliedMode.reloadToken === state.reloadToken && frameAppliedMode.mode === state.mode

  // Which recovery the visible failure offers, if any: re-read the review, write
  // it back, or write the file again. Nothing is offered for a state the
  // reviewer can only fix in the artifact itself.
  const retryAction: 'load' | 'review' | 'file' | null = state.error !== null && hostPath !== undefined
    ? 'review'
    : fileWrite.kind === 'failed' && resolvedFile === null && fileRef !== undefined
      ? 'load'
      : (fileWrite.kind === 'failed' || fileWrite.kind === 'partial') && hostPath !== undefined && hasFileEdits
        ? 'file'
        : null

  const retry = useCallback(() => {
    switch (retryAction) {
      case null: return
      case 'load': setLoadAttempt(attempt => attempt + 1); return
      case 'review': {
        if (hostPath === undefined) return
        const document = documentRef.current
        if (document !== null) void persist(document)
        return
      }
      case 'file': saveToFile()
    }
  }, [hostPath, persist, retryAction, saveToFile])

  if (content.kind !== 'bytes') {
    return (
      <div className={css.preview}>
        <p className={css.status} role="alert">
          <span className={css.statusTitle}>{t('unavailable')}</span>
          <span className={css.statusHint}>{t('unavailableHint')}</span>
        </p>
      </div>
    )
  }
  if (source === undefined) {
    return (
      <div className={css.preview}>
        <p className={css.status} role="alert">
          <span className={css.statusTitle}>{t('failed')}</span>
          <span className={css.statusHint}>{t('failedHint')}</span>
        </p>
      </div>
    )
  }
  // First paint holds the loaded layout: toolbar row, then the artboard.
  if (frameResource?.source !== source) {
    return (
      <div className={css.preview} aria-busy="true">
        <div className={css.skeletonToolbar} aria-hidden="true">
          <span className={css.skeletonBar} />
          <span className={css.skeletonBar} />
        </div>
        <div className={css.skeletonStage} aria-hidden="true">
          <span className={css.skeletonFrame} />
        </div>
        <span className={css.visuallyHidden} role="status">{t('loading')}</span>
      </div>
    )
  }

  return (
    <div className={css.preview} data-html-design-surface aria-busy={state.loading ? 'true' : undefined}>
      <div className={css.toolbar}>
        <div className={css.modeSwitch} role="group" aria-label={t('modes')} data-mode={state.mode}>
          {MODES.map(mode => (
            <button key={mode} type="button" className={css.modeOption} aria-pressed={state.mode === mode} title={mode === 'inspect' ? t('editGestureHint') : undefined} disabled={deleting} onClick={() => {
              if (state.mode === mode) return
              cancelEditor()
              postToFrame(frameRef.current, { kind: 'mode', mode, dragHandleLabel: t('dragHandle') })
              actions.setMode(mode)
            }}>
              {modeLabel(mode, t)}
            </button>
          ))}
        </div>
        <div className={css.toolbarEnd}>
          {state.loading && <span className={css.busy} role="status">{t('loadingReview')}</span>}
          {deletions.length > 0 && (
            <Tooltip label={t('undoDeletionsHint')}>
              <Button variant="ghost" size="sm" disabled={deleting || fileWrite.kind === 'saving'} onClick={undoDeletions}>{t('undoDeletions')}</Button>
            </Tooltip>
          )}
          <Tag tone={statusDirty ? 'warning' : state.error !== null || fileWrite.kind === 'failed' ? 'danger' : 'neutral'}>
            {draftDirty ? t('unsaved') : state.saving ? t('saving') : statusDirty ? t('unsaved') : state.error !== null || fileWrite.kind === 'failed' ? t('saveFailed') : t('saved')}
          </Tag>
          <Tooltip label={t('saveToFileHint')}>
            <Button variant="primary" size="sm" disabled={hostPath === undefined || !hasFileEdits || draftDirty || deleting || state.saving || fileWrite.kind === 'saving'} onClick={saveToFile}>
              {fileWrite.kind === 'saving' ? t('saving') : t('saveToFile')}
            </Button>
          </Tooltip>
          <Button variant="ghost" size="sm" onClick={() => {
            deletionRequest.current = null
            setDeleting(false)
            cancelEditor()
            actions.requestReload()
          }}>{t('reload')}</Button>
        </div>
      </div>

      <Notice state={state} fileWrite={fileWrite} resolved={resolvedFile !== null} retry={retryAction === null ? undefined : retry} t={t} />

      <div className={css.workspace}>
        <div ref={stageRef} className={css.stage} data-html-design-stage>
          <iframe
            key={state.reloadToken}
            ref={frameRef}
            className={css.frame}
            src={frameResource.url}
            // Scripts run so the injected runtime can observe and apply edits;
            // omitting allow-same-origin gives this Blob document an opaque
            // origin, so the reviewed page cannot reach this application.
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            title={t('frame')}
            data-html-design-preview
            data-frame-mode-ready={frameInteractive ? 'true' : 'false'}
          />
        </div>

        {state.open && state.selected !== null && editorPlacement !== null && createPortal(
            <div
              className={css.editor}
              role="dialog"
              aria-label={t('editElement')}
              aria-keyshortcuts="Escape"
              data-html-design-editor
              data-placement={editorPlacement.side}
              data-compact={editorPlacement.width < 390 ? '' : undefined}
              style={{
                left: editorPlacement.left,
                top: editorPlacement.top,
                width: editorPlacement.width,
                maxHeight: editorPlacement.maxHeight,
              }}
            >
              <div className={css.editorHeader}>
                <div className={css.editorIdentity}>
                  <span className={css.elementTag} title={t('elementTag')}>{state.selected.tag.toUpperCase()}</span>
                  <span className={css.locatorLabel}>{t('elementLocator')}</span>
                  <span className={css.editorSelector} title={state.selected.selector}>{state.selected.selector}</span>
                </div>
                <div className={css.editorHeaderActions}>
                  {selectedParentSelector !== null && (
                    <button type="button" className={css.editorHeaderAction} title={t('selectParentHint')} onClick={() => {
                      postToFrame(frameRef.current, { kind: 'selectParent' })
                    }}>{t('selectParent')}</button>
                  )}
                  <button type="button" className={css.editorHeaderAction} title={t('copyLocatorHint')} onClick={() => {
                    const selector = state.selected?.selector
                    if (selector === undefined) return
                    void writeClipboard(selector).then(success => setLocatorCopy({ selector, success }))
                  }}>{locatorCopy?.selector === state.selected.selector
                    ? t(locatorCopy.success ? 'locatorCopied' : 'locatorCopyFailed')
                    : t('copyLocator')}</button>
                  <button type="button" className={css.editorHeaderAction} title={t('dockHint')} onClick={() => {
                    const next: EditorDock = editorDock === 'bottom' ? 'auto' : 'bottom'
                    setEditorDock(next)
                    writeEditorDock(next)
                  }}>{editorDock === 'bottom' ? t('dockAuto') : t('dockBottom')}</button>
                  <Button variant="ghost" size="sm" aria-label={t('closeEditor')} onClick={cancelEditor}>×</Button>
                </div>
              </div>
              <div
                ref={editorScrollRef}
                className={css.editorScroll}
                onScroll={(event) => { editorScrollTop.current = event.currentTarget.scrollTop }}
              >
                <section className={css.section}>
                  <h3 className={css.sectionTitle}>{t('content')}</h3>
                  {editableText === null
                    ? <p className={css.hint}>{t('textSelectionHint')}</p>
                    : (
                      <label className={css.field}>
                        <span className={css.fieldLabel}>{t('textContent')}</span>
                        <textarea className={css.textInput} autoFocus value={draftText} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                          setDraftText(event.target.value)
                          setFileWrite({ kind: 'idle', detail: '' })
                        }} />
                      </label>
                    )}
                </section>
                <section className={css.section}>
                  <h3 className={css.sectionTitle}>{t('styles')}</h3>
                  <div className={css.fields}>
                    {PRIMARY_STYLE_FIELDS.map(renderStyleField)}
                  </div>
                  <button
                    type="button"
                    className={css.disclosure}
                    aria-expanded={showAdvancedStyles}
                    aria-controls={advancedStylesId}
                    onClick={() => {
                      // A stored advanced value keeps the group open, so this
                      // only ever closes a group the reviewer opened.
                      setAdvancedStylesOpen(!showAdvancedStyles)
                    }}
                  >
                    {showAdvancedStyles ? t('lessStyles') : t('moreStyles')}
                  </button>
                  {showAdvancedStyles && (
                    <div id={advancedStylesId} className={css.fields}>
                      {ADVANCED_STYLE_FIELDS.map(renderStyleField)}
                    </div>
                  )}
                </section>
                <dl className={css.meta}>
                  <dt>{t('size')}</dt>
                  <dd>{Math.round(state.selected.rect.width)} × {Math.round(state.selected.rect.height)}</dd>
                </dl>
                <p className={css.hint}>{t('dragHint')}</p>
                <p className={css.hint}>{t(rootSelected ? 'deleteRootHint' : 'deleteHint')}</p>
              </div>
              <div className={css.editorFooter}>
                <Button variant="ghost" size="sm" onClick={resetStyle}>{t('resetStyle')}</Button>
                <Button variant="ghost" size="sm" className={css.deleteButton} aria-keyshortcuts="Delete Backspace" disabled={hostPath === undefined || rootSelected || deleting || fileWrite.kind === 'saving'} onClick={deleteSelection}>
                  {deleting ? t('deleting') : t('deleteElement')}
                </Button>
                <span className={css.footerSpace} />
                <Button variant="outline" size="sm" disabled={deleting} onClick={cancelEditor}>{t('cancel')}</Button>
                <Button variant="primary" size="sm" disabled={hostPath === undefined || deleting} onClick={saveSelection}>{t('save')}</Button>
              </div>
            </div>,
            window.document.body,
          )}

      </div>
    </div>
  )
}

/** Post one message into the frame, tolerating a frame that is not mounted yet. */
function postToFrame(frame: HTMLIFrameElement | null, message: Record<string, unknown>): void {
  frame?.contentWindow?.postMessage({ channel: CHANNEL, ...message }, '*')
}

/**
 * The outcome band under the toolbar.
 *
 * It is the only place a failure is announced, so a failed review read, a
 * failed review write, and a partially located file write never stack two
 * notices. Every failure keeps the data it acted on and offers the one recovery
 * that can help; the hint says what the state means and what happens next.
 * @param props.state - store snapshot carrying the review-write failure.
 * @param props.fileWrite - outcome of the explicit file write.
 * @param props.resolved - whether the Host resolved this file for writing.
 * @param props.retry - recovery for the visible failure, absent when none applies.
 * @param props.t - locale lookup for this preview.
 * @returns the band, or `null` when there is nothing to report.
 */
function Notice(props: {
  readonly state: DesignStoreState
  readonly fileWrite: FileWriteState
  readonly resolved: boolean
  readonly retry?: (() => void) | undefined
  readonly t: HtmlDesignBodyProps['t']
}): ReactNode {
  const { state, fileWrite, resolved, retry, t } = props
  let tone: 'error' | 'warning' | 'success'
  let text: string
  let hint: string
  if (state.error !== null) {
    tone = 'error'
    text = state.error
    hint = t('saveFailedHint')
  } else if (fileWrite.kind === 'failed') {
    tone = 'error'
    text = fileWrite.detail
    hint = t(resolved ? 'fileFailedHint' : 'loadFailedHint')
  } else if (fileWrite.kind === 'partial') {
    tone = 'warning'
    text = `${t('filePartial')}: ${fileWrite.detail}`
    hint = t('filePartialHint')
  } else if (fileWrite.kind === 'saved') {
    tone = 'success'
    text = t('fileSaved')
    hint = ''
  } else {
    return null
  }
  return (
    <p className={css.notice} data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <span className={css.noticeText}>{text}</span>
      {hint === '' ? null : <span className={css.noticeHint}>{hint}</span>}
      {retry === undefined ? null : (
        <Button variant="outline" size="sm" className={css.noticeAction} onClick={retry}>{t('retry')}</Button>
      )}
    </p>
  )
}

/** Convert a frame-reported anchor into the stored shape. */
function toAnchor(anchor: FrameAnchor): ElementCommentAnchor {
  return {
    selector: anchor.selector,
    tag: anchor.tag,
    ...anchor.id === undefined ? {} : { id: anchor.id },
    classes: anchor.classes,
    text: anchor.text,
    rect: anchor.rect,
  }
}

/** Compare editable declarations without depending on their insertion order. */
function sameDeclarations(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const leftKeys = Object.keys(left)
  return leftKeys.length === Object.keys(right).length && leftKeys.every(key => left[key] === right[key])
}

/** Ignore blank draft fields before comparing or persisting style edits. */
function cleanDeclarations(draft: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(draft)
    .map(([key, value]): [string, string] => [key, value.trim()])
    .filter(([, value]) => value.length > 0))
}

/** Remove a selector's edit from the sidecar when the user saves cleared style fields. */
function withoutEdit(document: DesignAnnotationDocument | null, selector: string, hostPath: string): DesignAnnotationDocument {
  const base = document ?? emptyFor(hostPath)
  return { ...base, edits: base.edits.filter(edit => edit.selector !== selector), updatedAt: new Date().toISOString() }
}

/** An empty review document for a resolved file. */
function emptyFor(hostPath: string): DesignAnnotationDocument {
  return { version: 1, file: hostPath, comments: [], edits: [], updatedAt: new Date().toISOString() }
}

/** Locale key for a mode's label. */
function modeLabel(mode: DesignMode, t: HtmlDesignBodyProps['t']): string {
  switch (mode) {
    case 'browse': return t('modeBrowse')
    case 'inspect': return t('modeInspect')
  }
}
