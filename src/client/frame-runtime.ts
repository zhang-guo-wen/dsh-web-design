/**
 * Source of the design-tools runtime injected into the preview frame.
 *
 * The injected document is sandboxed with `allow-scripts` and no
 * `allow-same-origin`, so the parent cannot reach into it. Everything the
 * design tools need therefore travels over `postMessage`: the frame reports
 * hover, selection, drag moves, and geometry, and applies edits the parent asks
 * for.
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
  | { readonly channel: typeof CHANNEL; readonly kind: 'modeApplied'; readonly mode: 'browse' | 'inspect' }
  | { readonly channel: typeof CHANNEL; readonly kind: 'hover'; readonly selector: string | null; readonly tag: string | null }
  | { readonly channel: typeof CHANNEL; readonly kind: 'select'; readonly anchor: FrameAnchor }
  | { readonly channel: typeof CHANNEL; readonly kind: 'edit'; readonly anchor: FrameAnchor }
  | { readonly channel: typeof CHANNEL; readonly kind: 'move'; readonly selector: string; readonly declarations: Readonly<Record<string, string>>; readonly restore: Readonly<Record<string, string>>; readonly anchor: FrameAnchor }
  | { readonly channel: typeof CHANNEL; readonly kind: 'removeResult'; readonly requestId: string; readonly selector: string; readonly success: boolean; readonly removedSelectors: readonly string[] }
  | { readonly channel: typeof CHANNEL; readonly kind: 'resize'; readonly height: number }

/** Element metadata the frame reports on selection. */
export interface FrameAnchor {
  /** Stable selector path from the document root. */
  readonly selector: string
  /** Selector of the immediate parent element, if one exists. */
  readonly parentSelector: string | null
  /** Element tag name, lowercased. */
  readonly tag: string
  /** Element id attribute, absent when it has none. */
  readonly id?: string
  /** Element class list. */
  readonly classes: readonly string[]
  /** Short excerpt of the element's text. */
  readonly text: string
  /** Full normalized text from the original preview document. */
  readonly sourceText: string
  /** Classes from the original preview document. */
  readonly sourceClasses: readonly string[]
  /** Exact direct text when the element has one non-blank direct text node. */
  readonly editableText: string | null
  /** Element bounds relative to the document. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  /** Computed values the editor shows as the element's current style. */
  readonly computed: Readonly<Record<string, string>>
}

/** A message the parent sends to the frame. */
export type ParentToFrame =
  | { readonly channel: typeof CHANNEL; readonly kind: 'mode'; readonly mode: string; readonly dragHandleLabel?: string }
  | { readonly channel: typeof CHANNEL; readonly kind: 'style'; readonly selector: string; readonly declarations: Readonly<Record<string, string>> }
  | { readonly channel: typeof CHANNEL; readonly kind: 'text'; readonly selector: string; readonly value: string }
  | { readonly channel: typeof CHANNEL; readonly kind: 'selectParent' }
  | { readonly channel: typeof CHANNEL; readonly kind: 'removeSelected'; readonly selector: string; readonly requestId: string }
  | { readonly channel: typeof CHANNEL; readonly kind: 'replayRemoval'; readonly selector: string; readonly requestId: string }
  | { readonly channel: typeof CHANNEL; readonly kind: 'highlight'; readonly selectors: readonly string[] }
  | { readonly channel: typeof CHANNEL; readonly kind: 'reset' }

/**
 * Render the runtime script for one frame.
 *
 * The script is a plain function stringified into the document. It runs once,
 * installs capture-phase listeners for edit gestures, and
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
  let selectedSelector: string | null = null
  const originalSelectors = new WeakMap<Element, string>()
  const originalParents = new WeakMap<Element, Element | null>()
  const originalTargets = new Map<string, Element>()
  const ambiguousSelectors = new Set<string>()
  const originalSource = new WeakMap<Element, { text: string; classes: string[] }>()
  const editableTextTargets = new WeakMap<Element, Node>()
  let selectorsFrozen = false
  let overlay: HTMLDivElement | null = null
  let box: HTMLDivElement | null = null
  let drag: {
    pointerId: number; element: HTMLElement | SVGElement; selector: string; x: number; y: number
    strategy: 'inline' | 'translate'; baseX: string; baseY: string; baseZ: string | null
    restore: Record<string, string>; priorities: Record<string, string>; declarations: Record<string, string> | null
  } | null = null
  let handle: HTMLButtonElement | null = null

  const post = (message: Record<string, unknown>): void => {
    try {
      ;(globalThis as { parent?: { postMessage(data: unknown, target: string): void } }).parent
        ?.postMessage({ channel, ...message }, '*')
    } catch (error) {
      // A frame detached mid-message has no parent to notify.
      void error
    }
  }

  /** Build a selector path that still resolves when ids repeat or need escaping. */
  const currentSelectorFor = (element: Element): string => {
    const parts: string[] = []
    let current: Element | null = element
    while (current !== null && current !== doc.documentElement) {
      const tag = current.tagName.toLowerCase()
      const id = current.getAttribute('id')
      if (id !== null && /^[a-z_][a-z0-9_-]*$/iu.test(id) && doc.querySelectorAll('#' + id).length === 1) {
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

  const selectorFor = (element: Element): string => originalSelectors.get(element) ?? currentSelectorFor(element)

  const normalizedText = (element: Element): string => (element.textContent ?? '').replace(/\s+/g, ' ').trim()

  const sourceFor = (element: Element): { text: string; classes: string[] } => {
    let source = originalSource.get(element)
    if (source === undefined) {
      source = { text: normalizedText(element), classes: Array.from(element.classList) }
      originalSource.set(element, source)
    }
    return source
  }

  for (const element of doc.querySelectorAll('*')) sourceFor(element)

  /** Freeze paths before the first removal so sibling positions keep their original meaning. */
  const freezeSelectors = (): void => {
    if (selectorsFrozen) return
    for (const element of doc.querySelectorAll('*')) {
      if (element.closest('[data-dsh-design-overlay],[data-dsh-design-box]') !== null) continue
      const selector = currentSelectorFor(element)
      originalSelectors.set(element, selector)
      originalParents.set(element, element.parentElement)
      if (ambiguousSelectors.has(selector)) continue
      try {
        const matches = doc.querySelectorAll(selector)
        if (matches.length !== 1 || matches[0] !== element || originalTargets.has(selector)) {
          originalTargets.delete(selector)
          ambiguousSelectors.add(selector)
          continue
        }
      } catch (error) {
        // Invalid page-authored ids may make a selector unfit for replay.
        void error
        ambiguousSelectors.add(selector)
        continue
      }
      originalTargets.set(selector, element)
    }
    selectorsFrozen = true
  }

  const resolve = (selector: string): Element | null => {
    if (selector === selectedSelector) return selected?.isConnected ? selected : null
    if (selectorsFrozen) {
      const element = originalTargets.get(selector)
      return element?.isConnected ? element : null
    }
    try {
      const matches = doc.querySelectorAll(selector)
      return matches.length === 1 ? matches[0] ?? null : null
    } catch (error) {
      // A selector the page's own DOM made invalid simply resolves to nothing.
      void error
      return null
    }
  }

  const anchorFor = (element: Element, selector = selectorFor(element)): Record<string, unknown> => {
    const rect = element.getBoundingClientRect()
    const view = doc.defaultView
    const computed = view?.getComputedStyle(element)
    const style: Record<string, string> = {}
    for (const key of ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color',
      'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right',
      'margin-bottom', 'margin-left', 'border-radius', 'width', 'height', 'position', 'left', 'top', 'translate'] as const) {
      const value = computed?.getPropertyValue(key)
      if (typeof value === 'string' && value.length > 0) style[key] = value
    }
    const id = element.getAttribute('id')
    const source = sourceFor(element)
    return {
      selector,
      parentSelector: element.parentElement === null ? null : selectorFor(element.parentElement),
      tag: element.tagName.toLowerCase(),
      ...(id === null ? {} : { id }),
      classes: Array.from(element.classList),
      text: textOf(element),
      sourceText: source.text,
      sourceClasses: source.classes,
      editableText: editableTextOf(element),
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
    const raw = normalizedText(element)
    return raw.length > 160 ? raw.slice(0, 160) + '…' : raw
  }

  /** Locate the only non-blank direct text node without crossing into child elements. */
  const editableTextNodeOf = (element: Element): Node | null => {
    if (/^(?:script|style|textarea|template|noscript)$/iu.test(element.tagName)) return null
    const previous = editableTextTargets.get(element)
    if (previous?.parentNode === element) return previous
    const directText = Array.from(element.childNodes).filter(child => child.nodeType === 3)
    const meaningful = directText.filter(child => (child.textContent ?? '').trim() !== '')
    const target = meaningful.length === 1 ? meaningful[0] : directText.length === 1 ? directText[0] : undefined
    if (target !== undefined) editableTextTargets.set(element, target)
    return target ?? null
  }

  const editableTextOf = (element: Element): string | null => editableTextNodeOf(element)?.textContent ?? null

  const lengthTerm = /^(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%|em|rem|vw|vh|vmin|vmax)?|calc\(.+\))$/iu

  /** Split a computed translate value without breaking spaces inside calc(). */
  const translateParts = (value: string): { x: string; y: string; z: string | null } | null => {
    if (value === '' || value === 'none') return { x: '0px', y: '0px', z: null }
    const parts: string[] = []
    let depth = 0
    let start = 0
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index]
      if (char === '(') depth += 1
      else if (char === ')') depth -= 1
      else if (depth === 0 && /\s/u.test(char ?? '')) {
        if (index > start) parts.push(value.slice(start, index))
        start = index + 1
      }
      if (depth < 0) return null
    }
    if (depth !== 0) return null
    if (start < value.length) parts.push(value.slice(start))
    if (parts.length < 1 || parts.length > 3) return null
    if (!parts.every(part => lengthTerm.test(part))) return null
    return { x: parts[0] as string, y: parts[1] ?? '0px', z: parts[2] ?? null }
  }

  /** Resolve one side of a relatively positioned inline element. */
  const positionBase = (leading: string, trailing: string): string | null => {
    if (leading !== '' && leading !== 'auto') return lengthTerm.test(leading) ? leading : null
    if (trailing !== '' && trailing !== 'auto') return lengthTerm.test(trailing) ? 'calc(0px - ' + trailing + ')' : null
    return '0px'
  }

  const offset = (base: string, delta: number): string => {
    if (delta === 0) return base
    if (base === '0px') return delta + 'px'
    return 'calc(' + base + (delta < 0 ? ' - ' : ' + ') + Math.abs(delta) + 'px)'
  }

  const restoreDragStyles = (active: NonNullable<typeof drag>): void => {
    for (const [property, value] of Object.entries(active.restore)) {
      if (value === '') active.element.style.removeProperty(property)
      else active.element.style.setProperty(property, value, active.priorities[property] ?? '')
    }
  }

  const stopDrag = (commit: boolean): void => {
    const active = drag
    if (active === null) return
    drag = null
    if (handle !== null) handle.style.cursor = 'grab'
    if (!commit || active.declarations === null) {
      restoreDragStyles(active)
      place(box as HTMLDivElement, selected?.isConnected ? selected : null)
      return
    }
    post({ kind: 'move', selector: active.selector, declarations: active.declarations, restore: active.restore, anchor: anchorFor(active.element, active.selector) })
  }

  const removable = (element: Element): boolean => element.isConnected && element.ownerDocument === doc
    && element.parentElement !== null && !/^(?:html|head|body)$/iu.test(element.tagName)
    && element.closest('[data-dsh-design-overlay],[data-dsh-design-box]') === null

  const originallyWithin = (element: Element, ancestor: Element): boolean => {
    let current: Element | null = element
    while (current !== null) {
      if (current === ancestor) return true
      current = originalParents.get(current) ?? null
    }
    return false
  }

  const removeElement = (element: Element): string[] => {
    stopDrag(false)
    const removedSelectors = new Set<string>()
    for (const [selector, original] of originalTargets) {
      if (originallyWithin(original, element)) removedSelectors.add(selector)
    }
    for (const descendant of [element, ...element.querySelectorAll('*')]) {
      const selector = originalSelectors.get(descendant)
      if (selector !== undefined) removedSelectors.add(selector)
    }
    if (selected !== null && (element === selected || element.contains(selected))) {
      selected = null
      selectedSelector = null
      if (box !== null) place(box, null)
    }
    if (hovered !== null && (element === hovered || element.contains(hovered))) {
      hovered = null
      if (overlay !== null) place(overlay, null)
      post({ kind: 'hover', selector: null, tag: null })
    }
    element.remove()
    return Array.from(removedSelectors)
  }

  const handleRemoval = (data: unknown, selectedOnly: boolean): void => {
    const payload = data as { requestId?: unknown; selector?: unknown }
    if (typeof payload.requestId !== 'string' || typeof payload.selector !== 'string') return
    let element: Element | null = null
    if (selectedOnly) {
      if (mode === 'inspect' && selected !== null && removable(selected) && selectedSelector === payload.selector) {
        freezeSelectors()
        if (originalTargets.get(payload.selector) === selected) element = selected
      }
    } else {
      freezeSelectors()
      const original = originalTargets.get(payload.selector)
      if (original !== undefined && removable(original)) element = original
    }
    const removedSelectors = element === null ? [] : removeElement(element)
    post({ kind: 'removeResult', requestId: payload.requestId, selector: payload.selector,
      success: element !== null, removedSelectors })
  }

  const ensureChrome = (): void => {
    if (overlay !== null && box !== null) return
    overlay = doc.createElement('div')
    overlay.setAttribute('data-dsh-design-overlay', '')
    overlay.style.cssText = 'position:absolute;z-index:2147483646;pointer-events:none;border:1px solid #4c8dff;background:rgba(76,141,255,0.12);border-radius:2px;transition:all 60ms linear;display:none'
    box = doc.createElement('div')
    box.setAttribute('data-dsh-design-box', '')
    box.style.cssText = 'position:absolute;z-index:2147483647;pointer-events:none;border:2px solid #4c8dff;box-shadow:0 0 0 1px rgba(255,255,255,0.6) inset;display:none'
    handle = doc.createElement('button')
    handle.type = 'button'
    handle.setAttribute('data-dsh-design-drag-handle', '')
    handle.textContent = '✥'
    handle.style.cssText = 'position:absolute;top:-32px;right:0;width:26px;height:26px;display:grid;place-items:center;padding:0;border:2px solid #4c8dff;border-radius:6px;background:#fff;color:#2459c7;font:18px/1 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);cursor:grab;pointer-events:auto;touch-action:none;user-select:none'
    handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation() })
    handle.addEventListener('pointerdown', event => {
      if (mode !== 'inspect' || drag !== null || selected === null || !selected.isConnected || !(selected instanceof HTMLElement || selected instanceof SVGElement)) return
      const element = selected
      const computed = doc.defaultView?.getComputedStyle(element)
      const strategy = element instanceof HTMLElement && computed?.display === 'inline' ? 'inline' : 'translate'
      const properties = strategy === 'inline' ? ['position', 'left', 'top'] : ['translate']
      const restore: Record<string, string> = {}
      const priorities: Record<string, string> = {}
      for (const property of properties) {
        restore[property] = element.style.getPropertyValue(property)
        priorities[property] = element.style.getPropertyPriority(property)
      }
      if (Object.values(priorities).some(priority => priority === 'important')) return
      let baseX: string
      let baseY: string
      let baseZ: string | null = null
      if (strategy === 'inline') {
        const position = computed?.getPropertyValue('position') || 'static'
        if (position !== 'static' && position !== 'relative') return
        const x = position === 'static' ? '0px' : positionBase(computed?.getPropertyValue('left') ?? '', computed?.getPropertyValue('right') ?? '')
        const y = position === 'static' ? '0px' : positionBase(computed?.getPropertyValue('top') ?? '', computed?.getPropertyValue('bottom') ?? '')
        if (x === null || y === null) return
        baseX = x
        baseY = y
      } else {
        const original = restore.translate ?? ''
        if (original !== '' && translateParts(original.trim()) === null) return
        const baseline = translateParts(computed?.getPropertyValue('translate').trim() || original)
        if (baseline === null) return
        baseX = baseline.x
        baseY = baseline.y
        baseZ = baseline.z
      }
      event.preventDefault()
      event.stopPropagation()
      drag = {
        pointerId: event.pointerId, element, selector: selectedSelector ?? selectorFor(element), x: event.clientX, y: event.clientY,
        strategy, baseX, baseY, baseZ, restore, priorities, declarations: null,
      }
      if (handle !== null) handle.style.cursor = 'grabbing'
    })
    box.append(handle)
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
    if (node === box && handle !== null) handle.style.top = rect.top < 34 ? rect.height + 6 + 'px' : '-32px'
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

  /** A transparent control covers its label; use the pointer position to distinguish text from the box. */
  const editTargetFor = (target: Element, event: MouseEvent): Element => {
    if (!(target instanceof HTMLInputElement) || !/^(?:radio|checkbox)$/iu.test(target.type)) return target
    const computed = doc.defaultView?.getComputedStyle(target)
    const opacity = Number.parseFloat(computed?.opacity ?? '')
    if (computed?.position !== 'absolute' || !Number.isFinite(opacity) || opacity > 0.01) return target
    const label = target.closest('label')
    if (label === null) return target
    const leaves = Array.from(label.querySelectorAll('*')).filter(element =>
      element.closest('label') === label && editableTextNodeOf(element) !== null && normalizedText(element) !== '')
    if (leaves.length === 0) return label
    if (event.type !== 'mousemove' && event.detail === 0 && leaves.length === 1) return leaves[0] as Element
    const hits = leaves.filter(leaf => {
      const rect = leaf.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
        && event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom
    })
    if (hits.length === 1) return hits[0] as Element
    return label
  }

  const selectTarget = (target: Element, kind: 'select' | 'edit'): void => {
    selected = target
    selectedSelector = selectorFor(target)
    ensureChrome()
    place(box as HTMLDivElement, target)
    post({ kind, anchor: anchorFor(target, selectedSelector) })
  }

  doc.addEventListener('mousemove', (event) => {
    if (mode !== 'inspect' || drag !== null) return
    if (!interactive(event)) return
    const rawTarget = event.target
    if (!(rawTarget instanceof Element)) return
    const target = editTargetFor(rawTarget, event)
    if (target === hovered) return
    hovered = target
    ensureChrome()
    place(overlay as HTMLDivElement, target)
    post({ kind: 'hover', selector: selectorFor(target), tag: target.tagName.toLowerCase() })
  }, true)

  doc.addEventListener('mouseleave', () => {
    hovered = null
    if (overlay !== null) place(overlay, null)
    post({ kind: 'hover', selector: null, tag: null })
  }, true)

  doc.addEventListener('pointerdown', (event) => {
    if (mode !== 'inspect' || !interactive(event)) return
    event.preventDefault()
    event.stopPropagation()
  }, true)

  doc.addEventListener('click', (event) => {
    if (mode !== 'inspect') return
    if (!interactive(event)) return
    const target = event.target
    if (!(target instanceof Element)) return
    // The tools own the gesture: a page link must not navigate mid-review.
    event.preventDefault()
    event.stopPropagation()
    selectTarget(editTargetFor(target, event), 'select')
  }, true)

  doc.addEventListener('dblclick', (event) => {
    if (mode !== 'inspect' || !interactive(event)) return
    const target = event.target
    if (!(target instanceof Element)) return
    event.preventDefault()
    event.stopPropagation()
    selectTarget(editTargetFor(target, event), 'edit')
  }, true)

  doc.addEventListener('pointermove', (event) => {
    const active = drag
    if (active === null || active.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (!active.element.isConnected) {
      stopDrag(false)
      return
    }
    const dx = Math.round(event.clientX - active.x)
    const dy = Math.round(event.clientY - active.y)
    if (dx === 0 && dy === 0) {
      if (active.declarations !== null) {
        restoreDragStyles(active)
        active.declarations = null
        place(box as HTMLDivElement, active.element)
      }
      return
    }
    const x = offset(active.baseX, dx)
    const y = offset(active.baseY, dy)
    const declarations = active.strategy === 'inline'
      ? { position: 'relative', left: x, top: y }
      : { translate: x + ' ' + y + (active.baseZ === null ? '' : ' ' + active.baseZ) }
    for (const [property, value] of Object.entries(declarations)) active.element.style.setProperty(property, value)
    active.declarations = declarations
    place(box as HTMLDivElement, active.element)
  }, true)

  doc.addEventListener('pointerup', event => {
    if (drag === null || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    stopDrag(true)
  }, true)

  doc.addEventListener('pointercancel', event => {
    if (drag === null || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    stopDrag(false)
  }, true)

  globalThis.addEventListener('message', (event: MessageEvent) => {
    const data: unknown = event.data
    if (typeof data !== 'object' || data === null) return
    const message = data as { channel?: unknown; kind?: unknown }
    if (message.channel !== channel) return
    ensureChrome()
    switch (message.kind) {
      case 'mode': {
        mode = (data as { mode?: unknown }).mode === 'inspect' ? 'inspect' : 'browse'
        const label = (data as { dragHandleLabel?: unknown }).dragHandleLabel
        if (typeof label === 'string' && handle !== null) {
          if (label.trim() === '') {
            handle.removeAttribute('aria-label')
            handle.removeAttribute('title')
          } else {
            handle.setAttribute('aria-label', label)
            handle.title = label
          }
        }
        if (mode === 'browse') {
          stopDrag(false)
          selected = null
          selectedSelector = null
          hovered = null
          place(box as HTMLDivElement, null)
          place(overlay as HTMLDivElement, null)
          post({ kind: 'hover', selector: null, tag: null })
        }
        post({ kind: 'modeApplied', mode })
        return
      }
      case 'style': {
        const payload = data as { selector: string; declarations: Record<string, string> }
        const element = resolve(payload.selector)
        if (element instanceof HTMLElement || element instanceof SVGElement) {
          for (const [property, value] of Object.entries(payload.declarations)) {
            if (value === '') element.style.removeProperty(property)
            else element.style.setProperty(property, value)
          }
          if (element === selected) place(box as HTMLDivElement, element)
        }
        return
      }
      case 'text': {
        const payload = data as { selector: string; value: string }
        const element = resolve(payload.selector)
        const textNode = element === null ? null : editableTextNodeOf(element)
        if (textNode !== null) textNode.textContent = payload.value
        return
      }
      case 'selectParent': {
        const parent = selected?.parentElement
        if (mode === 'inspect' && parent !== null && parent !== undefined) selectTarget(parent, 'edit')
        return
      }
      case 'removeSelected':
        handleRemoval(data, true)
        return
      case 'replayRemoval':
        handleRemoval(data, false)
        return
      case 'highlight': {
        const payload = data as { selectors: readonly string[] }
        const first = payload.selectors.map(resolve).find((element: Element | null) => element !== null) ?? null
        place(box as HTMLDivElement, first)
        return
      }
      case 'reset':
        selected = null
        selectedSelector = null
        hovered = null
        stopDrag(false)
        place(box as HTMLDivElement, null)
        place(overlay as HTMLDivElement, null)
        return
      default:
        return
    }
  })

  post({ kind: 'ready' })
}
