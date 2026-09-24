/**
 * Persistence for design review state.
 *
 * Review state is a sidecar file next to the previewed document, named
 * `<file>.design.json`. Keeping it beside the file means a review travels with
 * the artifact and survives a workspace move; keeping it out of the HTML means
 * the preview never rewrites the file under review.
 *
 * @module @guowenzhang/dsh-web-design/store
 */

import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { DesignAnnotationDocument, DesignComment, ElementEdit } from './types.ts'

/** Suffix appended to a previewed file's path to name its review sidecar. */
export const SIDECAR_SUFFIX = '.design.json'

/** Most comments one file may retain. */
const MAX_COMMENTS = 500

/** Longest comment body retained, in characters. */
const MAX_BODY_CHARS = 8000

/** Most element edits one file may retain. */
const MAX_EDITS = 500

/**
 * Resolve the sidecar path for one previewed file.
 * @param filePath - absolute path of the previewed HTML file.
 * @returns the absolute sidecar path.
 */
export function sidecarPath(filePath: string): string {
  return `${filePath}${SIDECAR_SUFFIX}`
}

/**
 * Read one file's review state.
 * @param filePath - absolute path of the previewed HTML file.
 * @returns the stored document, or `null` when the sidecar is absent or unreadable.
 */
export async function readAnnotations(filePath: string): Promise<DesignAnnotationDocument | null> {
  try {
    const raw = await readFile(sidecarPath(filePath), 'utf8')
    return parseDocument(JSON.parse(raw), filePath)
  } catch {
    // A missing or corrupt sidecar is the same to the caller: no review yet.
    return null
  }
}

/**
 * Replace one file's review state.
 *
 * The write is atomic: a temporary file in the same directory is renamed over
 * the target, so a preview reload never observes a half-written sidecar.
 * @param filePath - absolute path of the previewed HTML file.
 * @param document - the review state to persist.
 * @returns the sidecar path, retained comment count, and retained edit count.
 */
export async function writeAnnotations(
  filePath: string,
  document: DesignAnnotationDocument,
): Promise<{ storePath: string; comments: number; edits: number }> {
  const bounded = boundDocument(document, filePath)
  const storePath = sidecarPath(filePath)
  await writeFileAtomic(storePath, `${JSON.stringify(bounded, null, 2)}\n`, { mode: 0o600 })
  return { storePath, comments: bounded.comments.length, edits: bounded.edits.length }
}

/**
 * Validate and bound a document received from the browser half.
 *
 * The client is a separate process boundary, so its payload is untrusted here:
 * unknown fields are dropped, unbounded text is capped, and a document whose
 * own `file` disagrees with the request path is rejected rather than stored
 * under the wrong key.
 * @param path - absolute path from the request, which the document must agree with.
 * @param document - the submitted document.
 * @returns the bounded document.
 * @throws when the payload is not a review document for this path.
 */
export function validateWrite(path: string, document: unknown): DesignAnnotationDocument {
  if (typeof document !== 'object' || document === null) {
    throw new TypeError('web-design: document must be an object')
  }
  const candidate = document as Partial<DesignAnnotationDocument>
  if (candidate.file !== path) {
    throw new Error(`web-design: document.file "${String(candidate.file)}" does not match the requested path`)
  }
  if (candidate.version !== 1) {
    throw new Error(`web-design: unsupported document version ${String(candidate.version)}`)
  }
  if (!Array.isArray(candidate.comments) || !Array.isArray(candidate.edits)) {
    throw new TypeError('web-design: document.comments and document.edits must be arrays')
  }
  return boundDocument(document as DesignAnnotationDocument, path)
}

/** Parse a stored document, returning `null` for anything unusable. */
function parseDocument(value: unknown, filePath: string): DesignAnnotationDocument | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<DesignAnnotationDocument>
  if (candidate.version !== 1) return null
  if (candidate.file !== filePath) return null
  if (!Array.isArray(candidate.comments) || !Array.isArray(candidate.edits)) return null
  return boundDocument(value as DesignAnnotationDocument, filePath)
}

/** Cap a document's collections and text so a hostile payload cannot grow the sidecar without bound. */
function boundDocument(document: DesignAnnotationDocument, filePath: string): DesignAnnotationDocument {
  const now = new Date().toISOString()
  const comments = document.comments.slice(0, MAX_COMMENTS).map(comment => ({
    id: String(comment.id),
    kind: comment.kind === 'region' ? 'region' as const : 'element' as const,
    ...comment.element === undefined ? {} : { element: comment.element },
    ...comment.region === undefined ? {} : { region: comment.region },
    body: String(comment.body ?? '').slice(0, MAX_BODY_CHARS),
    severity: normalizeSeverity(comment.severity),
    resolved: comment.resolved === true,
    createdAt: typeof comment.createdAt === 'string' ? comment.createdAt : now,
  }))
  const edits = document.edits.slice(0, MAX_EDITS).map(edit => ({
    selector: String(edit.selector),
    declarations: edit.declarations ?? {},
    updatedAt: typeof edit.updatedAt === 'string' ? edit.updatedAt : now,
  }))
  return {
    version: 1,
    file: filePath,
    comments,
    edits,
    updatedAt: typeof document.updatedAt === 'string' ? document.updatedAt : now,
  }
}

/** Map an unknown severity onto the accepted set. */
function normalizeSeverity(value: DesignComment['severity']): DesignComment['severity'] {
  switch (value) {
    case 'note':
    case 'nit':
    case 'issue':
    case 'blocker':
      return value
    default:
      return 'note'
  }
}

/** An empty review document for one file. */
export function emptyDocument(filePath: string): DesignAnnotationDocument {
  return { version: 1, file: filePath, comments: [], edits: [], updatedAt: new Date().toISOString() }
}

/** Re-export of the edit type for consumers that only read the store module. */
export type { ElementEdit, DesignAnnotationDocument, DesignComment }
