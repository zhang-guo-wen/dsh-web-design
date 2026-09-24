/**
 * Types shared by the Host and browser halves of the web-design plugin.
 *
 * Only types live here; runtime code belongs in its owning module.
 *
 * @module @guowenzhang/dsh-web-design/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The submitted review document was not a review for the requested path. */
    'web-design/invalid': { readonly reason: string }
    /** The review sidecar could not be written. */
    'web-design/io': { readonly reason: string }
  }
}

/** One element the design preview attached a comment to. */
export interface ElementCommentAnchor {
  /** Stable CSS selector path from the document root, as the preview computed it. */
  readonly selector: string
  /** Element tag name, lowercased. */
  readonly tag: string
  /** Element id attribute, absent when it has none. */
  readonly id?: string
  /** Element class list, empty when it has none. */
  readonly classes: readonly string[]
  /** Short excerpt of the element's text, trimmed to one line. */
  readonly text: string
  /** Element bounds in CSS pixels relative to the document, for the pin position. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}

/** One comment a reviewer left on the preview. */
export interface DesignComment {
  /** Stable id minted by the browser half. */
  readonly id: string
  /** Whether the comment anchors to an element or to a screenshot region. */
  readonly kind: 'element' | 'region'
  /** Element anchor; present exactly when `kind` is `element`. */
  readonly element?: ElementCommentAnchor
  /** Screenshot-region anchor in the shot's own pixel space; present exactly when `kind` is `region`. */
  readonly region?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  /** Reviewer's comment text. */
  readonly body: string
  /** Severity the reviewer assigned. */
  readonly severity: 'note' | 'nit' | 'issue' | 'blocker'
  /** Whether the reviewer considered it resolved. */
  readonly resolved: boolean
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string
}

/** One inline style override the reviewer applied to an element. */
export interface ElementEdit {
  /** Selector of the element the edit targets. */
  readonly selector: string
  /** CSS declarations written as inline style, keyed by property name. */
  readonly declarations: Readonly<Record<string, string>>
  /** ISO-8601 timestamp of the last change. */
  readonly updatedAt: string
}

/** The complete persisted review state for one previewed file. */
export interface DesignAnnotationDocument {
  /** Format version, so a later reader can migrate rather than guess. */
  readonly version: 1
  /** Absolute path of the HTML file this review belongs to. */
  readonly file: string
  /** Every comment on the file, in creation order. */
  readonly comments: readonly DesignComment[]
  /** Every inline style override applied through the preview. */
  readonly edits: readonly ElementEdit[]
  /** ISO-8601 timestamp of the last write. */
  readonly updatedAt: string
}

/** A file address resolved against the named Session's workspace on the Host. */
export interface DesignFileRef {
  /** Session that owns the file preview. */
  readonly sessionId: SessionId
  /** Workspace-relative or absolute file path from the preview address. */
  readonly path: string
}

/** Request to read one file's review state. */
export interface DesignReadRequest {
  /** Session-scoped preview address, resolved by the Host. */
  readonly file: DesignFileRef
}

/** Result of reading one file's review state. */
export interface DesignReadResult {
  /** Canonical absolute path of the previewed HTML file. */
  readonly path: string
  /** The persisted document, or `null` when the file has no review yet. */
  readonly document: DesignAnnotationDocument | null
  /** Absolute path the state was read from, so the caller can show it. */
  readonly storePath: string
}

/** Request to replace one file's review state. */
export interface DesignWriteRequest {
  /** Session-scoped preview address, resolved by the Host. */
  readonly file: DesignFileRef
  /** The review state to persist. */
  readonly document: DesignAnnotationDocument
}

/** Result of writing one file's review state. */
export interface DesignWriteResult {
  /** Absolute path the state was written to. */
  readonly storePath: string
  /** Number of comments retained. */
  readonly comments: number
  /** Number of element edits retained. */
  readonly edits: number
}

/** One source element selected for deletion, with its original DOM fingerprint. */
export interface ElementDeletion {
  /** Selector of the rendered element selected for removal. */
  readonly selector: string
  /** Complete element text with whitespace collapsed, captured before edits. */
  readonly text: string
  /** Original class tokens in DOM order. */
  readonly classes: readonly string[]
}

/** Request to rewrite a previewed file from the reviewer's edits. */
export interface DesignApplyRequest {
  /** Session-scoped preview address, resolved by the Host. */
  readonly file: DesignFileRef
  /** Style edits to write into the source. */
  readonly edits: readonly ElementEdit[]
  /** Element text replacements, keyed by the frame's selector. */
  readonly textEdits: Readonly<Record<string, string>>
  /** Elements to remove from the source, including their descendants. */
  readonly deletions?: readonly ElementDeletion[]
}

/** Result of rewriting a previewed file. */
export interface DesignApplyResult {
  /** Absolute path of the rewritten file. */
  readonly path: string
  /** Selectors whose edit reached the file. */
  readonly applied: readonly string[]
  /** Selectors that could not be located, with the reason. */
  readonly skipped: readonly { readonly selector: string; readonly reason: string }[]
  /** Bytes written. */
  readonly bytes: number
  /** Whether the rewrite changed the file at all. */
  readonly changed: boolean
}
