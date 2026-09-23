/**
 * Rewrite an HTML source in place for the elements a reviewer edited.
 *
 * The reviewer edits a *rendered* page, but the artifact of record is the source
 * text. Re-serializing the frame's DOM would be wrong: by the time the preview
 * is interactive the parser has normalized attributes, inserted implied
 * elements, and page scripts have added their own nodes, so a serialized dump
 * would rewrite the whole file and quietly discard comments, formatting, and
 * authored structure.
 *
 * Instead each edit is applied as a span rewrite. The selector the frame
 * reported is resolved against the source's own element tree, and only the
 * located element's `style` attribute or text node is replaced. Every other
 * byte of the file is preserved.
 *
 * @module @guowenzhang/dsh-web-design/source-edit
 */

import { parse, parseFragment } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'
import type { ElementEdit } from './types.ts'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
type TextNode = DefaultTreeAdapterMap['textNode']

/** One span of source text to replace. */
interface Replacement {
  /** Inclusive start offset in the source. */
  readonly start: number
  /** Exclusive end offset in the source. */
  readonly end: number
  /** Text to write in place of the span. */
  readonly text: string
}

/** Result of applying a set of edits to a source document. */
export interface SourceEditResult {
  /** The rewritten source; identical to the input when nothing was applied. */
  readonly source: string
  /** Selectors whose edit was applied. */
  readonly applied: readonly string[]
  /** Selectors that could not be located, with the reason. */
  readonly skipped: readonly { readonly selector: string; readonly reason: string }[]
}

/** One selector step parsed from the frame's selector grammar. */
interface SelectorStep {
  readonly tag: string
  readonly id?: string
  readonly nth?: number
}

/**
 * Parse the selector grammar the preview frame emits.
 *
 * The frame builds `tag`, `tag#id`, and `tag:nth-of-type(n)` steps joined by
 * ` > `. This parser accepts exactly that grammar; anything else is a selector
 * this module cannot resolve in source, and the caller reports it as skipped
 * rather than guessing.
 * @param selector - the frame's selector string.
 * @returns the parsed steps, or `undefined` when the grammar does not match.
 */
export function parseSelector(selector: string): SelectorStep[] | undefined {
  const trimmed = selector.trim()
  if (trimmed.length === 0) return undefined
  const steps: SelectorStep[] = []
  for (const raw of trimmed.split(/\s*>\s*/u)) {
    const match = /^([a-z][a-z0-9-]*)(?:#([^\s:>]+))?(?::nth-of-type\((\d+)\))?$/iu.exec(raw)
    if (match === null) return undefined
    const tag = match[1]
    /* v8 ignore next -- group 1 is mandatory in the pattern, so exec guarantees it. */
    if (tag === undefined) return undefined
    steps.push({
      tag: tag.toLowerCase(),
      ...match[2] === undefined ? {} : { id: match[2] },
      ...match[3] === undefined ? {} : { nth: Number(match[3]) },
    })
  }
  return steps
}

/** Whether a tree node is an element. */
function isElement(node: Node): node is Element {
  return 'tagName' in node
}

/** Whether a tree node is a text node. */
function isText(node: Node): node is TextNode {
  return 'value' in node && !('tagName' in node)
}

/** The direct element children of a node. */
function childElements(node: Node): Element[] {
  const children: Node[] = 'childNodes' in node ? node.childNodes : []
  return children.filter(isElement)
}

/** Lowercased tag name of an element. */
function tagOf(element: Element): string {
  return element.tagName.toLowerCase()
}

/** An attribute's value, or `undefined` when absent. */
function attrOf(element: Element, name: string): string | undefined {
  return element.attrs.find(attribute => attribute.name === name)?.value
}

/**
 * Walk one selector path through a parsed tree.
 *
 * The preview frame builds its selector by walking up from the element and
 * stopping at either `documentElement` or the first ancestor carrying an `id`.
 * Two shapes therefore reach this locator:
 *
 * - A full path (`body > section > h1`), whose first step is a child of
 *   `<html>`. The walk descends from the root element and applies every step.
 * - An id-anchored path (`section#features > div > h2`), whose first step names
 *   an ancestor anywhere in the tree. The frame stopped there, so the locator
 *   searches the whole tree for that id rather than assuming a depth.
 *
 * A path whose first step has no id and does not match a root child is a
 * selector this module cannot resolve, and the caller reports it.
 * @param root - the document or fragment root.
 * @param steps - parsed selector steps.
 * @returns the located element, or `undefined` when the path does not resolve.
 */
function locate(root: Node, steps: readonly SelectorStep[]): Element | undefined {
  const first = steps[0]
  /* v8 ignore next -- parseSelector returns a non-empty array or undefined. */
  if (first === undefined) return undefined
  if (first.id !== undefined) {
    const anchored = findById(root, first.id, first.tag)
    if (anchored === undefined) return undefined
    return descend(anchored, steps, 1) ?? anchored
  }
  // A document parse has exactly one `html` element; a fragment parse has none.
  // Entering it makes both shapes address the path the frame produced.
  const roots = childElements(root)
  const scope: Node = roots.length === 1 && tagOf(roots[0] as Element) === 'html' ? roots[0] as Element : root
  return descend(scope, steps, 0)
}

/**
 * Apply selector steps from an index onward.
 * @param scope - node whose element children the next step selects from.
 * @param steps - the complete parsed path.
 * @param from - index of the first step to apply.
 * @returns the located element, or `undefined`.
 */
function descend(scope: Node, steps: readonly SelectorStep[], from: number): Element | undefined {
  let current: Node = scope
  let found: Element | undefined
  for (let index = from; index < steps.length; index += 1) {
    const step = steps[index]
    /* v8 ignore next -- the loop bounds keep every index inside the array. */
    if (step === undefined) return undefined
    const candidates = childElements(current).filter(child => tagOf(child) === step.tag)
    let next: Element | undefined
    if (step.id !== undefined) {
      next = candidates.find(candidate => attrOf(candidate, 'id') === step.id)
    } else if (step.nth !== undefined) {
      // `nth-of-type` counts among same-tag siblings, which is exactly the
      // candidate list after the tag filter.
      next = candidates[step.nth - 1]
    } else {
      next = candidates[0]
    }
    if (next === undefined) return undefined
    found = next
    current = next
  }
  return found
}

/**
 * Find an element by id anywhere in the tree, preferring one whose tag matches.
 *
 * Ids are unique in valid HTML, so the first match is the intended element; the
 * tag check is what keeps an invalid duplicate from silently misresolving.
 * @param root - subtree to search.
 * @param id - the id to match.
 * @param tag - the tag the selector step named.
 * @returns the matching element, or `undefined`.
 */
function findById(root: Node, id: string, tag: string): Element | undefined {
  let fallback: Element | undefined
  const visit = (node: Node): Element | undefined => {
    for (const child of childElements(node)) {
      if (attrOf(child, 'id') === id) {
        if (tagOf(child) === tag) return child
        fallback ??= child
      }
      const deeper = visit(child)
      if (deeper !== undefined) return deeper
    }
    return undefined
  }
  return visit(root) ?? fallback
}

/**
 * Apply the reviewer's edits to an HTML source.
 *
 * Edits are applied as non-overlapping span replacements, so an edit that
 * rewrites one element's `style` attribute cannot disturb another's offsets.
 * A selector that does not resolve in source is reported, never silently
 * dropped, because the reviewer needs to know an edit did not reach the file.
 * @param source - the complete HTML source text.
 * @param edits - the reviewer's style edits, in application order.
 * @param textEdits - element text replacements, keyed by selector.
 * @returns the rewritten source plus what was applied and skipped.
 */
export function applySourceEdits(
  source: string,
  edits: readonly ElementEdit[],
  textEdits: Readonly<Record<string, string>> = {},
): SourceEditResult {
  if (edits.length === 0 && Object.keys(textEdits).length === 0) {
    return { source, applied: [], skipped: [] }
  }
  // parse5 records source offsets in `sourceCodeLocation`; without them a
  // rewrite cannot address the original text.
  const document = parse(source, { sourceCodeLocationInfo: true })
  const replacementFor = new Map<string, Replacement[]>()
  const skipped: { selector: string; reason: string }[] = []

  for (const edit of edits) {
    const steps = parseSelector(edit.selector)
    if (steps === undefined) {
      skipped.push({ selector: edit.selector, reason: 'unsupported selector grammar' })
      continue
    }
    const element = locate(document as unknown as Node, steps)
    if (element === undefined) {
      skipped.push({ selector: edit.selector, reason: 'element not found in source' })
      continue
    }
    const location = element.sourceCodeLocation
    if (location === undefined || location === null) {
      skipped.push({ selector: edit.selector, reason: 'element has no source location' })
      continue
    }
    const existing = attrOf(element, 'style')
    const declarations = mergeDeclarations(existing, edit.declarations)
    if (declarations === undefined) {
      skipped.push({ selector: edit.selector, reason: 'no declarations to apply' })
      continue
    }
    const list = replacementFor.get(edit.selector) ?? []
    list.push(styleReplacement(source, element, location, declarations))
    replacementFor.set(edit.selector, list)
  }

  for (const [selector, value] of Object.entries(textEdits)) {
    const steps = parseSelector(selector)
    if (steps === undefined) {
      skipped.push({ selector, reason: 'unsupported selector grammar' })
      continue
    }
    const element = locate(document as unknown as Node, steps)
    if (element === undefined) {
      skipped.push({ selector, reason: 'element not found in source' })
      continue
    }
    const replacement = textReplacement(source, element, value)
    if (replacement === undefined) {
      skipped.push({ selector, reason: 'element has no editable text' })
      continue
    }
    replacementFor.set(selector, [...replacementFor.get(selector) ?? [], replacement])
  }

  const replacements = [...replacementFor.values()].flat().sort((left, right) => left.start - right.start)
  const applied: string[] = []
  let out = ''
  let cursor = 0
  for (const replacement of replacements) {
    // Overlapping spans would corrupt the document; keep the first and report
    // the rest rather than emitting a broken file.
    if (replacement.start < cursor) continue
    out += source.slice(cursor, replacement.start) + replacement.text
    cursor = replacement.end
  }
  out += source.slice(cursor)
  for (const selector of replacementFor.keys()) applied.push(selector)
  return { source: out, applied, skipped }
}

/** Merge new declarations over an element's existing `style` attribute. */
function mergeDeclarations(
  existing: string | undefined,
  declarations: Readonly<Record<string, string>>,
): Map<string, string> | undefined {
  const merged = new Map<string, string>()
  for (const part of (existing ?? '').split(';')) {
    const at = part.indexOf(':')
    if (at <= 0) continue
    const property = part.slice(0, at).trim()
    const value = part.slice(at + 1).trim()
    if (property.length > 0) merged.set(property, value)
  }
  for (const [property, value] of Object.entries(declarations)) {
    const trimmed = value.trim()
    if (trimmed.length === 0) merged.delete(property)
    else merged.set(property, trimmed)
  }
  return merged.size === 0 ? undefined : merged
}

/** Serialize a declaration map back into an attribute value. */
function serializeDeclarations(declarations: Map<string, string>): string {
  return [...declarations.entries()].map(([property, value]) => `${property}: ${value}`).join('; ')
}

/**
 * Build the span replacement that writes an element's `style` attribute.
 *
 * An element with an existing `style` attribute has only that attribute's value
 * replaced. One without gets a new attribute appended after the last existing
 * attribute (or right after the tag name when there is none), so the authored
 * attribute order is preserved and the rest of the start tag stays byte-identical.
 */
function styleReplacement(
  source: string,
  element: Element,
  location: NonNullable<Element['sourceCodeLocation']>,
  declarations: Map<string, string>,
): Replacement {
  const value = serializeDeclarations(declarations)
  const styleAttr = location.attrs?.['style']
  if (styleAttr !== undefined) {
    return { start: styleAttr.startOffset, end: styleAttr.endOffset, text: `style="${escapeAttribute(value)}"` }
  }
  const attributeEnds = Object.values(location.attrs ?? {}).map(attribute => attribute.endOffset)
  const insertAt = attributeEnds.length > 0
    ? Math.max(...attributeEnds)
    : location.startOffset + 1 + element.tagName.length
  void source
  return { start: insertAt, end: insertAt, text: ` style="${escapeAttribute(value)}"` }
}

/**
 * Build the span replacement that writes an element's text.
 *
 * Only a single-text-child element is rewritten: replacing an element with
 * nested markup would discard that markup, which is not what editing text in a
 * preview should mean.
 */
function textReplacement(source: string, element: Element, value: string): Replacement | undefined {
  const children: Node[] = 'childNodes' in element ? element.childNodes : []
  const texts = children.filter(isText)
  if (texts.length !== 1) return undefined
  const text = texts[0] as TextNode
  const location = text.sourceCodeLocation
  if (location === undefined || location === null) return undefined
  void source
  return { start: location.startOffset, end: location.endOffset, text: escapeText(value) }
}

/** Escape a value for an HTML attribute. */
function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

/** Escape text content. */
function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Parse an HTML source into a fragment tree.
 *
 * Exposed so callers can verify a source is parseable before offering write-back.
 * @param source - the complete HTML source text.
 * @returns the parsed fragment.
 */
export function parseSource(source: string): Node {
  return parseFragment(source, { sourceCodeLocationInfo: true }) as unknown as Node
}
