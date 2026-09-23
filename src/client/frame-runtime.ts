/**
 * Source of the design-tools runtime injected into the preview frame.
 *
 * The injected document is sandboxed with `allow-scripts` and no
 * `allow-same-origin`, so the parent cannot reach into it. Everything the
 * design tools need therefore travels over `postMessage`: the frame reports
 * hover, selection, and geometry, and applies edits and text changes the parent
 * asks for.
 *
 * The runtime is a string rather than a module because it must be inlined into
 * the document the frame loads; it cannot import from the bundle.
 *
 * @module @guowenzhang/dsh-web-design/client/frame-runtime
 */

/** Message channel name shared with the injected runtime. */
export const CHANNEL = 'dsh-web-design'

/** A message the frame sends to the parent. */
export type FrameToParent =
  | { readonly channel: typeof CHANNEL; readonly kind: 'ready' }
  | { readonly channel: typeof CHANNEL; readonly kind: 'hover'; readonly selector: string | null; readonly tag: string | null }
  | { readonly channel: typeof CHANNEL; readonly kind: 'select'; readonly anchor: FrameAnchor }
  | { readonly channel: typeof CHANNEL; readonly kind: 'resize'; readonly height: number }

/** Element metadata the frame reports on selection. */
export interface FrameAnchor {
  /** Stable selector path from the document root. */
  readonly selector: string
  /** Element tag name, lowercased. */
  readonly tag: string
  /** Element id attribute, absent when it has none. */
  readonly id?: string
  /** Element class list. */
  readonly classes: readonly string[]
  /** Short excerpt of the element's text. */
  readonly text: string
  /** Element bounds relative to the document. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  /** Computed values the editor shows as the element's current style. */
  readonly computed: Readonly<Record<string, string>>
}

/** A message the parent sends to the frame. */
export type ParentToFrame =
  | { readonly channel: typeof CHANNEL; readonly kind: 'mode'; readonly mode: string }
  | { readonly channel: typeof CHANNEL; readonly kind: 'style'; readonly selector: string; readonly declarations: Readonly<Record<string, string>> }
  | { readonly channel: typeof CHANNEL; readonly kind: 'text'; readonly selector: string; readonly value: string }
  | { readonly channel: typeof CHANNEL; readonly kind: 'highlight'; readonly selectors: readonly string[] }
  | { readonly channel: typeof CHANNEL; readonly kind: 'reset' }

/**
 * Render the runtime script for one frame.
 *
 * The script is a plain function stringified into the document. It runs once,
 * installs capture-phase listeners so the tools win over page handlers, and
 * never exposes page globals to the parent.
 * @returns the complete `<script>` contents.
 */
export function frameRuntime(): string {
  return `(${runtime.toString()})(${JSON.stringify(CHANNEL)});`
}

/**
 * The runtime body. Kept as a named function so {@link frameRuntime} can
 * stringify it; it must stay self-contained — no imports, no closure values.
 * @param channel - message channel name expected on every message.
 */
function runtime(channel: string): void {
  // These declarations exist only inside the stringified function body; the
  // outer TypeScript compile sees a DOM-free function and must not narrow them.
  const doc = (globalThis as { document?: Document }).document
  if (doc === undefined) return

  let mode = 'browse'
  let hovered: Element | null = null
  let selected: Element | null = null
  let overlay: HTMLDivElement | null = null
  let box: HTMLDivElement | null = null
  let drag: { x: number; y: number } | null = null

  const post = (message: Record<string, unknown>): void => {
    try {
      ;(globalThis as { parent?: { postMessage(data: unknown, target: string): void } }).parent
        ?.postMessage({ channel, ...message }, '*')
    } catch {
      // A frame detached mid-message has no parent to notify.
    }
  }

  /** Build a stable selector path, preferring ids and stopping at unique anchors. */
  const selectorFor = (element: Element): string => {
    const parts: string[] = []
    let current: Element | null = element
    while (current !== null && current !== doc.documentElement) {
      const tag = current.tagName.toLowerCase()
      const id = current.getAttribute('id')
      if (id !== null && id.length > 0) {
        parts.unshift(tag + '#' + id)
        break
      }
      const parent: Element | null = current.parentElement
      if (parent === null) {
        parts.unshift(tag)
        break
      }
      const siblings = Array.from(parent.children).filter(child => child.tagName === current?.tagName)
      const index = siblings.indexOf(current) + 1
      parts.unshift(siblings.length > 1 ? tag + ':nth-of-type(' + index + ')' : tag)
      current = parent
    }
    return parts.length === 0 ? 'html' : parts.join(' > ')
  }

  const resolve = (selector: string): Element | null => {
    try {
      return doc.querySelector(selector)
    } catch {
      // A selector the page's own DOM made invalid simply resolves to nothing.
      return null
    }
  }

  const anchorFor = (element: Element): Record<string, unknown> => {
    const rect = element.getBoundingClientRect()
    const view = doc.defaultView
    const computed = view?.getComputedStyle(element)
    const style: Record<string, string> = {}
    for (const key of ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color',
      'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right',
      'margin-bottom', 'margin-left', 'border-radius', 'width', 'height'] as const) {
      const value = computed?.getPropertyValue(key)
      if (typeof value === 'string' && value.length > 0) style[key] = value
    }
    const id = element.getAttribute('id')
    return {
      selector: selectorFor(element),
      tag: element.tagName.toLowerCase(),
      ...(id === null ? {} : { id }),
      classes: Array.from(element.classList),
      text: textOf(element),
      rect: {
        x: rect.left + (view?.scrollX ?? 0),
        y: rect.top + (view?.scrollY ?? 0),
        width: rect.width,
        height: rect.height,
      },
      computed: style,
    }
  }

  /** Short text excerpt for the selected-element display. */
  const textOf = (element: Element): string => {
    const raw = (element.textContent ?? '').replace(/\\s+/g, ' ').trim()
    return raw.length > 160 ? raw.slice(0, 160) + '…' : raw
  }

  const ensureChrome = (): void => {
    if (overlay !== null && box !== null) return
    overlay = doc.createElement('div')
    overlay.setAttribute('data-dsh-design-overlay', '')
    overlay.style.cssText = 'position:absolute;z-index:2147483646;pointer-events:none;border:1px solid #4c8dff;background:rgba(76,141,255,0.12);border-radius:2px;transition:all 60ms linear;display:none'
    box = doc.createElement('div')
    box.setAttribute('data-dsh-design-box', '')
    box.style.cssText = 'position:absolute;z-index:2147483647;pointer-events:none;border:2px solid #4c8dff;box-shadow:0 0 0 1px rgba(255,255,255,0.6) inset;display:none'
    doc.body.append(overlay, box)
  }

  const place = (node: HTMLDivElement, element: Element | null): void => {
    if (element === null) {
      node.style.display = 'none'
      return
    }
    const rect = element.getBoundingClientRect()
    const view = doc.defaultView
    node.style.display = 'block'
    node.style.left = (rect.left + (view?.scrollX ?? 0)) + 'px'
    node.style.top = (rect.top + (view?.scrollY ?? 0)) + 'px'
    node.style.width = rect.width + 'px'
    node.style.height = rect.height + 'px'
  }

  const interactive = (event: Event): boolean => {
    const target = event.target
    if (!(target instanceof Element)) return false
    return target.closest('[data-dsh-design-overlay],[data-dsh-design-box]') === null
  }

  doc.addEventListener('mousemove', (event) => {
    if (mode === 'browse' || mode === 'annotate') return
    if (!interactive(event)) return
    const target = event.target
    if (!(target instanceof Element) || target === hovered) return
    hovered = target
    ensureChrome()
    place(overlay as HTMLDivElement, target)
    post({ kind: 'hover', selector: selectorFor(target), tag: target.tagName.toLowerCase() })
  }, true)

  doc.addEventListener('mouseleave', () => {
    hovered = null
    place(overlay as HTMLDivElement, null)
    post({ kind: 'hover', selector: null, tag: null })
  }, true)

  doc.addEventListener('click', (event) => {
    if (mode === 'browse') return
    if (!interactive(event)) return
    const target = event.target
    if (!(target instanceof Element)) return
    // The tools own the gesture: a page link must not navigate mid-review.
    event.preventDefault()
    event.stopPropagation()
    selected = target
    ensureChrome()
    place(box as HTMLDivElement, target)
    post({ kind: 'select', anchor: anchorFor(target) })
  }, true)

  doc.addEventListener('mousedown', (event) => {
    if (mode !== 'annotate') return
    drag = { x: event.clientX, y: event.clientY }
  }, true)

  globalThis.addEventListener('message', (event: MessageEvent) => {
    const data: unknown = event.data
    if (typeof data !== 'object' || data === null) return
    const message = data as { channel?: unknown; kind?: unknown }
    if (message.channel !== channel) return
    ensureChrome()
    switch (message.kind) {
      case 'mode':
        mode = String((data as { mode?: unknown }).mode ?? 'browse')
        if (mode === 'browse' || mode === 'annotate') {
          selected = null
          place(box as HTMLDivElement, null)
        }
        return
      case 'style': {
        const payload = data as { selector: string; declarations: Record<string, string> }
        const element = resolve(payload.selector)
        if (element instanceof HTMLElement) {
          for (const [property, value] of Object.entries(payload.declarations)) element.style.setProperty(property, value)
          place(box as HTMLDivElement, element)
        }
        return
      }
      case 'text': {
        const payload = data as { selector: string; value: string }
        const element = resolve(payload.selector)
        if (element !== null) element.textContent = payload.value
        return
      }
      case 'highlight': {
        const payload = data as { selectors: readonly string[] }
        const first = payload.selectors.map(resolve).find((element: Element | null) => element !== null) ?? null
        place(box as HTMLDivElement, first)
        return
      }
      case 'reset':
        selected = null
        hovered = null
        drag = null
        place(box as HTMLDivElement, null)
        place(overlay as HTMLDivElement, null)
        return
      default:
        return
    }
  })

  post({ kind: 'ready' })
}
