/**
 * The Sidebar's web-design HTML preview.
 *
 * The reviewed page stays visible in the preview tab. A compact toolbar
 * switches pointer modes, the review panel opens on demand, and selecting an
 * element in edit mode opens its inputs in a dialog. Review state reaches the Host
 * through the injected `saveReview`/`loadReview` callbacks, which the plugin
 * body binds to the `webDesignReview` Remote.
 *
 * The component holds no subscriptions of its own: the store reaches it through
 * the framework's `useStore` seat, and everything else is owner or inject data.
 *
 * @module @guowenzhang/dsh-web-design/client/HtmlDesignBody
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Button, Input, Pill, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { InjectFace, PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DesignAnnotationDocument, DesignApplyRequest, DesignApplyResult, DesignComment, DesignFileRef, DesignReadResult, ElementCommentAnchor, ElementEdit } from '../types.ts'
import { buildPreviewDocument } from './document.ts'
import { CHANNEL } from './frame-runtime.ts'
import type { FrameAnchor, FrameToParent } from './frame-runtime.ts'
import { createDesignStore } from './store.ts'
import type { DesignMode } from './store.ts'
import css from './HtmlDesignBody.module.css'

/** The store handle type this preview is registered with. */
export type DesignStore = ReturnType<typeof createDesignStore>

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
}

/** Props the framework derives for the document slot. */
export type HtmlDesignBodyProps =
  DocumentPreviewProps
  & PropsLocale<'sidebarWebDesign'>
  & PropsStore<DesignStore>
  & InjectFace<HtmlDesignBodyInjected>

const MODES: readonly DesignMode[] = ['browse', 'inspect', 'comment', 'annotate']

/** Severity values the comment form offers, in escalation order. */
const SEVERITIES: readonly DesignComment['severity'][] = ['note', 'nit', 'issue', 'blocker']

/** Editable style properties, with the locale key naming each one. */
const STYLE_FIELDS: readonly {
  readonly key: string
  readonly label: 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing' | 'color' | 'background' | 'padding' | 'margin' | 'borderRadius'
}[] = [
  { key: 'font-size', label: 'fontSize' },
  { key: 'font-weight', label: 'fontWeight' },
  { key: 'line-height', label: 'lineHeight' },
  { key: 'letter-spacing', label: 'letterSpacing' },
  { key: 'color', label: 'color' },
  { key: 'background-color', label: 'background' },
  { key: 'padding', label: 'padding' },
  { key: 'margin', label: 'margin' },
  { key: 'border-radius', label: 'borderRadius' },
]

/** Placement of the editor in the visible application viewport. */
interface EditorPlacement {
  readonly side: 'left' | 'right' | 'bottom'
  readonly left: number
  readonly top: number
  readonly width: number
  readonly maxHeight: number
}

/** Keep an editing surface beside the Sidebar when space allows. */
function placeEditor(stage: HTMLElement): EditorPlacement {
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

  if (leftRoom >= minimumSideWidth || rightRoom >= minimumSideWidth) {
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

/** Mint a comment id unique across tabs and reloads. */
function commentId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `c-${Date.now().toString(36)}-${random}`
}

/**
 * Render the HTML design preview.
 * @param props - document content, framework store seat, injected host callbacks, and locale.
 * @returns the preview, or the loading and failure states.
 */
export function HtmlDesignBody(props: HtmlDesignBodyProps): ReactNode {
  const { content, resourceAddress, useStore, loadReview, saveReview, applyToFile, fileRefOf, actions, t } = props
  const state = useStore(selector => selector)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const focusReturnRef = useRef<HTMLElement | null>(null)
  const [editorPlacement, setEditorPlacement] = useState<EditorPlacement | null>(null)
  const [draftStyle, setDraftStyle] = useState<Record<string, string>>({})
  const [computed, setComputed] = useState<Record<string, string>>({})
  const [draftText, setDraftText] = useState('')
  // Text edits are held here rather than in the review store: they are a
  // source rewrite awaiting the explicit save, not review state to persist.
  const [textEdits, setTextEdits] = useState<Record<string, string>>({})
  const [fileWrite, setFileWrite] = useState<{ readonly kind: 'idle' | 'saving' | 'saved' | 'partial' | 'failed'; readonly detail: string }>({ kind: 'idle', detail: '' })
  const [frameResource, setFrameResource] = useState<{ readonly source: string; readonly url: string } | null>(null)
  const [resolvedFile, setResolvedFile] = useState<{ readonly address: string; readonly path: string } | null>(null)

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

  /** Adopt an element selection reported by the frame. */
  const selectAnchor = useCallback((anchor: FrameAnchor) => {
    actions.select(toAnchor(anchor))
    setComputed(anchor.computed)
    if (state.mode === 'inspect') {
      focusReturnRef.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : frameRef.current
      setDraftStyle(state.document?.edits.find(edit => edit.selector === anchor.selector)?.declarations ?? {})
      setDraftText(textEdits[anchor.selector] ?? anchor.text)
      if (state.panelOpen) actions.togglePanel()
      actions.setOpen(true)
    }
  }, [actions, state.mode, state.document, state.panelOpen, textEdits])

  const closeEditor = useCallback(() => {
    actions.setOpen(false)
    window.requestAnimationFrame(() => {
      const previous = focusReturnRef.current
      if (previous?.isConnected) previous.focus()
      else frameRef.current?.focus()
    })
  }, [actions])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!state.open || stage === null) {
      setEditorPlacement(null)
      return
    }
    let frame = 0
    const update = (): void => { setEditorPlacement(placeEditor(stage)) }
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
  }, [state.open])

  // Push the active mode into the frame so its listeners match the panel.
  useEffect(() => {
    postToFrame(frameRef.current, { kind: 'mode', mode: state.mode })
  }, [state.mode, source, state.reloadToken])

  useEffect(() => {
    if (!state.open) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeEditor()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [state.open, closeEditor])

  // Resolve the Session path on the Host before enabling any file writes.
  useEffect(() => {
    setResolvedFile(null)
    setTextEdits({})
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
  }, [fileRef, resourceAddress, loadReview, actions])

  // Re-apply stored edits whenever the document reloads, so a saved style
  // survives a refresh of the reviewed document.
  useEffect(() => {
    const edits = state.document?.edits ?? []
    for (const edit of edits) {
      postToFrame(frameRef.current, { kind: 'style', selector: edit.selector, declarations: edit.declarations })
    }
  }, [state.document, state.reloadToken])

  // Receive hover and selection from the frame runtime.
  useEffect(() => {
    const listener = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null) return
      const message = data as Partial<FrameToParent>
      if (message.channel !== CHANNEL) return
      switch (message.kind) {
        case 'ready':
          postToFrame(frameRef.current, { kind: 'mode', mode: state.mode })
          for (const edit of state.document?.edits ?? []) {
            postToFrame(frameRef.current, { kind: 'style', selector: edit.selector, declarations: edit.declarations })
          }
          for (const [selector, value] of Object.entries(textEdits)) {
            postToFrame(frameRef.current, { kind: 'text', selector, value })
          }
          return
        case 'hover':
          actions.setHovered(
            message.selector === null || message.selector === undefined || message.tag === null || message.tag === undefined
              ? null
              : { selector: message.selector, tag: message.tag },
          )
          return
        case 'select':
          if (message.anchor !== undefined) selectAnchor(message.anchor)
          return
        default:
          return
      }
    }
    window.addEventListener('message', listener)
    return () => { window.removeEventListener('message', listener) }
  }, [actions, selectAnchor, state.mode, state.document, textEdits])

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

  const submitComment = useCallback(() => {
    if (hostPath === undefined) return
    const body = state.draft.trim()
    if (body.length === 0) return
    const comment: DesignComment = {
      id: commentId(),
      kind: state.region === null ? 'element' : 'region',
      ...state.selected === null ? {} : { element: state.selected },
      ...state.region === null ? {} : { region: state.region },
      body,
      severity: state.draftSeverity,
      resolved: false,
      createdAt: new Date().toISOString(),
    }
    actions.addComment(comment)
    actions.setDraft('')
    actions.setRegion(null)
    void persist({ ...(state.document ?? emptyFor(hostPath)), comments: [...(state.document?.comments ?? []), comment], updatedAt: comment.createdAt })
  }, [state.draft, state.draftSeverity, state.region, state.selected, state.document, hostPath, actions, persist])

  const saveSelection = useCallback(() => {
    const selector = state.selectedSelector
    if (selector === null || hostPath === undefined) return
    const declarations = Object.fromEntries(
      Object.entries(draftStyle)
        .map(([key, value]): [string, string] => [key, value.trim()])
        .filter(([, value]) => value.length > 0),
    )
    const previous = state.document?.edits.find(edit => edit.selector === selector)
    if (!sameDeclarations(previous?.declarations ?? {}, declarations)) {
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
    if (state.selected !== null && draftText !== state.selected.text) {
      postToFrame(frameRef.current, { kind: 'text', selector, value: draftText })
      setTextEdits(current => ({ ...current, [selector]: draftText }))
    }
    closeEditor()
  }, [draftStyle, draftText, state.selectedSelector, state.selected, state.document, hostPath, actions, persist, withEdit, closeEditor])

  const resetStyle = useCallback(() => { setDraftStyle({}) }, [])

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
    if (edits.length === 0 && Object.keys(textEdits).length === 0) {
      setFileWrite({ kind: 'idle', detail: '' })
      return
    }
    setFileWrite({ kind: 'saving', detail: '' })
    void applyToFile({ file: fileRef, edits, textEdits })
      .then((result: DesignApplyResult) => {
        if (result.skipped.length > 0) {
          setFileWrite({ kind: 'partial', detail: result.skipped.map(entry => entry.selector).join(', ') })
          return
        }
        setFileWrite({ kind: 'saved', detail: String(result.bytes) })
        setTextEdits({})
      })
      .catch((error: unknown) => {
        setFileWrite({ kind: 'failed', detail: error instanceof Error ? error.message : String(error) })
      })
  }, [fileRef, hostPath, state.document, textEdits, applyToFile])

  const hasFileEdits = (state.document?.edits.length ?? 0) > 0 || Object.keys(textEdits).length > 0

  if (content.kind !== 'bytes') return null
  if (source === undefined) return <p className={css.status} role="alert">{t('failed')}</p>
  if (frameResource?.source !== source) return <p className={css.status} role="status">{t('loading')}</p>

  const document = state.document
  const comments = document?.comments ?? []
  const edits = document?.edits ?? []

  return (
    <div className={css.preview} data-html-design-surface>
      <div className={css.toolbar}>
        <div className={css.modes} role="group" aria-label={t('modes')}>
          {MODES.map(mode => (
            <Pill key={mode} active={state.mode === mode} aria-pressed={state.mode === mode} onClick={() => {
              actions.setMode(mode)
              actions.setOpen(false)
              if (mode === 'inspect' && state.panelOpen) actions.togglePanel()
              if ((mode === 'comment' || mode === 'annotate') && !state.panelOpen) actions.togglePanel()
            }}>
              {modeLabel(mode, t)}
            </Pill>
          ))}
        </div>
        <div className={css.toolbarEnd}>
          <Tag tone={state.error !== null ? 'danger' : state.dirty ? 'warning' : 'neutral'}>
            {state.saving ? t('saving') : state.error !== null ? t('saveFailed') : state.dirty ? t('unsaved') : t('saved')}
          </Tag>
          <Tooltip label={t('saveToFileHint')}>
            <Button variant="primary" size="sm" disabled={hostPath === undefined || !hasFileEdits || fileWrite.kind === 'saving'} onClick={saveToFile}>
              {fileWrite.kind === 'saving' ? t('saving') : t('saveToFile')}
            </Button>
          </Tooltip>
          <Button variant="ghost" size="sm" onClick={() => actions.requestReload()}>{t('reload')}</Button>
          <Button variant="outline" size="sm" aria-expanded={state.panelOpen} onClick={() => actions.togglePanel()}>
            {state.panelOpen ? t('hidePanel') : t('showPanel')}
          </Button>
        </div>
      </div>

      {(state.error !== null || fileWrite.kind === 'failed' || fileWrite.kind === 'partial' || fileWrite.kind === 'saved') && (
        <p className={css.notice} role={state.error !== null || fileWrite.kind === 'failed' ? 'alert' : 'status'}>
          {state.error ?? (fileWrite.kind === 'failed' ? fileWrite.detail : fileWrite.kind === 'partial' ? `${t('filePartial')}: ${fileWrite.detail}` : t('fileSaved'))}
        </p>
      )}

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
          />
        </div>

        {state.open && state.selected !== null && editorPlacement !== null && createPortal(
            <div
              className={css.editor}
              role="dialog"
              aria-label={t('editElement')}
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
                  <span className={css.elementTag}>{state.selected.tag.toUpperCase()}</span>
                  <span className={css.editorSelector}>{state.selected.selector}</span>
                </div>
                <Button variant="ghost" size="sm" aria-label={t('closeEditor')} onClick={closeEditor}>×</Button>
              </div>
              <div className={css.editorScroll}>
                <section className={css.section}>
                  <h3 className={css.sectionTitle}>{t('content')}</h3>
                  <label className={css.field}>
                    <span className={css.fieldLabel}>{t('textContent')}</span>
                    <Input autoFocus value={draftText} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraftText(event.target.value)} />
                  </label>
                </section>
                <section className={css.section}>
                  <h3 className={css.sectionTitle}>{t('styles')}</h3>
                  <div className={css.fields}>
                    {STYLE_FIELDS.map(field => (
                      <label key={field.key} className={css.field}>
                        <span className={css.fieldLabel}>{t(field.label)}</span>
                        <Input
                          value={draftStyle[field.key] ?? ''}
                          placeholder={computed[field.key] ?? ''}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            const value = event.target.value
                            setDraftStyle(current => ({ ...current, [field.key]: value }))
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </section>
                <dl className={css.meta}>
                  <dt>{t('size')}</dt>
                  <dd>{Math.round(state.selected.rect.width)} × {Math.round(state.selected.rect.height)}</dd>
                </dl>
              </div>
              <div className={css.editorFooter}>
                <Button variant="ghost" size="sm" onClick={resetStyle}>{t('resetStyle')}</Button>
                <span className={css.footerSpace} />
                <Button variant="outline" size="sm" onClick={closeEditor}>{t('cancel')}</Button>
                <Button variant="primary" size="sm" disabled={hostPath === undefined} onClick={saveSelection}>{t('save')}</Button>
              </div>
            </div>,
            window.document.body,
          )}

        {state.panelOpen && (
          <aside className={css.panel}>
            {state.mode === 'annotate' && <p className={css.hint}>{t('annotateHint')}</p>}

            <section className={css.section}>
              <h3 className={css.sectionTitle}>{t('selectedElement')}</h3>
              {state.selected === null
                ? <p className={css.muted}>{t('noSelection')}</p>
                : (
                  <dl className={css.meta}>
                    <dt>{t('selector')}</dt>
                    <dd className={css.mono}>{state.selected.selector}</dd>
                    <dt>{t('tag')}</dt>
                    <dd className={css.mono}>{state.selected.tag}</dd>
                    <dt>{t('size')}</dt>
                    <dd>{Math.round(state.selected.rect.width)} × {Math.round(state.selected.rect.height)}</dd>
                    <dt>{t('text')}</dt>
                    <dd>{state.selected.text.length > 0 ? state.selected.text : '—'}</dd>
                  </dl>
                )}
            </section>

            <section className={css.section}>
              <h3 className={css.sectionTitle}>
                {t('comments')} <span className={css.count}>{comments.length}</span>
              </h3>
              {comments.length === 0
                ? <p className={css.muted}>{t('emptyComments')}</p>
                : (
                  <ul className={css.list}>
                    {comments.map(comment => (
                      <li key={comment.id} className={clsx(css.comment, comment.resolved && css.resolved)}>
                        <div className={css.commentHead}>
                          <Tag tone={severityTone(comment.severity)}>{t(severityLabel(comment.severity))}</Tag>
                          <span className={css.mono}>{comment.element?.selector ?? comment.kind}</span>
                        </div>
                        <p className={css.commentBody}>{comment.body}</p>
                        <div className={css.commentActions}>
                          <Button variant="ghost" onClick={() => actions.toggleResolved(comment.id)}>
                            {comment.resolved ? t('unresolve') : t('resolve')}
                          </Button>
                          <Button variant="ghost" onClick={() => actions.removeComment(comment.id)}>{t('remove')}</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

              <div className={css.draft}>
                <div className={css.severities}>
                  {SEVERITIES.map(severity => (
                    <Pill
                      key={severity}
                      active={state.draftSeverity === severity}
                      onClick={() => actions.setDraftSeverity(severity)}
                    >
                      {t(severityLabel(severity))}
                    </Pill>
                  ))}
                </div>
                <Input
                  value={state.draft}
                  placeholder={t('commentPlaceholder')}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => actions.setDraft(event.target.value)}
                />
                <div className={css.actions}>
                  <Button variant="primary" disabled={hostPath === undefined} onClick={submitComment}>{t('submitComment')}</Button>
                  {state.region !== null && (
                    <Button variant="ghost" onClick={() => actions.setRegion(null)}>{t('clearRegion')}</Button>
                  )}
                </div>
              </div>
            </section>

            <section className={css.section}>
              <h3 className={css.sectionTitle}>
                {t('styles')} <span className={css.count}>{edits.length}</span>
              </h3>
              {edits.length === 0
                ? <p className={css.muted}>{t('emptyEdits')}</p>
                : (
                  <ul className={css.list}>
                    {edits.map(item => (
                      <li key={item.selector} className={css.edit}>
                        <span className={css.mono}>{item.selector}</span>
                        <Tooltip label={JSON.stringify(item.declarations)}>
                          <span className={css.count}>{Object.keys(item.declarations).length}</span>
                        </Tooltip>
                      </li>
                    ))}
                  </ul>
                )}
            </section>

          </aside>
        )}
      </div>
    </div>
  )
}

/** Post one message into the frame, tolerating a frame that is not mounted yet. */
function postToFrame(frame: HTMLIFrameElement | null, message: Record<string, unknown>): void {
  frame?.contentWindow?.postMessage({ channel: CHANNEL, ...message }, '*')
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
    case 'comment': return t('modeComment')
    case 'annotate': return t('modeAnnotate')
  }
}

/** Locale key for a severity's label. */
function severityLabel(severity: DesignComment['severity']): 'severityNote' | 'severityNit' | 'severityIssue' | 'severityBlocker' {
  switch (severity) {
    case 'note': return 'severityNote'
    case 'nit': return 'severityNit'
    case 'issue': return 'severityIssue'
    case 'blocker': return 'severityBlocker'
  }
}

/** Tag tone for a severity. */
function severityTone(severity: DesignComment['severity']): TagTone {
  switch (severity) {
    case 'note': return 'neutral'
    case 'nit': return 'info'
    case 'issue': return 'warning'
    case 'blocker': return 'danger'
  }
}
