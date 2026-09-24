import { defineConfig } from 'vitest/config'

/**
 * These tests verify the plugin's registrations against real registries — which
 * implementation claims `.html`, which seat receives the body, and whether
 * disposal unwinds. They are not a rendering test of the harness's UI kit, so
 * the kit and the CSS Modules the harness publishes are stubbed: pulling the
 * real primitives in would drag their whole Markdown dependency tree into a
 * registration test.
 */
const stubs = {
  name: 'dsh-web-design-stubs',
  enforce: 'pre' as const,
  resolveId(source: string) {
    if (source.endsWith('.css')) return `\0css-stub:${source}`
    if (source === '@deepseek-ai/dsh-client-ui-primitives') return '\0primitives-stub'
    return null
  },
  load(id: string) {
    if (id.startsWith('\0css-stub:')) {
      // A Proxy answers any class lookup, so a component that reads
      // `css.anything` renders a stable name instead of throwing.
      return 'export default new Proxy({}, { get: (_target, key) => String(key) })'
    }
    if (id === '\0primitives-stub') {
      return STUB_PRIMITIVES
    }
    return null
  },
}

/**
 * A stand-in for the primitives the preview composes. Each export is the
 * smallest React element that keeps the component tree renderable; the props
 * the preview passes (`variant`, `tone`, `label`, `active`) are accepted and
 * ignored. `writeClipboard` keeps the one behaviour the preview depends on: it
 * writes through `navigator.clipboard` and reports acceptance, so a spec can
 * assert on a fake clipboard instead of the harness's UI kit.
 */
const STUB_PRIMITIVES = `
import { createElement } from 'react'
const passthrough = (name) => ({ children, ...rest }) => createElement(name, rest, children)
export const Button = passthrough('button')
export const Input = passthrough('input')
export const Pill = passthrough('button')
export const Tag = passthrough('span')
export const Tooltip = ({ children, label }) => children
export const writeClipboard = async (text) => {
  if (navigator.clipboard?.writeText === undefined) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
`

export default defineConfig({
  plugins: [stubs],
  test: {
    include: ['tests/**/*.spec.ts'],
    // The shared default is a node environment; specs opt into jsdom with a
    // per-file pragma.
    environment: 'node',
  },
})
