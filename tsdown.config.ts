import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { defineConfig } from 'tsdown'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const DECORATOR_SYNTAX = /^\s*@[A-Za-z_$][\w$]*/m

/**
 * Lower TC39 stage-3 class decorators before rolldown bundles the host entry.
 * Node does not parse decorator syntax, so the `@Remote` markers on the review
 * service must be compiled to their `__runInitializers` form at build time.
 * @returns the tsdown plugin performing the lowering.
 */
function lowerDecorators() {
  return {
    name: 'dsh-lower-decorators',
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0] ?? id
      if (!/\.[cm]?tsx?$/.test(file) || !DECORATOR_SYNTAX.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          ...(file.endsWith('x') ? { jsx: ts.JsxEmit.ReactJSX } : {}),
          sourceMap: true,
        },
      })
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'lib',
  platform: 'node',
  dts: false,
  // The Host half reports the version it installed so a stale copy is
  // refreshed; inlining it keeps the runtime from reading a manifest.
  define: { __PLUGIN_VERSION__: JSON.stringify(version) },
  // Every @deepseek-ai package is resolved from the running harness at load
  // time, so none of them may be inlined here.
  deps: { neverBundle: [/^@deepseek-ai\//] },
  plugins: [lowerDecorators()],
  clean: true,
})
