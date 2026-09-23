/**
 * Web-design preview, browser half.
 *
 * Registers one HTML document implementation into the Sidebar's document
 * registry and its body into the keyed `sidebar.right.tab.document` seat. The
 * implementation declares `priority: 'extension'`, which outranks the core
 * builtin renderer, so opening an `.html` file selects this preview.
 *
 * The preview reads and writes review state through the `webDesignReview`
 * Remote, which this half mounts from the Host contribution. Nothing here
 * imports another feature plugin's values: the document contract arrives as
 * `import type`, and every runtime capability is either a cordis service or an
 * injected callback.
 *
 * @module @guowenzhang/dsh-web-design/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the slot registry Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the document-preview registry Context merge (ctx.documentPreviews)
// and the DocumentPreviewDefinition type.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { REMOTE_NAMESPACE, TYPERT_REMOTE } from '../typert.ts'
import type {
  DesignAnnotationDocument,
  DesignApplyRequest,
  DesignApplyResult,
  DesignComment,
  DesignFileRef,
  DesignReadRequest,
  DesignReadResult,
  DesignWriteRequest,
  DesignWriteResult,
  ElementCommentAnchor,
  ElementEdit,
} from '../types.ts'
import { HtmlDesignBody } from './HtmlDesignBody.tsx'
import type { DesignStore } from './HtmlDesignBody.tsx'
import { NS, en, zh } from './locales.ts'
import type { DesignLocaleKey } from './locales.ts'
import { createDesignStore } from './store.ts'

export { createDesignStore } from './store.ts'
export { NS } from './locales.ts'
export type { DesignStore } from './HtmlDesignBody.tsx'
export type { DesignLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This preview's copy. */
    sidebarWebDesign: DesignLocaleKey
  }
}
/** Implementation identity, shared by the registry entry and the keyed slot. */
export const HTML_DESIGN_ID = '@guowenzhang/dsh-web-design/html'

/** Required browser services: the slot registry, the document registry, copy, and the Remote. */
export const inject = ['slots', 'locale', 'documentPreviews', 'remote']

/** The namespace service this plugin mounts itself, fetched via `ctx.get`. */
interface WebDesignReviewNamespace {
  read(request: DesignReadRequest): Promise<RemoteResult<DesignReadResult>>
  write(request: DesignWriteRequest): Promise<RemoteResult<DesignWriteResult>>
  apply(request: DesignApplyRequest): Promise<RemoteResult<DesignApplyResult>>
}

/** Unwrap a Typert `RemoteResult` or surface the Host failure. */
async function unwrapRemote<T>(call: () => Promise<RemoteResult<T>>): Promise<T> {
  const result = await call()
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

/**
 * Mount the review Remote, register the dictionary, the document metadata, and
 * the preview body.
 * @param ctx - client root context carrying the registries and copy.
 * @returns once every registration is installed.
 */
export async function apply(ctx: Context): Promise<void> {
  const disposeMount = await ctx.remote.$mount(TYPERT_REMOTE)
  ctx.effect(() => () => disposeMount(), 'dsh-web-design: remote mount')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-web-design: dictionaries')
  const t = ctx.locale.bind(NS)

  const namespace = (): WebDesignReviewNamespace => {
    const mounted = ctx.get(`remote.${REMOTE_NAMESPACE}`) as WebDesignReviewNamespace | undefined
    if (mounted === undefined) throw new Error(`${REMOTE_NAMESPACE} namespace service is not mounted`)
    return mounted
  }

  ctx.effect(() => ctx.documentPreviews.register({
    id: HTML_DESIGN_ID,
    extensions: ['html', 'htm'],
    // `extension` outranks `builtin`, so this preview replaces the core static
    // HTML renderer for the files it matches.
    priority: 'extension',
    title: () => t('title'),
    loading: 'bytes-complete',
    wrap: false,
  }), 'dsh-web-design: document metadata')

  const store: DesignStore = createDesignStore('')

  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    {
      name: 'sidebar.right.tab.document',
      key: HTML_DESIGN_ID,
      locale: NS,
      store,
      inject: () => ({
        loadReview: async (file: DesignFileRef): Promise<DesignReadResult> =>
          await unwrapRemote(() => namespace().read({ file })),
        saveReview: async (file: DesignFileRef, document: DesignAnnotationDocument): Promise<void> => {
          await unwrapRemote(() => namespace().write({ file, document }))
        },
        applyToFile: async (request: DesignApplyRequest): Promise<DesignApplyResult> =>
          await unwrapRemote(() => namespace().apply(request)),
        fileRefOf,
      }),
    },
    HtmlDesignBody,
  )), 'dsh-web-design: preview body')
}

/**
 * Parse the Session address of one previewed file.
 *
 * The Host uses the Session to resolve a relative path; an absolute address
 * carries no Session and leaves this preview read-only.
 * @param address - the tab's resource address.
 * @returns the Session and path the Host receives, or `undefined`.
 */
export function fileRefOf(address: string): DesignFileRef | undefined {
  const parsed = parseFileAddress(address)
  if (parsed?.scope !== 'session') return undefined
  return { sessionId: parsed.sessionId as SessionId, path: parsed.path }
}

/** Re-exported for tests that need the address grammar without the runtime. */
export type { SessionId, DesignComment, ElementCommentAnchor, ElementEdit }
