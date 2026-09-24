/**
 * Web-design plugin (host) with a Sidebar HTML preview (client).
 *
 * Host: exposes the `webDesignReview` Remote the Sidebar preview reads and
 * writes. Client: `src/client` bundles an HTML document preview into a
 * `window.__ModuleLoader__` handoff artifact served at `/plugins/<id>/client.js`.
 *
 * The plugin ships no skills and writes to no directory outside the artifacts it
 * reviews: design skills are installed in the agent skills directory by whatever
 * put them there, and this plugin neither adds nor removes any.
 *
 * @module @guowenzhang/dsh-web-design
 */

import type { Context } from '@deepseek-ai/cordis'
import { WebDesignRemote } from './remote.ts'

export { TYPERT_REMOTE, REMOTE_NAMESPACE } from './typert.ts'
export { WebDesignRemote } from './remote.ts'
export {
  SIDECAR_SUFFIX,
  emptyDocument,
  readAnnotations,
  sidecarPath,
  validateWrite,
  writeAnnotations,
} from './store.ts'
export { applySourceEdits, parseSelector, parseSource } from './source-edit.ts'
export type { SourceEditResult } from './source-edit.ts'
export type * from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-design'

/** Services this plugin requires; none, so it loads in any composition. */
export const inject = []

/**
 * Register the review Remote the Sidebar preview calls.
 *
 * The Remote registers unconditionally, because a guarded registration would
 * make every client call fail with a missing namespace rather than a reportable
 * error.
 * @param ctx - plugin context; every registration is disposed with it.
 */
export function apply(ctx: Context): void {
  // The Remote owner registers itself as `ctx.webDesignReview` on construction;
  // the service registry keeps the instance alive for this fiber's lifetime.
  void new WebDesignRemote(ctx)
}
