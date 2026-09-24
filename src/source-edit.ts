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
 * located element's `style` attribute, text node, or full source span is
 * replaced. Every other byte of the file is preserved.
 *
 * @module @guowenzhang/dsh-web-design/source-edit
 */

import { parse, parseFragment } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'
import type { ElementDeletion, ElementEdit } from './types.ts'

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

/** A requested source replacement and the selector that produced it. */
interface RequestedReplacement {
  readonly selectors: readonly string[]
  readonly replacement: Replacement
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

/** A selector either identifies one source element or gives a reason to skip it. */
type LocatedElement = { readonly element: Element; readonly reason?: never }
  | { readonly element?: never; readonly reason: string }

/**
 * Parse the selector grammar the preview frame emits.
 *
 * The frame builds `tag`, `tag#id`, and `tag:nth-of-type(n)` steps joined by
 * ` > `. Id anchors use plain CSS identifiers. Other selectors are reported
 * as skipped rather than guessed.
 * @param selector - the frame's selector string.
 * @returns the parsed steps, or `undefined` when the grammar does not match.
 */
export function parseSelector(selector: string): SelectorStep[] | undefined {
  const trimmed = selector.trim()
  if (trimmed.length === 0) return undefined
  const steps: SelectorStep[] = []
  for (const raw of trimmed.split(/\s*>\s*/u)) {
    const match = /^([a-z][a-z0-9-]*)(?:#([a-z_][a-z0-9_-]*))?(?::nth-of-type\((\d+)\))?$/iu.exec(raw)
    if (match === null) return undefined
    const tag = match[1]
    /* v8 ignore next -- group 1 is mandatory in the pattern, so exec guarantees it. */
    if (tag === undefined) return undefined
    if (match[2] !== undefined && match[3] !== undefined) return undefined
    const nth = match[3] === undefined ? undefined : Number(match[3])
    if (nth !== undefined && (!Number.isSafeInteger(nth) || nth < 1)) return undefined
    steps.push({
      tag: tag.toLowerCase(),
      ...match[2] === undefined ? {} : { id: match[2] },
      ...nth === undefined ? {} : { nth },
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
 * @returns the unique located element, or the reason the path cannot be trusted.
 */
function locate(root: Node, steps: readonly SelectorStep[]): LocatedElement {
  const first = steps[0]
  /* v8 ignore next -- parseSelector returns a non-empty array or undefined. */
  if (first === undefined) return { reason: 'element not found in source' }
  if (first.id !== undefined) {
    const anchors = findById(root, first.id)
    if (anchors.length !== 1) {
      return { reason: anchors.length === 0 ? 'element not found in source' : 'duplicate id in source' }
    }
    const anchored = anchors[0]
    /* v8 ignore next -- the length check guarantees this element. */
    if (anchored === undefined) return { reason: 'element not found in source' }
    if (tagOf(anchored) !== first.tag) return { reason: 'id anchor tag differs from source' }
    return steps.length === 1 ? { element: anchored } : descend(anchored, steps, 1)
  }
  // A document parse has exactly one `html` element; a fragment parse has none.
  // Entering it makes both shapes address the path the frame produced.
  const roots = childElements(root)
  const scope: Node = roots.length === 1 && tagOf(roots[0] as Element) === 'html' ? roots[0] as Element : root
  if (steps.length === 1 && first.tag === 'html' && isElement(scope)) return { element: scope }
  return descend(scope, steps, 0)
}

/**
 * Apply selector steps from an index onward.
 * @param scope - node whose element children the next step selects from.
 * @param steps - the complete parsed path.
 * @param from - index of the first step to apply.
 * @returns the unique located element, or the reason the path cannot be trusted.
 */
function descend(scope: Node, steps: readonly SelectorStep[], from: number): LocatedElement {
  let current: Node = scope
  let found: Element | undefined
  for (let index = from; index < steps.length; index += 1) {
    const step = steps[index]
    /* v8 ignore next -- the loop bounds keep every index inside the array. */
    if (step === undefined) return { reason: 'element not found in source' }
    const candidates = childElements(current).filter(child => tagOf(child) === step.tag)
    let next: Element | undefined
    if (step.id !== undefined) {
      const matches = candidates.filter(candidate => attrOf(candidate, 'id') === step.id)
      if (matches.length > 1) return { reason: 'duplicate id in source' }
      next = matches[0]
    } else if (step.nth !== undefined) {
      // `nth-of-type` counts among same-tag siblings, which is exactly the
      // candidate list after the tag filter. The frame emits it only when
      // multiple siblings exist, so one source sibling means the DOM changed.
      if (candidates.length < 2) return { reason: 'sibling count differs from preview' }
      next = candidates[step.nth - 1]
    } else {
      if (candidates.length > 1) return { reason: 'ambiguous selector in source' }
      next = candidates[0]
    }
    if (next === undefined) return { reason: 'element not found in source' }
    found = next
    current = next
  }
  return found === undefined ? { reason: 'element not found in source' } : { element: found }
}

/**
 * Find all elements with an id anywhere in the source tree. Duplicate ids are
 * not safe anchors, even when only one match has the selector's tag.
 * @param root - subtree to search.
 * @param id - the id to match.
 * @returns every matching element.
 */
function findById(root: Node, id: string): Element[] {
  const matches: Element[] = []
  const visit = (node: Node): void => {
    for (const child of childElements(node)) {
      if (attrOf(child, 'id') === id) matches.push(child)
      visit(child)
    }
  }
  visit(root)
  return matches
}

/**
 * Apply the reviewer's edits to an HTML source.
 *
 * Edits are applied as non-overlapping span replacements, so an edit that
 * rewrites one element cannot disturb another's offsets. Deleting an element
 * supersedes style, text, and nested deletion requests for that subtree.
 * A selector that does not resolve in source is reported, never silently
 * dropped, because the reviewer needs to know an edit did not reach the file.
 * @param source - the complete HTML source text.
 * @param edits - the reviewer's style edits, in application order.
 * @param textEdits - element text replacements, keyed by selector.
 * @param deletions - elements to remove, with the text and class tokens observed in the preview.
 * @returns the rewritten source plus what was applied and skipped.
 */
export function applySourceEdits(
  source: string,
  edits: readonly ElementEdit[],
  textEdits: Readonly<Record<string, string>> = {},
  deletions: readonly ElementDeletion[] = [],
): SourceEditResult {
  if (edits.length === 0 && Object.keys(textEdits).length === 0 && deletions.length === 0) {
    return { source, applied: [], skipped: [] }
  }
  // parse5 records source offsets in `sourceCodeLocation`; without them a
  // rewrite cannot address the original text.
  const document = parse(source, { sourceCodeLocationInfo: true })
  const requested: RequestedReplacement[] = []
  const skipped: { selector: string; reason: string }[] = []

  const deletionSelectors = new Set(deletions.map(deletion => deletion.selector))
  const locatedDeletions: { selector: string; element: Element; replacement: Replacement }[] = []
  for (const deletion of deletions) {
    const { selector } = deletion
    const steps = parseSelector(selector)
    if (steps === undefined) {
      skipped.push({ selector, reason: 'unsupported selector grammar' })
      continue
    }
    const located = locate(document, steps)
    if (located.element === undefined) {
      skipped.push({ selector, reason: located.reason })
      continue
    }
    const element = located.element
    if (tagOf(element) === 'html' || tagOf(element) === 'head' || tagOf(element) === 'body') {
      skipped.push({ selector, reason: 'document structure cannot be deleted' })
      continue
    }
    if (normalizedElementText(element) !== deletion.text
      || !sameClasses(element, deletion.classes)) {
      skipped.push({ selector, reason: 'element fingerprint differs from source' })
      continue
    }
    if (steps.some(step => step.nth !== undefined)
      && matchingFingerprints(document, element, deletion).length !== 1) {
      skipped.push({ selector, reason: 'element fingerprint is not unique in source' })
      continue
    }
    const replacement = deletionReplacement(source, element)
    if (replacement === undefined) {
      skipped.push({ selector, reason: 'element has no source span' })
      continue
    }
    locatedDeletions.push({ selector, element, replacement })
  }

  // An ancestor's source span includes every descendant's span. Group nested
  // requests so each selector is reported applied when that ancestor is removed.
  locatedDeletions.sort((left, right) => left.replacement.start - right.replacement.start
    || right.replacement.end - left.replacement.end)
  const deletionGroups: { element: Element; replacement: Replacement; selectors: string[] }[] = []
  for (const deletion of locatedDeletions) {
    const covering = deletionGroups.find(group => deletion.replacement.start >= group.replacement.start
      && deletion.replacement.end <= group.replacement.end)
    if (covering !== undefined) {
      covering.selectors.push(deletion.selector)
      continue
    }
    deletionGroups.push({ element: deletion.element, replacement: deletion.replacement, selectors: [deletion.selector] })
  }
  for (const { replacement, selectors } of deletionGroups) requested.push({ replacement, selectors })
  const deletedElements = new Set(deletionGroups.map(group => group.element))

  for (const edit of edits) {
    if (deletionSelectors.has(edit.selector)) continue
    const steps = parseSelector(edit.selector)
    if (steps === undefined) {
      skipped.push({ selector: edit.selector, reason: 'unsupported selector grammar' })
      continue
    }
    const located = locate(document as unknown as Node, steps)
    if (located.element === undefined) {
      skipped.push({ selector: edit.selector, reason: located.reason })
      continue
    }
    const element = located.element
    if (insideDeletedElement(element, deletedElements)) continue
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
    requested.push({ selectors: [edit.selector], replacement: styleReplacement(source, element, location, declarations) })
  }

  for (const [selector, value] of Object.entries(textEdits)) {
    if (deletionSelectors.has(selector)) continue
    const steps = parseSelector(selector)
    if (steps === undefined) {
      skipped.push({ selector, reason: 'unsupported selector grammar' })
      continue
    }
    const located = locate(document as unknown as Node, steps)
    if (located.element === undefined) {
      skipped.push({ selector, reason: located.reason })
      continue
    }
    if (insideDeletedElement(located.element, deletedElements)) continue
    const replacement = textReplacement(source, located.element, value)
    if (replacement === undefined) {
      skipped.push({ selector, reason: 'element has no editable text' })
      continue
    }
    requested.push({ selectors: [selector], replacement })
  }

  requested.sort((left, right) => left.replacement.start - right.replacement.start)
  const applied = new Set<string>()
  let out = ''
  let cursor = 0
  let previousStart = -1
  for (const { selectors, replacement } of requested) {
    // Insertions have equal start and end offsets, so cursor alone does not
    // catch duplicate edits to the same start tag.
    if (replacement.start < cursor || replacement.start === previousStart) {
      for (const selector of selectors) skipped.push({ selector, reason: 'overlapping source edits' })
      continue
    }
    out += source.slice(cursor, replacement.start) + replacement.text
    cursor = replacement.end
    previousStart = replacement.start
    for (const selector of selectors) applied.add(selector)
  }
  out += source.slice(cursor)
  return { source: out, applied: [...applied], skipped }
}

/** Remove exactly one authored element span, including its descendants. */
function deletionReplacement(source: string, element: Element): Replacement | undefined {
  const location = element.sourceCodeLocation
  if (location === undefined || location === null
    || location.startOffset < 0 || location.endOffset <= location.startOffset
    || location.endOffset > source.length) return undefined
  return { start: location.startOffset, end: location.endOffset, text: '' }
}

/** Whether the element is covered by a deletion of itself or an ancestor. */
function insideDeletedElement(element: Element, deleted: ReadonlySet<Element>): boolean {
  let current: Node | null = element
  while (current !== null) {
    if (isElement(current) && deleted.has(current)) return true
    current = 'parentNode' in current ? current.parentNode : null
  }
  return false
}

/** Browser textContent with runs of whitespace collapsed for source comparison. */
function normalizedElementText(element: Element): string {
  const parts: string[] = []
  const visit = (node: Node): void => {
    if (isText(node)) parts.push(node.value)
    else if ('childNodes' in node) for (const child of node.childNodes) visit(child)
  }
  visit(element)
  return parts.join('').replace(/\s+/gu, ' ').trim()
}

/** Compare DOM classList tokens with the authored class attribute. */
function sameClasses(element: Element, classes: readonly string[]): boolean {
  const sourceClasses = [...new Set((attrOf(element, 'class') ?? '').split(/\s+/u).filter(Boolean))]
  return sourceClasses.length === classes.length && sourceClasses.every((value, index) => value === classes[index])
}

/** Find every source element with the same fingerprint as a positional target. */
function matchingFingerprints(root: Node, target: Element, deletion: ElementDeletion): Element[] {
  const matches: Element[] = []
  const visit = (node: Node): void => {
    for (const child of childElements(node)) {
      if (tagOf(child) === tagOf(target) && normalizedElementText(child) === deletion.text
        && sameClasses(child, deletion.classes)) matches.push(child)
      visit(child)
    }
  }
  visit(root)
  return matches
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
 * A text-only element's sole text child or the only non-whitespace direct text
 * child is rewritten. Descendant elements and other direct whitespace nodes
 * keep their authored bytes. Multiple meaningful direct text nodes are
 * ambiguous and cannot be rewritten safely.
 */
function textReplacement(source: string, element: Element, value: string): Replacement | undefined {
  const children: Node[] = 'childNodes' in element ? element.childNodes : []
  const directText = children.filter(isText)
  const meaningful = directText.filter(node => node.value.trim() !== '')
  const text = meaningful.length === 1 ? meaningful[0] : children.length === 1 ? directText[0] : undefined
  if (text === undefined) return undefined
  const location = text.sourceCodeLocation
  if (location === undefined || location === null || location.startOffset < 0
    || location.endOffset <= location.startOffset || location.endOffset > source.length) return undefined
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
