/**
 * Typert Remote contribution for the `webDesignReview` namespace.
 *
 * Mirror of the artifact `@deepseek-ai/dsh-typert-generator` emits for a Host
 * Remote owner: the browser half mounts it with `ctx.remote.$mount`, which
 * installs a `remote.webDesignReview` service exposing the review read and
 * write used by the Sidebar preview. The codecs are permissive because the Host
 * gateway re-derives its own descriptor from the service method signature and
 * validates there; the Client only needs a strict-shaped codec so `$mount`
 * accepts the contribution.
 *
 * @module @guowenzhang/dsh-web-design/typert
 */

import type {
  InvocationDescriptor,
  TypertCodec,
  TypertRemoteContribution,
  TypertSchema,
} from '@deepseek-ai/dsh-typert-protocol'

/** Wire namespace and Cordis service key of the review owner. */
export const REMOTE_NAMESPACE = 'webDesignReview'

/** Permissive strict codec: accepts any value, returns it unchanged. */
const passthrough: TypertSchema<unknown> = { parse: value => value }

/**
 * One strict codec over the passthrough schema.
 *
 * Both schema seats carry the same parse contract: a Host whose Typert registry
 * materializes generated schemas requires the `create()` factory, while an
 * older one calls `schema.parse`. The published protocol release this package
 * dev-depends on declares `schema` alone, so the literal cannot satisfy those
 * types while also carrying `create`.
 * @param typeSymbol - generated-style type symbol naming this codec.
 * @returns the strict codec handed to `ctx.remote.$mount`.
 */
function codec(typeSymbol: string): TypertCodec {
  return {
    mode: 'strict' as const,
    typeSymbol,
    schema: passthrough,
    create: () => passthrough,
  } as TypertCodec
}

/** One `direct` invocation descriptor for a namespace method. */
function descriptor(method: string): InvocationDescriptor {
  const endpoint = `${REMOTE_NAMESPACE}/${method}`
  const owner = `@guowenzhang/dsh-web-design#${endpoint}`
  return {
    id: owner,
    service: REMOTE_NAMESPACE,
    namespace: REMOTE_NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: codec(`${owner}:request`),
      },
    ],
    result: codec(`${owner}:result`),
  }
}

/** Contribution mounted by the browser half to reach the review store. */
export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: '@guowenzhang/dsh-web-design',
  descriptors: [
    descriptor('read'),
    descriptor('write'),
    descriptor('apply'),
  ],
}
