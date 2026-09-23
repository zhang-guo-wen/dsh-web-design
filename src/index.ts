/**
 * Web-design plugin (host) with a Sidebar HTML preview (client).
 *
 * Host: materializes the bundled OpenDesign web-design skills into the agent
 * skills directory so the filesystem skill provider discovers them, and exposes
 * the `webDesignReview` Remote the Sidebar preview reads and writes.
 * Client: `src/client` bundles an HTML document preview into a
 * `window.__ModuleLoader__` handoff artifact served at `/plugins/<id>/client.js`.
 *
 * The skills are copied rather than registered through `ctx.skills.register()`
 * because the requirement is a skills *directory* the user can read, edit, and
 * keep after uninstalling: a runtime registration would vanish with the plugin
 * and be invisible on disk.
 *
 * @module @guowenzhang/dsh-web-design
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { WebDesignRemote } from './remote.ts'
import { materializeSkills, removeMaterializedSkills, resolveSkillsDir } from './skills.ts'

export { TYPERT_REMOTE, REMOTE_NAMESPACE } from './typert.ts'
export { WebDesignRemote } from './remote.ts'
export {
  MARKER_NAME,
  OWNER,
  digestDirectory,
  listBundledSkills,
  materializeSkills,
  removeMaterializedSkills,
  resolveSkillsDir,
  type MaterializeReport,
} from './skills.ts'
export {
  SIDECAR_SUFFIX,
  emptyDocument,
  readAnnotations,
  sidecarPath,
  validateWrite,
  writeAnnotations,
} from './store.ts'
export { applySourceEdits, parseSelector, parseSource } from './source-edit.ts'
export type { SourceEditResult } from './source-edit.ts'
export type * from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-design'

/** Build-time plugin version, replaced by the bundler. */
declare const __PLUGIN_VERSION__: string | undefined

/** Services this plugin requires; none, so it loads in any composition. */
export const inject = []

/** Composition configuration for the web-design plugin. */
export interface Config {
  /** Whether the bundled skills are installed into the agent skills directory. */
  enabled: boolean
  /** Target skills directory; defaults to `$DSH_AGENTS_HOME/skills` or `~/.agents/skills`. */
  targetDir?: string
  /**
   * Skill names to install. Empty installs every bundled skill; naming a subset
   * keeps a deployment's skill catalog small.
   */
  skillNames: string[]
  /** Whether this plugin's own skill-ownership check runs at load. */
  verifyOnLoad: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: Schema<Config> = z.object({
  enabled: z.boolean().default(true),
  targetDir: z.string(),
  skillNames: z.array(z.string()).default([]),
  verifyOnLoad: z.boolean().default(false),
})

/** Absolute `assets/skills` directory shipped beside this plugin's entry. */
function bundledSkillsDir(): string {
  // `lib/index.mjs` sits one level under the package root, both in the source
  // tree and in a published install.
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'skills')
}

/**
 * Install the bundled skills and register the review Remote.
 *
 * Installation is an effect: the disposer removes exactly the directories this
 * plugin wrote, leaving user-authored skills untouched. The Remote registers
 * unconditionally, because a guarded registration would make every client call
 * fail with a missing namespace rather than a reportable error.
 * @param ctx - plugin context; every registration is disposed with it.
 * @param config - composition defaults and the skill selection.
 */
export function apply(ctx: Context, config: Config = { enabled: true, skillNames: [], verifyOnLoad: false }): void {
  // The Remote owner registers itself as `ctx.webDesignReview` on construction;
  // the service registry keeps the instance alive for this fiber's lifetime.
  void new WebDesignRemote(ctx)

  if (!config.enabled) return
  const targetDir = resolveSkillsDir(config.targetDir)
  const sourceDir = bundledSkillsDir()
  const skillNames = config.skillNames.length > 0 ? config.skillNames : undefined
  const version = pluginVersion()
  const selection = skillNames === undefined ? {} : { skillNames }

  // Installation is asynchronous, so the effect owns only the teardown and the
  // startup runs beside it. Both share one settlement promise, which keeps the
  // install ahead of the uninstall without making the effect await it.
  const settled = materializeSkills({ sourceDir, targetDir, version, ...selection })
    .then((report) => {
      if (report.installed.length > 0) {
        ctx.logger.info(`web-design: installed ${report.installed.length} skill(s) into ${report.targetDir}`)
      }
      if (report.foreign.length > 0) {
        ctx.logger.info(`web-design: left ${report.foreign.length} unowned skill director(ies) untouched: ${report.foreign.join(', ')}`)
      }
    })
    .catch((error: unknown) => {
      // A failed install is reported, not thrown: it must not take down a host
      // that also serves the preview's Remote.
      ctx.logger.warn(`web-design: installing bundled skills failed: ${String(error)}`)
    })

  ctx.effect(() => () => {
    void settled.then(async () => {
      const removed = await removeMaterializedSkills({ targetDir, ...selection })
      if (removed.length > 0) {
        ctx.logger.info(`web-design: removed ${removed.length} installed skill(s) from ${targetDir}`)
      }
    }).catch((error: unknown) => {
      ctx.logger.warn(`web-design: removing installed skills failed: ${String(error)}`)
    })
  }, 'web-design: bundled skills')
}

/**
 * Read this plugin's own version.
 *
 * The version is inlined at build time so the Host half never reads a manifest
 * at runtime; a source-tree load falls back to a value that forces one refresh,
 * which is the safe direction for an install that may be stale.
 * @returns the build version, or a sentinel that always refreshes.
 */
function pluginVersion(): string {
  return typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '0.0.0'
}
