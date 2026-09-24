import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { CHANNEL, frameRuntime } from '../src/client/frame-runtime.ts'
import type { FrameAnchor } from '../src/client/frame-runtime.ts'

const openFrames: JSDOM[] = []

function frame(markup: string) {
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, {
    runScripts: 'outside-only', url: 'https://example.test/preview',
  })
  openFrames.push(dom)
  const post = vi.spyOn(dom.window, 'postMessage')
  dom.window.eval(frameRuntime())
  const send = (message: Record<string, unknown>) => {
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { channel: CHANNEL, ...message } }))
  }
  const reported = (kind: string): Record<string, unknown>[] => post.mock.calls
    .map(([message]) => message)
    .filter((message): message is Record<string, unknown> => typeof message === 'object' && message !== null && 'kind' in message && message.kind === kind)
  return { dom, post, send, reported }
}

function pointer(dom: JSDOM, type: string, x: number, y: number) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

afterEach(() => {
  for (const dom of openFrames.splice(0)) dom.window.close()
  vi.restoreAllMocks()
})

describe('injected design frame', () => {
  it('lets preview clicks, links, and form submits reach the page', () => {
    const { dom, reported } = frame('<a id="link" href="#destination">Jump</a><form><button id="submit" type="submit">Send</button></form>')
    let linkClicks = 0
    let formSubmits = 0
    const link = dom.window.document.querySelector('#link') as HTMLAnchorElement
    const form = dom.window.document.querySelector('form') as HTMLFormElement
    link.addEventListener('click', () => { linkClicks += 1 })
    form.addEventListener('submit', event => { formSubmits += 1; event.preventDefault() })

    const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    const button = dom.window.document.querySelector('#submit') as HTMLButtonElement
    button.click()

    expect(click.defaultPrevented).toBe(false)
    expect(linkClicks).toBe(1)
    expect(formSubmits).toBe(1)
    expect(reported('select')).toEqual([])
  })

  it('acknowledges each mode only after its click behavior is active', () => {
    const { dom, send, reported } = frame('<button id="action" type="button">Action</button>')
    const action = dom.window.document.querySelector('#action') as HTMLButtonElement
    let pageClicks = 0
    action.addEventListener('click', () => { pageClicks += 1 })

    send({ kind: 'mode', mode: 'inspect' })
    expect(reported('modeApplied')).toMatchObject([{ kind: 'modeApplied', mode: 'inspect' }])
    action.click()
    expect(pageClicks).toBe(0)
    expect(reported('select')).toHaveLength(1)

    send({ kind: 'mode', mode: 'browse' })
    expect(reported('modeApplied')).toMatchObject([
      { kind: 'modeApplied', mode: 'inspect' },
      { kind: 'modeApplied', mode: 'browse' },
    ])
    action.click()
    expect(pageClicks).toBe(1)
    expect(reported('select')).toHaveLength(1)
  })

  it('selects login switch text through its transparent radio and opens the editor on double click', () => {
    const { dom, send, reported } = frame(`<style>
      .seg-item { position: relative; display: flex }
      .seg-item input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0 }
    </style><div id="seg" role="radiogroup">
      <label class="seg-item"><input type="radio" name="acct" value="email" checked><span>邮箱</span></label>
      <label class="seg-item"><input type="radio" name="acct" value="phone"><span>手机号</span></label>
    </div>`)
    send({ kind: 'mode', mode: 'inspect' })
    const email = dom.window.document.querySelector('input[value="email"]') as HTMLInputElement
    const phone = dom.window.document.querySelector('input[value="phone"]') as HTMLInputElement
    const phoneText = phone.nextElementSibling as HTMLSpanElement
    vi.spyOn(phoneText, 'getBoundingClientRect').mockReturnValue(new dom.window.DOMRect(5, 5, 42, 20))
    let pageClicks = 0
    let pageDoubleClicks = 0
    let pageChanges = 0
    phone.addEventListener('click', () => { pageClicks += 1 })
    phone.addEventListener('dblclick', () => { pageDoubleClicks += 1 })
    phone.addEventListener('change', () => { pageChanges += 1 })

    phone.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 20, clientY: 15 }))
    expect(reported('hover').at(-1)).toMatchObject({ selector: 'div#seg > label:nth-of-type(2) > span', tag: 'span' })
    const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 20, clientY: 15 })
    phone.dispatchEvent(click)
    const anchor = reported('select').at(-1)?.anchor as FrameAnchor
    expect(anchor).toMatchObject({ selector: 'div#seg > label:nth-of-type(2) > span', editableText: '手机号' })
    expect(click.defaultPrevented).toBe(true)
    expect(pageClicks).toBe(0)
    expect(pageChanges).toBe(0)
    expect(reported('edit')).toEqual([])

    phone.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 2, clientX: 20, clientY: 15 }))
    const doubleClick = new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2, clientX: 20, clientY: 15 })
    phone.dispatchEvent(doubleClick)
    expect(reported('edit').at(-1)?.anchor).toMatchObject({ selector: anchor.selector, editableText: '手机号' })
    expect(doubleClick.defaultPrevented).toBe(true)
    expect(pageClicks).toBe(0)
    expect(pageDoubleClicks).toBe(0)
    expect(pageChanges).toBe(0)

    // JSDOM keeps a radio's pre-activation checked state after a canceled synthetic click.
    email.checked = true
    send({ kind: 'mode', mode: 'browse' })
    phone.click()
    expect(pageClicks).toBe(1)
    expect(pageChanges).toBe(1)
    expect(phone.checked).toBe(true)
    expect(reported('edit')).toHaveLength(1)
  })

  it('selects switch text, its option box, and the containing group separately', () => {
    const { dom, send, reported } = frame(`<style>
      .seg-item { position: relative; display: flex }
      .seg-item input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0 }
    </style><div id="seg"><label class="seg-item"><input type="radio" name="acct"><span>手机号</span></label></div>`)
    send({ kind: 'mode', mode: 'inspect' })
    const input = dom.window.document.querySelector('input') as HTMLInputElement
    const span = dom.window.document.querySelector('span') as HTMLSpanElement
    vi.spyOn(span, 'getBoundingClientRect').mockReturnValue(new dom.window.DOMRect(40, 10, 42, 20))

    input.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 55, clientY: 20 }))
    expect(reported('hover').at(-1)).toMatchObject({ tag: 'span' })
    input.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 20 }))
    expect(reported('hover').at(-1)).toMatchObject({ tag: 'label' })

    input.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 55, clientY: 20 }))
    expect(reported('select').at(-1)?.anchor).toMatchObject({ selector: 'div#seg > label > span', editableText: '手机号' })
    input.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 10, clientY: 20 }))
    expect(reported('select').at(-1)?.anchor).toMatchObject({ selector: 'div#seg > label', editableText: null })

    send({ kind: 'selectParent' })
    expect(reported('edit').at(-1)?.anchor).toMatchObject({ selector: 'div#seg', parentSelector: 'body' })
  })

  it('keeps a visible radio as the exact selection target', () => {
    const { dom, send, reported } = frame('<label><input type="radio" name="mode"><span>Visible option</span></label>')
    send({ kind: 'mode', mode: 'inspect' })
    ;(dom.window.document.querySelector('input') as HTMLInputElement).click()
    expect(reported('select').at(-1)?.anchor).toMatchObject({ tag: 'input', editableText: null })
  })

  it('selects the clicked leaf and refuses to replace an ancestor’s combined text', () => {
    const { dom, send, reported } = frame('<section id="panel"><h2 id="title">Heading <em id="emphasis" class="accent">exact</em></h2><p>Second line</p></section>')
    send({ kind: 'mode', mode: 'inspect' })
    const panel = dom.window.document.querySelector('#panel') as HTMLElement
    const title = dom.window.document.querySelector('#title') as HTMLElement
    const emphasis = dom.window.document.querySelector('#emphasis') as HTMLElement
    let pageClicks = 0
    panel.addEventListener('click', () => { pageClicks += 1 })

    const panelClick = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
    panel.dispatchEvent(panelClick)
    const panelAnchor = reported('select').at(-1)?.anchor as FrameAnchor
    expect(panelClick.defaultPrevented).toBe(true)
    expect(pageClicks).toBe(0)
    expect(panelAnchor.selector).toBe('section#panel')
    expect(panelAnchor.text).toBe('Heading exactSecond line')
    expect(panelAnchor.editableText).toBeNull()
    send({ kind: 'text', selector: panelAnchor.selector, value: 'Wrong replacement' })
    expect(title.textContent).toBe('Heading exact')

    title.click()
    const titleAnchor = reported('select').at(-1)?.anchor as FrameAnchor
    expect(titleAnchor.editableText).toBe('Heading ')
    send({ kind: 'text', selector: titleAnchor.selector, value: 'Updated ' })
    expect(title.textContent).toBe('Updated exact')
    emphasis.click()
    const leafAnchor = reported('select').at(-1)?.anchor as FrameAnchor
    expect(leafAnchor.selector).toBe('em#emphasis')
    expect(leafAnchor.editableText).toBe('exact')
    expect(leafAnchor.sourceText).toBe('exact')
    expect(leafAnchor.sourceClasses).toEqual(['accent'])
    send({ kind: 'text', selector: leafAnchor.selector, value: 'changed' })
    expect(title.textContent).toBe('Updated changed')
    expect(dom.window.document.querySelector('p')?.textContent).toBe('Second line')
    emphasis.classList.add('edited')
    emphasis.click()
    expect(reported('select').at(-1)?.anchor).toMatchObject({ text: 'changed', classes: ['accent', 'edited'], sourceText: 'exact', sourceClasses: ['accent'] })
  })

  it('edits the only direct text beside a link without changing the link', () => {
    const { dom, send, reported } = frame('<p class="foot">还没有账号？<a href="#signup">免费注册</a></p>')
    send({ kind: 'mode', mode: 'inspect' })
    const foot = dom.window.document.querySelector('.foot') as HTMLParagraphElement
    foot.click()
    const anchor = reported('select').at(-1)?.anchor as FrameAnchor
    expect(anchor).toMatchObject({ selector: 'body > p', tag: 'p', editableText: '还没有账号？' })
    send({ kind: 'text', selector: anchor.selector, value: '需要账号？' })
    expect(foot.firstChild?.textContent).toBe('需要账号？')
    expect(foot.querySelector('a')?.textContent).toBe('免费注册')
    expect(foot.querySelector('a')?.getAttribute('href')).toBe('#signup')
    send({ kind: 'text', selector: anchor.selector, value: '' })
    foot.click()
    expect(reported('select').at(-1)?.anchor).toMatchObject({ editableText: '' })
    send({ kind: 'text', selector: anchor.selector, value: '还没有账号？' })
    expect(foot.firstChild?.textContent).toBe('还没有账号？')
  })

  it('keeps the full source text when the displayed excerpt is shortened', () => {
    const source = 'word '.repeat(40).trim()
    const { dom, send, reported } = frame(`<p id="long">${source}</p>`)
    send({ kind: 'mode', mode: 'inspect' })
    ;(dom.window.document.querySelector('#long') as HTMLElement).click()
    const anchor = reported('select').at(-1)?.anchor as FrameAnchor
    expect(anchor.text.length).toBeLessThan(source.length)
    expect(anchor.sourceText).toBe(source)
  })

  it('uses a complete positional selector for duplicate and special ids', () => {
    const { dom, send, reported } = frame('<div id="repeated">First</div><div id="repeated">Second</div><div id="with:colon">Third</div>')
    send({ kind: 'mode', mode: 'inspect' })
    const divs = dom.window.document.querySelectorAll('div')
    divs[1]?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    const duplicate = reported('select').at(-1)?.anchor as FrameAnchor
    expect(duplicate.selector).toBe('body > div:nth-of-type(2)')
    expect(dom.window.document.querySelector(duplicate.selector)).toBe(divs[1])
    divs[2]?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    const special = reported('select').at(-1)?.anchor as FrameAnchor
    expect(special.selector).toBe('body > div:nth-of-type(3)')
    expect(dom.window.document.querySelector(special.selector)).toBe(divs[2])
  })

  it('keeps edits and moves on the selected node after sibling order changes', () => {
    const { dom, send, reported } = frame('<div id="list"><span>First</span><span>Second</span></div>')
    send({ kind: 'mode', mode: 'inspect', dragHandleLabel: '拖动所选元素' })
    const list = dom.window.document.querySelector('#list') as HTMLElement
    const first = list.children[0] as HTMLElement
    first.click()
    const selector = (reported('select').at(-1)?.anchor as FrameAnchor).selector
    expect(selector).toBe('div#list > span:nth-of-type(1)')

    const inserted = dom.window.document.createElement('span')
    inserted.textContent = 'Inserted'
    list.prepend(inserted)
    expect(dom.window.document.querySelector(selector)).toBe(inserted)
    send({ kind: 'style', selector, declarations: { color: 'red' } })
    send({ kind: 'text', selector, value: 'Changed' })
    expect(first.style.color).toBe('red')
    expect(first.textContent).toBe('Changed')
    expect(inserted.style.color).toBe('')
    expect(inserted.textContent).toBe('Inserted')

    const handle = dom.window.document.querySelector('[data-dsh-design-drag-handle]') as HTMLButtonElement
    handle.dispatchEvent(pointer(dom, 'pointerdown', 0, 0))
    dom.window.document.dispatchEvent(pointer(dom, 'pointermove', 6, 4))
    dom.window.document.dispatchEvent(pointer(dom, 'pointerup', 6, 4))
    expect(first.style.position).toBe('relative')
    expect(first.style.left).toBe('6px')
    expect(first.style.top).toBe('4px')
    expect(reported('move').at(-1)).toMatchObject({
      selector, anchor: { selector },
      declarations: { position: 'relative', left: '6px', top: '4px' },
      restore: { position: '', left: '', top: '' },
    })
    expect(inserted.style.getPropertyValue('translate')).toBe('')

    first.remove()
    send({ kind: 'style', selector, declarations: { color: 'blue' } })
    send({ kind: 'text', selector, value: 'Wrong target' })
    expect(inserted.style.color).toBe('')
    expect(inserted.textContent).toBe('Inserted')
  })

  it('removes only the selected instance and reports its descendants', () => {
    const { dom, send, reported } = frame('<section id="panel"><p id="target">Text <em>inside</em></p><p id="other">Keep</p></section>')
    send({ kind: 'mode', mode: 'inspect' })
    const target = dom.window.document.querySelector('#target') as HTMLElement
    target.click()
    const selector = (reported('select').at(-1)?.anchor as FrameAnchor).selector
    send({ kind: 'removeSelected', selector, requestId: 'remove-1' })

    expect(target.isConnected).toBe(false)
    expect(dom.window.document.querySelector('#other')?.textContent).toBe('Keep')
    expect(reported('removeResult').at(-1)).toMatchObject({
      requestId: 'remove-1', selector, success: true,
      removedSelectors: ['p#target', 'p#target > em'],
    })
    expect((dom.window.document.querySelector('[data-dsh-design-box]') as HTMLElement).style.display).toBe('none')

    send({ kind: 'removeSelected', selector, requestId: 'remove-again' })
    expect(reported('removeResult').at(-1)).toMatchObject({
      requestId: 'remove-again', selector, success: false, removedSelectors: [],
    })
  })

  it('keeps original sibling selectors across consecutive removals and later edits', () => {
    const { dom, send, reported } = frame('<div id="list"><p>First</p><p>Second <b>inside</b></p><p>Third</p></div>')
    send({ kind: 'mode', mode: 'inspect' })
    const list = dom.window.document.querySelector('#list') as HTMLElement
    const [first, second, third] = Array.from(list.children) as HTMLElement[]
    first?.click()
    send({ kind: 'removeSelected', selector: 'div#list > p:nth-of-type(1)', requestId: 'first' })
    expect(reported('removeResult').at(-1)?.success).toBe(true)

    second?.click()
    const secondAnchor = reported('select').at(-1)?.anchor as FrameAnchor
    expect(secondAnchor.selector).toBe('div#list > p:nth-of-type(2)')
    send({ kind: 'removeSelected', selector: secondAnchor.selector, requestId: 'second' })
    expect(reported('removeResult').at(-1)).toMatchObject({
      requestId: 'second', success: true,
      removedSelectors: ['div#list > p:nth-of-type(2)', 'div#list > p:nth-of-type(2) > b'],
    })
    expect(Array.from(list.children)).toEqual([third])

    send({ kind: 'style', selector: 'div#list > p:nth-of-type(3)', declarations: { color: 'red' } })
    expect(third?.style.color).toBe('red')
  })

  it('reports a previously removed child when its original parent is removed', () => {
    const { dom, send, reported } = frame('<section id="parent"><p id="child">Child</p><p id="sibling">Sibling</p></section>')
    send({ kind: 'mode', mode: 'inspect' })
    ;(dom.window.document.querySelector('#child') as HTMLElement).click()
    send({ kind: 'removeSelected', selector: 'p#child', requestId: 'child' })
    ;(dom.window.document.querySelector('#parent') as HTMLElement).click()
    send({ kind: 'removeSelected', selector: 'section#parent', requestId: 'parent' })
    expect(reported('removeResult').at(-1)).toMatchObject({
      requestId: 'parent', success: true,
      removedSelectors: ['section#parent', 'p#child', 'p#sibling'],
    })
  })

  it('rejects a stale selection even when a replacement occupies its selector', () => {
    const { dom, send, reported } = frame('<div id="list"><p>Original</p></div>')
    send({ kind: 'mode', mode: 'inspect' })
    const original = dom.window.document.querySelector('p') as HTMLElement
    original.click()
    const selector = (reported('select').at(-1)?.anchor as FrameAnchor).selector
    const replacement = dom.window.document.createElement('p')
    replacement.textContent = 'Replacement'
    original.replaceWith(replacement)

    send({ kind: 'removeSelected', selector, requestId: 'stale' })
    expect(reported('removeResult').at(-1)).toMatchObject({ requestId: 'stale', success: false, removedSelectors: [] })
    expect(replacement.isConnected).toBe(true)
  })

  it('replays original selectors in preview mode and refuses roots and ambiguous paths', () => {
    const { dom, send, reported } = frame('<div id="list"><p>First</p><p>Second</p><p>Third</p></div>')
    const list = dom.window.document.querySelector('#list') as HTMLElement
    const [, , third] = Array.from(list.children)
    send({ kind: 'removeSelected', selector: 'div#list > p:nth-of-type(1)', requestId: 'preview' })
    expect(reported('removeResult').at(-1)?.success).toBe(false)

    send({ kind: 'replayRemoval', selector: 'div#list > p:nth-of-type(1)', requestId: 'first' })
    send({ kind: 'replayRemoval', selector: 'div#list > p:nth-of-type(2)', requestId: 'second' })
    expect(reported('removeResult').slice(-2).map(result => result.success)).toEqual([true, true])
    expect(Array.from(list.children)).toEqual([third])
    send({ kind: 'replayRemoval', selector: 'body', requestId: 'root' })
    send({ kind: 'replayRemoval', selector: 'div#list > p', requestId: 'ambiguous' })
    expect(reported('removeResult').slice(-2)).toMatchObject([
      { requestId: 'root', success: false, removedSelectors: [] },
      { requestId: 'ambiguous', success: false, removedSelectors: [] },
    ])
    expect(list.isConnected).toBe(true)
  })

  it('does not remove document roots in edit mode', () => {
    const { dom, send, reported } = frame('<main>Page</main>')
    send({ kind: 'mode', mode: 'inspect' })
    dom.window.document.body.click()
    send({ kind: 'removeSelected', selector: 'body', requestId: 'body' })
    expect(reported('removeResult').at(-1)).toMatchObject({
      requestId: 'body', success: false, removedSelectors: [],
    })
    expect(dom.window.document.body.isConnected).toBe(true)
  })

  it('rejects a nonselected selector when it matches several nodes', () => {
    const { dom, send } = frame('<div id="same">First</div><div id="same">Second</div>')
    const divs = dom.window.document.querySelectorAll('div')
    send({ kind: 'style', selector: 'div#same', declarations: { color: 'red' } })
    send({ kind: 'text', selector: 'div#same', value: 'Wrong target' })
    expect(Array.from(divs).map(div => div.textContent)).toEqual(['First', 'Second'])
    expect(Array.from(divs).map(div => (div as HTMLElement).style.color)).toEqual(['', ''])
  })

  it('does not offer a text replacement when a leaf has several content text nodes', () => {
    const { dom, send, reported } = frame('<button id="split" type="button">First<!-- separator -->Second</button>')
    send({ kind: 'mode', mode: 'inspect' })
    const button = dom.window.document.querySelector('#split') as HTMLButtonElement
    button.click()
    const anchor = reported('select').at(-1)?.anchor as FrameAnchor
    expect(anchor.text).toBe('FirstSecond')
    expect(anchor.editableText).toBeNull()
    send({ kind: 'text', selector: anchor.selector, value: 'Combined' })
    expect(button.textContent).toBe('FirstSecond')
  })

  it('preserves a comment while editing the only direct text node', () => {
    const { dom, send, reported } = frame('<button id="split" type="button">Text<!-- note --></button>')
    send({ kind: 'mode', mode: 'inspect' })
    const button = dom.window.document.querySelector('#split') as HTMLButtonElement
    button.click()
    const anchor = reported('select').at(-1)?.anchor as FrameAnchor
    expect(anchor.editableText).toBe('Text')
    send({ kind: 'text', selector: anchor.selector, value: 'Replacement' })
    expect(button.textContent).toBe('Replacement')
    expect(button.lastChild?.nodeType).toBe(8)
  })

  it('keeps the drag handle outside a short selected element', () => {
    const { dom, send, reported } = frame('<strong id="count">1</strong>')
    send({ kind: 'mode', mode: 'inspect' })
    const count = dom.window.document.querySelector('#count') as HTMLElement
    vi.spyOn(count, 'getBoundingClientRect').mockReturnValue(new dom.window.DOMRect(40, 60, 8, 14))
    count.click()
    const handle = dom.window.document.querySelector('[data-dsh-design-drag-handle]') as HTMLButtonElement
    expect(Number.parseFloat(handle.style.top) + Number.parseFloat(handle.style.height)).toBeLessThan(0)
    count.click()
    expect(reported('select')).toHaveLength(2)

    vi.spyOn(count, 'getBoundingClientRect').mockReturnValue(new dom.window.DOMRect(40, 4, 8, 14))
    count.click()
    expect(Number.parseFloat(handle.style.top)).toBeGreaterThan(14)
  })

  it('moves a static inline element with relative left and top and can restore it', () => {
    const { dom, send, reported } = frame('<strong id="count">1</strong>')
    send({ kind: 'mode', mode: 'inspect', dragHandleLabel: '拖动所选元素' })
    const count = dom.window.document.querySelector('#count') as HTMLElement
    count.click()
    const handle = dom.window.document.querySelector('[data-dsh-design-drag-handle]') as HTMLButtonElement
    handle.dispatchEvent(pointer(dom, 'pointerdown', 10, 10))
    dom.window.document.dispatchEvent(pointer(dom, 'pointermove', 24, 3))
    dom.window.document.dispatchEvent(pointer(dom, 'pointerup', 24, 3))

    const move = reported('move').at(-1)
    expect(count.style.position).toBe('relative')
    expect(count.style.left).toBe('14px')
    expect(count.style.top).toBe('-7px')
    expect(move).toMatchObject({
      selector: 'strong#count',
      declarations: { position: 'relative', left: '14px', top: '-7px' },
      restore: { position: '', left: '', top: '' },
    })
    send({ kind: 'style', selector: 'strong#count', declarations: move?.restore })
    expect(count.style.getPropertyValue('position')).toBe('')
    expect(count.style.getPropertyValue('left')).toBe('')
    expect(count.style.getPropertyValue('top')).toBe('')
  })

  it('cancels an inline drag without losing the original position offsets', () => {
    const { dom, send, reported } = frame('<strong id="count" style="position: relative; left: 4px; top: 2px">1</strong>')
    send({ kind: 'mode', mode: 'inspect' })
    const count = dom.window.document.querySelector('#count') as HTMLElement
    count.click()
    const handle = dom.window.document.querySelector('[data-dsh-design-drag-handle]') as HTMLButtonElement
    handle.dispatchEvent(pointer(dom, 'pointerdown', 10, 10))
    dom.window.document.dispatchEvent(pointer(dom, 'pointermove', 14, 15))
    expect(count.style.getPropertyValue('left')).toContain('8px')
    expect(count.style.getPropertyValue('top')).toContain('7px')
    dom.window.document.dispatchEvent(pointer(dom, 'pointercancel', 14, 15))
    expect(count.style.getPropertyValue('position')).toBe('relative')
    expect(count.style.getPropertyValue('left')).toBe('4px')
    expect(count.style.getPropertyValue('top')).toBe('2px')
    expect(reported('move')).toEqual([])
  })

  it('drags only the explicit handle and reports the selected element’s translate', () => {
    const { dom, send, reported } = frame('<div id="tile" style="translate: 10px 5px">Move me</div>')
    send({ kind: 'mode', mode: 'inspect', dragHandleLabel: '拖动所选元素' })
    const tile = dom.window.document.querySelector('#tile') as HTMLElement
    tile.click()
    const handle = dom.window.document.querySelector('[data-dsh-design-drag-handle]') as HTMLButtonElement
    expect(handle).toBeInstanceOf(dom.window.HTMLButtonElement)
    expect(handle.getAttribute('aria-label')).toBe('拖动所选元素')
    expect(handle.getAttribute('title')).toBe('拖动所选元素')
    expect(reported('move')).toEqual([])

    handle.dispatchEvent(pointer(dom, 'pointerdown', 100, 100))
    dom.window.document.dispatchEvent(pointer(dom, 'pointermove', 112, 94))
    dom.window.document.dispatchEvent(pointer(dom, 'pointerup', 112, 94))

    const move = reported('move').at(-1)
    expect(tile.style.getPropertyValue('translate')).toBe('calc(10px + 12px) calc(5px - 6px)')
    expect(move).toMatchObject({
      kind: 'move', selector: 'div#tile',
      declarations: { translate: 'calc(10px + 12px) calc(5px - 6px)' },
      restore: { translate: '10px 5px' },
      anchor: { selector: 'div#tile', editableText: 'Move me' },
    })
    expect(reported('move')).toHaveLength(1)
  })

  it('restores an in-progress drag when switching back to preview', () => {
    const { dom, send, reported } = frame('<button id="tile" type="button" style="translate: 10px 5px">Click me</button>')
    send({ kind: 'mode', mode: 'inspect' })
    const tile = dom.window.document.querySelector('#tile') as HTMLButtonElement
    let clicks = 0
    tile.addEventListener('click', () => { clicks += 1 })
    tile.click()
    expect(clicks).toBe(0)
    const handle = dom.window.document.querySelector('[data-dsh-design-drag-handle]') as HTMLButtonElement
    handle.dispatchEvent(pointer(dom, 'pointerdown', 0, 0))
    dom.window.document.dispatchEvent(pointer(dom, 'pointermove', 5, 5))
    send({ kind: 'mode', mode: 'browse' })

    expect(tile.style.getPropertyValue('translate')).toBe('10px 5px')
    expect(reported('move')).toEqual([])
    tile.click()
    expect(clicks).toBe(1)
  })

  it('does not overwrite an existing translate value it cannot safely offset', () => {
    const { dom, send, reported } = frame('<div id="tile" style="translate: var(--position)">Move me</div>')
    send({ kind: 'mode', mode: 'inspect' })
    const tile = dom.window.document.querySelector('#tile') as HTMLElement
    tile.click()
    const handle = dom.window.document.querySelector('[data-dsh-design-drag-handle]') as HTMLButtonElement
    handle.dispatchEvent(pointer(dom, 'pointerdown', 0, 0))
    dom.window.document.dispatchEvent(pointer(dom, 'pointermove', 20, 20))
    dom.window.document.dispatchEvent(pointer(dom, 'pointerup', 20, 20))
    expect(tile.style.getPropertyValue('translate')).toBe('var(--position)')
    expect(reported('move')).toEqual([])
  })
})
