/**
 * Host owner of the `webDesignReview` Remote namespace.
 *
 * The Sidebar HTML preview runs in the browser, but review state must outlive a
 * page load and stay readable by the agent that owns the artifact. The Remote
 * is the only write path: the generated `workspaceFiles` namespace the Client
 * already has is read-only, so the preview cannot persist edits without
 * this service.
 *
 * The service registers unconditionally. A guarded registration would make
 * every client call fail with a missing namespace instead of a reportable
 * error.
 *
 * @module @guowenzhang/dsh-web-design/remote
 */

import { readFile, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { applySourceEdits } from './source-edit.ts'
import { readAnnotations, sidecarPath, validateWrite, writeAnnotations } from './store.ts'
import type {
  DesignApplyRequest,
  DesignApplyResult,
  DesignFileRef,
  DesignReadRequest,
  DesignReadResult,
  DesignWriteRequest,
  DesignWriteResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `webDesignReview` Remote namespace. */
    webDesignReview: WebDesignRemote
  }
}

/**
 * Host service behind the `webDesignReview` Remote namespace.
 *
 * The browser sends a Session id and the path from its file resource address.
 * Each operation resolves that path against the Session's workspace, then
 * confines the target before reading or writing the file and its sidecar.
 */
export class WebDesignRemote extends TypertRemoteService {
  /**
   * @param ctx - host context.
   */
  constructor(ctx: Context) {
    super(ctx, 'webDesignReview')
  }

  /**
   * Read the review state stored beside one previewed file.
   * @param request - the previewed file's Session address. The parameter must keep
   *   this name: the gateway derives its descriptor from the method signature
   *   and rejects a payload whose field does not match.
   * @returns the stored document, or `null` when the file has no review yet.
   * @throws a typed error when the Session or file address cannot be resolved.
   */
  @Remote('read')
  async read(request: DesignReadRequest): Promise<DesignReadResult> {
    const path = await this.resolveFile(request?.file, 'read')
    const document = await readAnnotations(path)
    return { path, document, storePath: sidecarPath(path) }
  }

  /**
   * Replace the review state stored beside one previewed file.
   * @param request - the previewed file's Session address and the document to store.
   * @returns the sidecar path and the retained comment and edit counts.
   * @throws a typed error when the payload is not a review document for that path.
   */
  @Remote('write')
  async write(request: DesignWriteRequest): Promise<DesignWriteResult> {
    const path = await this.resolveFile(request?.file, 'write')
    let document
    try {
      document = validateWrite(path, request?.document)
    } catch (cause) {
      throw new RemoteError('web-design/invalid', 'the submitted review document was rejected', {
        reason: cause instanceof Error ? cause.message : String(cause),
      })
    }
    try {
      return await writeAnnotations(path, document)
    } catch (cause) {
      throw new RemoteError('web-design/io', `writing the review for ${path} failed`, {
        reason: cause instanceof Error ? cause.message : String(cause),
      }, { cause })
    }
  }

  /**
   * Rewrite one previewed file from the reviewer's edits.
   *
   * Each edit is applied as a span rewrite against the file's own source text,
   * so the rewrite touches only the located elements' `style` attributes,
   * text nodes, and spans selected for deletion. Nothing else in the file
   * changes. Edits that cannot be located are reported rather than dropped.
   *
   * The write is atomic: a temporary file beside the target is renamed over it,
   * so a reader never observes a half-written document.
   * @param request - the previewed file's Session address, its style edits, and
   *   its element text replacements and deletions.
   * @returns the path, what was applied and skipped, and the written size.
   * @throws a typed error when the request is unusable or the write fails.
   */
  @Remote('apply')
  async apply(request: DesignApplyRequest): Promise<DesignApplyResult> {
    const path = await this.resolveFile(request?.file, 'apply')
    if (!Array.isArray(request?.edits)) {
      throw new RemoteError('web-design/invalid', 'apply requires an `edits` array', {
        reason: `edits was ${typeof request?.edits}`,
      })
    }
    const textEdits = request.textEdits ?? {}
    if (typeof textEdits !== 'object' || textEdits === null || Array.isArray(textEdits)) {
      throw new RemoteError('web-design/invalid', 'apply requires `textEdits` to be an object', {
        reason: `textEdits was ${typeof textEdits}`,
      })
    }
    const deletions = request.deletions ?? []
    if (!Array.isArray(deletions) || deletions.some(deletion => typeof deletion !== 'object' || deletion === null
      || typeof deletion.selector !== 'string' || typeof deletion.text !== 'string'
      || !Array.isArray(deletion.classes) || deletion.classes.some((token: unknown) => typeof token !== 'string'))) {
      throw new RemoteError('web-design/invalid', 'apply requires fingerprinted `deletions`', {
        reason: 'each deletion needs selector, normalized text, and class tokens',
      })
    }
    let original: string
    try {
      original = await readFile(path, 'utf8')
    } catch (cause) {
      throw new RemoteError('web-design/io', `reading ${path} failed`, {
        reason: cause instanceof Error ? cause.message : String(cause),
      }, { cause })
    }
    const result = applySourceEdits(original, request.edits, textEdits, deletions)
    const changed = result.source !== original
    if (changed) {
      try {
        const mode = (await stat(path)).mode & 0o777
        await writeFileAtomic(path, result.source, { mode })
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause)
        throw new RemoteError('web-design/io', `writing ${path} failed: ${reason}`, {
          reason,
        }, { cause })
      }
    }
    return {
      path,
      applied: result.applied,
      skipped: result.skipped,
      bytes: Buffer.byteLength(result.source, 'utf8'),
      changed,
    }
  }

  /** Resolve one browser-supplied file address through its Session workspace. */
  private async resolveFile(value: unknown, method: string): Promise<string> {
    if (typeof value !== 'object' || value === null) {
      throw invalidFile(method, 'file must carry a sessionId and path')
    }
    const file = value as Partial<DesignFileRef>
    if (typeof file.sessionId !== 'string' || file.sessionId.length === 0) {
      throw invalidFile(method, 'sessionId must be a non-empty string')
    }
    if (typeof file.path !== 'string' || file.path.trim().length === 0 || file.path.includes('\0')) {
      throw invalidFile(method, 'path must be a non-empty string without NUL bytes')
    }
    const sessionId = SessionId(file.sessionId)
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw invalidFile(method, 'Session service is unavailable')
    const live = sessions.get(sessionId)?.header
    const stored = live === undefined ? await this.ctx.get('sessionPersistence')?.stat(sessionId) : undefined
    const header = live ?? stored?.header
    if (header === undefined) throw invalidFile(method, `Session ${sessionId} does not exist`)
    const workspaceRoot = header.cwd ?? this.ctx.get('sandboxPolicy')?.workspaceRoot
    if (workspaceRoot === undefined) throw invalidFile(method, `Session ${sessionId} has no workspace root`)
    const fs = this.ctx.get('fs')
    if (fs === undefined) throw invalidFile(method, 'filesystem service is unavailable')
    const root = await fs.resolve(workspaceRoot)
    const target = await fs.resolve(file.path, { cwd: workspaceRoot })
    if (!fs.contains(root, target)) throw invalidFile(method, `path "${file.path}" is outside the Session workspace`)
    const info = await fs.stat(target)
    if (info?.type !== 'file') throw invalidFile(method, `path "${file.path}" is not a regular file`)
    const path = fs.processPath(target)
    if (!isAbsolute(path)) throw invalidFile(method, 'filesystem did not return an absolute host path')
    return path
  }
}

/** A malformed file address fails before any host filesystem call. */
function invalidFile(method: string, reason: string): RemoteError {
  return new RemoteError('web-design/invalid', `${method} cannot resolve the previewed file: ${reason}`, { reason })
}
