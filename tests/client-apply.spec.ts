// tests/client-apply.spec.ts — the browser half registers what the Sidebar needs.
//
// The preview reaches the Sidebar through two registries: the document-preview
// registry that decides which implementation renders an `.html` file, and the
// keyed `sidebar.right.tab.document` seat that supplies the body. A registration
// that lands in the wrong seat, or that forgets to unwind, fails at runtime in
// the browser with no host-side signal — exactly the class of defect these cases
// catch.
//
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, HTML_DESIGN_ID, fileRefOf } from '../src/client/index.ts'
import { HtmlDesignBody } from '../src/client/HtmlDesignBody.tsx'
import { en, zh } from '../src/client/locales.ts'
import { buildPreviewDocument, withRuntime } from '../src/client/document.ts'
import { CHANNEL } from '../src/client/frame-runtime.ts'
import type { DesignAnnotationDocument, DesignApplyRequest, DesignFileRef, DesignReadRequest, DesignReadResult, DesignWriteRequest } from '../src/types.ts'

/**
 * The document-preview registry contract this plugin registers into.
 *
 * The harness's own registry class is not exported from a public entry point,
 * so this double mirrors the published contract: a duplicate implementation id
 * throws, registration returns an idempotent disposer, and `candidates` ranks
 * external implementations above builtins and then by longest matching suffix.
 * The ranking rule is the one the preview's precedence depends on.
 */
interface DocumentPreviewDefinition {
  readonly id: string
  readonly extensions: readonly string[]
  readonly priority?: 'builtin' | 'extension'
}

class DocumentPreviewRegistry {
  private readonly registered = new Map<string, DocumentPreviewDefinition>()
  private readonly order = new Map<string, number>()

  register(definition: DocumentPreviewDefinition): () => void {
    if (this.registered.has(definition.id)) {
      throw new Error(`documentPreviews: duplicate implementation "${definition.id}"`)
    }
    this.order.set(definition.id, this.order.size)
    this.registered.set(definition.id, definition)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.registered.delete(definition.id)
    }
  }

  getSnapshot(): readonly DocumentPreviewDefinition[] {
    return [...this.registered.values()]
  }

  candidates(path: string): readonly DocumentPreviewDefinition[] {
    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
    return [...this.registered.values()]
      .map((definition, index) => {
        const length = definition.extensions
          .map(extension => name.endsWith(`.${extension}`) ? extension.length : 0)
          .reduce((left, right) => Math.max(left, right), 0)
        return {
          definition,
          rank: definition.priority === 'builtin' ? 0 : 1,
          length,
          order: this.order.get(definition.id) ?? index,
        }
      })
      .filter(candidate => candidate.length > 0)
      .sort((left, right) => right.rank - left.rank || right.length - left.length || left.order - right.order)
      .map(candidate => candidate.definition)
  }
}

/** One recorded slot registration, as the plugin issued it. */
interface Registration {
  name: string
  key: string
  locale: string
  store: unknown
  inject: () => Record<string, unknown>
}

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
})

/**
 * Apply the browser half against registries this test owns.
 * @returns the pieces the assertions read.
 */
function mount() {
  const ctx = new Context()
  const registry = new DocumentPreviewRegistry()
  const dictionaries = new Map<string, unknown>()
  const registrations: Registration[] = []
  const mounted: unknown[] = []
  const remoteRequests: { read: DesignReadRequest[]; write: DesignWriteRequest[]; apply: DesignApplyRequest[] } = {
    read: [], write: [], apply: [],
  }
  ctx.provide('remote', {
    // The real `$mount` installs the namespace as a service; the double does
    // the same so the plugin's `ctx.get('remote.webDesignReview')` resolves.
    $mount: (contribution: { descriptors?: readonly unknown[] }) => {
      mounted.push(contribution)
      ctx.provide('remote.webDesignReview', {
        read: async (request: DesignReadRequest) => {
          remoteRequests.read.push(request)
          return { ok: true, value: { path: '/w/index.html', document: null, storePath: '/tmp/x.design.json' } }
        },
        write: async (request: DesignWriteRequest) => {
          remoteRequests.write.push(request)
          return { ok: true, value: { storePath: '/tmp/x.design.json', comments: 0, edits: 0 } }
        },
        apply: async (request: DesignApplyRequest) => {
          remoteRequests.apply.push(request)
          return {
          ok: true,
          value: { path: '/w/index.html', applied: [], skipped: [], bytes: 0, changed: false },
          }
        },
      })
      return () => {
        mounted.pop()
        ctx.set('remote.webDesignReview', undefined)
      }
    },
  } as never)
  ctx.provide('documentPreviews', registry)
  ctx.provide('slots', {
    inject: (_name: string, callback: () => () => void) => callback(),
    register: (options: Registration) => {
      registrations.push(options)
      return () => { registrations.splice(registrations.indexOf(options), 1) }
    },
  } as never)
  ctx.provide('locale', {
    bind: () => (key: keyof typeof en) => en[key],
    register: (name: string, value: unknown) => {
      dictionaries.set(name, value)
      return () => { dictionaries.delete(name) }
    },
  } as never)
  const fiber = ctx.plugin({ inject: ['slots', 'locale', 'documentPreviews', 'remote'], apply })
  dispose = () => { void fiber.dispose() }
  return { fiber, registry, dictionaries, registrations, mounted, remoteRequests }
}

describe('web-design preview registration', () => {
  it('claims html suffixes ahead of the builtin renderer', async () => {
    const { fiber, registry } = mount()
    await fiber.await()
    expect(registry.candidates('index.html').map(entry => entry.id)).toEqual([HTML_DESIGN_ID])
    expect(registry.candidates('INDEX.HTM').map(entry => entry.id)).toEqual([HTML_DESIGN_ID])
    const definition = registry.getSnapshot()[0]
    expect(definition).toMatchObject({
      extensions: ['html', 'htm'],
      // Outranking `builtin` is what makes this preview replace the core one.
      priority: 'extension',
      loading: 'bytes-complete',
      wrap: false,
    })
    expect(definition?.title()).toBe(en.title)
  })

  it('registers the dictionary, the Remote mount, and the keyed body, then unwinds', async () => {
    const { fiber, registry, dictionaries, registrations, mounted } = mount()
    await fiber.await()
    expect(dictionaries.get('sidebarWebDesign')).toEqual({ zh, en })
    expect(mounted).toHaveLength(1)
    expect(registrations).toHaveLength(1)
    const registration = registrations[0]
    expect(registration).toMatchObject({
      name: 'sidebar.right.tab.document',
      key: HTML_DESIGN_ID,
      locale: 'sidebarWebDesign',
    })
    expect(registration?.inject).toBeTypeOf('function')

    // Disposal must remove every contribution, or an HMR reload would double
    // the registration and throw on the duplicate implementation id.
    await fiber.dispose()
    expect(registry.getSnapshot()).toEqual([])
    expect(registrations).toEqual([])
    expect(dictionaries.size).toBe(0)
    expect(mounted).toHaveLength(0)
  })

  it('injects Host callbacks that reach the review Remote with Session file addresses', async () => {
    const { fiber, registrations, remoteRequests } = mount()
    await fiber.await()
    const injected = registrations[0]?.inject()
    expect(injected?.loadReview).toBeTypeOf('function')
    expect(injected?.saveReview).toBeTypeOf('function')
    expect(injected?.applyToFile).toBeTypeOf('function')
    const file = fileRefOf('dsh-resource://file/session/s1/w/index.html')
    expect(file).toEqual({ sessionId: 's1', path: 'w/index.html' })
    if (file === undefined) throw new Error('Session file reference did not parse')
    expect(await (injected?.loadReview as (file: DesignFileRef) => Promise<DesignReadResult>)(file)).toMatchObject({
      path: '/w/index.html', document: null,
    })
    expect(remoteRequests.read).toEqual([{ file }])

    const document: DesignAnnotationDocument = {
      version: 1, file: '/w/index.html', comments: [], edits: [], updatedAt: '2026-09-23T00:00:00.000Z',
    }
    await (injected?.saveReview as (file: DesignFileRef, document: DesignAnnotationDocument) => Promise<void>)(file, document)
    expect(remoteRequests.write).toEqual([{ file, document }])

    // Saving to the file goes through the same Remote namespace.
    const applied = await (injected?.applyToFile as (request: DesignApplyRequest) => Promise<{ path: string }>)({
      file,
      edits: [],
      textEdits: {},
    })
    expect(applied.path).toBe('/w/index.html')
    expect(remoteRequests.apply).toEqual([{ file, edits: [], textEdits: {} }])

    // An absolute address carries no Session and stays read-only.
    expect(fileRefOf('dsh-resource://file/session/s1//w/index.html')).toEqual({ sessionId: 's1', path: '/w/index.html' })
    expect(fileRefOf('dsh-resource://file/absolute/w/index.html')).toBeUndefined()
    expect(fileRefOf('not-an-address')).toBeUndefined()
    expect((injected?.fileRefOf as (address: string) => unknown)('not-an-address')).toBeUndefined()
  })

  it('starts the preview with the review panel and edit dialog closed', async () => {
    const { fiber, registrations } = mount()
    await fiber.await()
    const injected = registrations[0]?.inject() as Record<string, unknown>
    const store = registrations[0]?.store as { create(): unknown }
    expect(HtmlDesignBody).toBeTypeOf('function')

    // The component is exercised through the runtime's own rendering path in
    // the harness suites; here the contract under test is that the store the
    // plugin declares carries the initial state the panel reads.
    const instance = store.create() as {
      getSnapshot(): Record<string, unknown>
      actions: Record<string, (...args: unknown[]) => void>
    }
    const state = instance.getSnapshot()
    expect(state).toMatchObject({ mode: 'browse', panelOpen: false, dirty: false, saving: false })
    expect(state.document).toBeNull()

    // The preview is the default surface. An element selection opens the edit
    // dialog, and the review panel can be shown independently.
    expect(state.open).toBe(false)
    instance.actions.setOpen(true)
    expect(instance.getSnapshot().open).toBe(true)
    instance.actions.setOpen(false)
    expect(instance.getSnapshot().open).toBe(false)
    instance.actions.togglePanel()
    expect(instance.getSnapshot().panelOpen).toBe(true)
    expect(injected.loadReview).toBeTypeOf('function')
  })
})

describe('preview document assembly', () => {
  it('injects the design runtime and keeps the page markup', () => {
    const source = '<!doctype html><html><body><h1>Hi</h1></body></html>'
    const document = withRuntime(source)
    expect(document).toContain('<h1>Hi</h1>')
    expect(document).toContain('data-dsh-design-runtime')
    expect(document).toContain(CHANNEL)
    // The runtime goes last so the page's own DOM is complete before it installs.
    expect(document.indexOf('data-dsh-design-runtime')).toBeGreaterThan(document.indexOf('<h1>Hi</h1>'))
  })

  it('repairs a fragment with no body element', () => {
    expect(withRuntime('<p>partial')).toContain('<p>partial')
    expect(withRuntime('<p>partial')).toContain('data-dsh-design-runtime')
  })

  it('decodes bytes and refuses non-UTF-8 input', () => {
    const encoder = new TextEncoder()
    expect(buildPreviewDocument(encoder.encode('<html><body>x</body></html>'))).toContain('data-dsh-design-runtime')
    // A lone continuation byte is not valid UTF-8.
    expect(buildPreviewDocument(new Uint8Array([0xff, 0xfe, 0x80]))).toBeUndefined()
  })
})
