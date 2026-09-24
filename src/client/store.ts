/**
 * Client-side review state for one previewed document.
 *
 * The store holds what the preview renders: the selected element, the review
 * document loaded from the Host, and whether the document has unsaved changes.
 * It is a snapshot store so the render path
 * subscribes instead of mirroring, and it is created per registration so two
 * previewed files never share state.
 *
 * @module @guowenzhang/dsh-web-design/client/store
 */

import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { DesignAnnotationDocument, ElementCommentAnchor, ElementEdit } from '../types.ts'

/** Which pointer behavior the preview is in. */
export type DesignMode = 'browse' | 'inspect'

/** What the preview shows about the element under the pointer. */
export interface HoveredElement {
  /** Selector of the hovered element. */
  readonly selector: string
  /** Element tag name. */
  readonly tag: string
}

/**
 * Declared store state.
 *
 * Fields are mutable because the store's action contract is a draft mutator:
 * the engine hands each action the state object to write in place.
 */
export interface DesignStoreState {
  /** Active pointer mode. */
  mode: DesignMode
  /** Selector of the selected element, or `null`. */
  selectedSelector: string | null
  /** Metadata for the selected element, or `null`. */
  selected: ElementCommentAnchor | null
  /** Element currently under the pointer, or `null`. */
  hovered: HoveredElement | null
  /** Complete review document loaded for this file. */
  document: DesignAnnotationDocument | null
  /** Whether the loaded document is on the Host. */
  loading: boolean
  /** Whether local changes are not yet written. */
  dirty: boolean
  /** Whether a save is in flight. */
  saving: boolean
  /** Last save failure message, or `null`. */
  error: string | null
  /** Whether the selected element's edit dialog is showing. */
  open: boolean
  /** Bumped to ask the frame to reload its document. */
  reloadToken: number
}

/**
 * Store actions the preview may perform.
 *
 * Each action is a draft mutator, per the store contract: the framework bakes
 * the draft parameter away before the component sees it.
 */
interface DesignStoreActions {
  /* oxlint-disable-next-line typescript/no-explicit-any --
   * any[] (not unknown[] or never[]) matches the store's own ActionsDecl
   * constraint: each action carries its own parameter list, and any narrower
   * element type would reject every concrete signature. */
  [key: string]: (draft: DesignStoreState, ...params: any[]) => void
  /** Switch pointer mode, closing the editor when returning to preview. */
  setMode: (draft: DesignStoreState, mode: DesignMode) => void
  /** Record the element under the pointer. */
  setHovered: (draft: DesignStoreState, hovered: HoveredElement | null) => void
  /** Select an element and its metadata. */
  select: (draft: DesignStoreState, anchor: ElementCommentAnchor | null) => void
  /** Replace the loaded review document. */
  load: (draft: DesignStoreState, document: DesignAnnotationDocument | null) => void
  /** Record an inline style override, replacing the same selector's previous one. */
  upsertEdit: (draft: DesignStoreState, edit: ElementEdit) => void
  /** Remove an inline style override. */
  removeEdit: (draft: DesignStoreState, selector: string) => void
  /** Remove inline style overrides for deleted elements and descendants. */
  removeEdits: (draft: DesignStoreState, selectors: readonly string[]) => void
  /** Clear every edit. */
  clearEdits: (draft: DesignStoreState) => void
  /** Mark a load as started. */
  beginLoad: (draft: DesignStoreState) => void
  /** Mark a load as finished. */
  endLoad: (draft: DesignStoreState) => void
  /** Mark a save as started. */
  beginSave: (draft: DesignStoreState) => void
  /** Mark a save as succeeded and adopt the stored document. */
  endSave: (draft: DesignStoreState, document: DesignAnnotationDocument) => void
  /** Mark a save as failed. */
  failSave: (draft: DesignStoreState, message: string) => void
  /** Show or hide the selected element's edit dialog. */
  setOpen: (draft: DesignStoreState, open: boolean) => void
  /** Ask the frame to reload its document. */
  requestReload: (draft: DesignStoreState) => void
}

/**
 * Create the store for one previewed document.
 * @param file - absolute path of the previewed file, recorded in new documents.
 * @returns the store handle the component reads through `useStore`.
 */
export function createDesignStore(file: string): EngineStoreHandle<DesignStoreState, DesignStoreActions> {
  return defineStore({
    init: (): DesignStoreState => ({
      mode: 'browse',
      selectedSelector: null,
      selected: null,
      hovered: null,
      document: null,
      loading: true,
      dirty: false,
      saving: false,
      error: null,
      open: false,
      reloadToken: 0,
    }),
    actions: {
      setMode: (state, mode) => {
        state.mode = mode
        if (mode !== 'inspect') state.open = false
      },
      setHovered: (state, hovered) => { state.hovered = hovered },
      select: (state, anchor) => {
        state.selected = anchor
        state.selectedSelector = anchor?.selector ?? null
      },
      load: (state, document) => {
        state.document = document
        state.dirty = false
        state.error = null
      },
      upsertEdit: (state, edit) => {
        const current = state.document ?? emptyDocument(file)
        const others = current.edits.filter(existing => existing.selector !== edit.selector)
        state.document = { ...current, edits: [...others, edit], updatedAt: edit.updatedAt }
        state.dirty = true
      },
      removeEdit: (state, selector) => {
        const current = state.document
        if (current === null) return
        state.document = {
          ...current,
          edits: current.edits.filter(edit => edit.selector !== selector),
          updatedAt: new Date().toISOString(),
        }
        state.dirty = true
      },
      removeEdits: (state, selectors) => {
        const current = state.document
        if (current === null) return
        const removed = new Set(selectors)
        const edits = current.edits.filter(edit => !removed.has(edit.selector))
        if (edits.length === current.edits.length) return
        state.document = { ...current, edits, updatedAt: new Date().toISOString() }
        state.dirty = true
      },
      clearEdits: (state) => {
        const current = state.document
        if (current === null) return
        state.document = { ...current, edits: [], updatedAt: new Date().toISOString() }
        state.dirty = true
      },
      beginLoad: (state) => { state.loading = true },
      endLoad: (state) => { state.loading = false },
      beginSave: (state) => {
        state.saving = true
        state.error = null
      },
      endSave: (state, document) => {
        state.saving = false
        state.document = document
        state.dirty = false
        state.error = null
      },
      failSave: (state, message) => {
        state.saving = false
        state.error = message
      },
      setOpen: (state, open) => { state.open = open },
      requestReload: (state) => { state.reloadToken += 1 },
    },
  })
}

/** An empty review document, kept local so the store never imports the Host half. */
function emptyDocument(file: string): DesignAnnotationDocument {
  return { version: 1, file, comments: [], edits: [], updatedAt: new Date().toISOString() }
}
