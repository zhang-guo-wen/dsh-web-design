window.__ModuleLoader__.load({
	id: "@guowenzhang/dsh-web-design",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region node_modules/@deepseek-ai/dsh-util-workspace-path/lib/index.js
		/**
		* The `dsh-resource://file/…` address grammar: how a file is named across the
		* Sidebar and the resource model, built and parsed without touching a
		* filesystem.
		* @module
		*/
		/** The scheme and type every file address opens with. */
		const FILE_ADDRESS_PREFIX = "dsh-resource://file/";
		/** Whether a decoded first path segment is a Windows drive (`C:`). */
		function isDriveSegment(segment) {
			return segment !== void 0 && /^[A-Za-z]:$/.test(segment);
		}
		/**
		* Read a file address back into its parts without resolving `.` or `..`.
		* Query and fragment suffixes are ignored; encoded path segments are decoded.
		* @param address - a candidate address.
		* @returns the parts, or `undefined` when the string is not a `dsh-resource://file/` URI in a known scope with a path, or a segment is not validly encoded.
		*/
		function parseFileAddress(address) {
			try {
				if (!address.startsWith(FILE_ADDRESS_PREFIX)) return void 0;
				const end = address.search(/[?#]/);
				const [scope, ...rest] = address.slice(20, end === -1 ? void 0 : end).split("/");
				if (scope === "session") {
					const [id, ...segments] = rest;
					if (id === void 0 || id === "" || segments.length === 0) return void 0;
					return {
						scope,
						sessionId: decodeURIComponent(id),
						path: segments.map(decodeURIComponent).join("/")
					};
				}
				if (scope === "absolute") {
					const unc = rest[0] === "" && rest.length > 1;
					const segments = (unc ? rest.slice(1) : rest).map(decodeURIComponent);
					if (segments.length === 0 || segments[0] === "") return void 0;
					if (unc) return {
						scope,
						path: `//${segments.join("/")}`
					};
					return {
						scope,
						path: isDriveSegment(segments[0]) ? segments.join("/") : `/${segments.join("/")}`
					};
				}
				return;
			} catch {
				return;
			}
		}
		//#endregion
		//#region src/typert.ts
		/** Wire namespace and Cordis service key of the review owner. */
		const REMOTE_NAMESPACE = "webDesignReview";
		/** Permissive strict codec: accepts any value, returns it unchanged. */
		const passthrough = { parse: (value) => value };
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
		function codec(typeSymbol) {
			return {
				mode: "strict",
				typeSymbol,
				schema: passthrough,
				create: () => passthrough
			};
		}
		/** One `direct` invocation descriptor for a namespace method. */
		function descriptor(method) {
			const owner = `@guowenzhang/dsh-web-design#${`${REMOTE_NAMESPACE}/${method}`}`;
			return {
				id: owner,
				service: REMOTE_NAMESPACE,
				namespace: REMOTE_NAMESPACE,
				method,
				invocation: { kind: "direct" },
				parameters: [{
					name: "request",
					wire: "request",
					source: "json",
					codec: codec(`${owner}:request`)
				}],
				result: codec(`${owner}:result`)
			};
		}
		/** Contribution mounted by the browser half to reach the review store. */
		const TYPERT_REMOTE = {
			package: "@guowenzhang/dsh-web-design",
			descriptors: [
				descriptor("read"),
				descriptor("write"),
				descriptor("apply")
			]
		};
		//#endregion
		//#region node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		//#endregion
		//#region src/client/frame-runtime.ts
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
		const CHANNEL = "dsh-web-design";
		/**
		* Render the runtime script for one frame.
		*
		* The script is a plain function stringified into the document. It runs once,
		* installs capture-phase listeners so the tools win over page handlers, and
		* never exposes page globals to the parent.
		* @returns the complete `<script>` contents.
		*/
		function frameRuntime() {
			return `(${runtime.toString()})(${JSON.stringify(CHANNEL)});`;
		}
		/**
		* The runtime body. Kept as a named function so {@link frameRuntime} can
		* stringify it; it must stay self-contained — no imports, no closure values.
		* @param channel - message channel name expected on every message.
		*/
		function runtime(channel) {
			const doc = globalThis.document;
			if (doc === void 0) return;
			let mode = "browse";
			let hovered = null;
			let overlay = null;
			let box = null;
			const post = (message) => {
				try {
					globalThis.parent?.postMessage({
						channel,
						...message
					}, "*");
				} catch {}
			};
			/** Build a stable selector path, preferring ids and stopping at unique anchors. */
			const selectorFor = (element) => {
				const parts = [];
				let current = element;
				while (current !== null && current !== doc.documentElement) {
					const tag = current.tagName.toLowerCase();
					const id = current.getAttribute("id");
					if (id !== null && id.length > 0) {
						parts.unshift(tag + "#" + id);
						break;
					}
					const parent = current.parentElement;
					if (parent === null) {
						parts.unshift(tag);
						break;
					}
					const siblings = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
					const index = siblings.indexOf(current) + 1;
					parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
					current = parent;
				}
				return parts.length === 0 ? "html" : parts.join(" > ");
			};
			const resolve = (selector) => {
				try {
					return doc.querySelector(selector);
				} catch {
					return null;
				}
			};
			const anchorFor = (element) => {
				const rect = element.getBoundingClientRect();
				const view = doc.defaultView;
				const computed = view?.getComputedStyle(element);
				const style = {};
				for (const key of [
					"font-size",
					"font-weight",
					"line-height",
					"letter-spacing",
					"color",
					"background-color",
					"padding",
					"padding-top",
					"padding-right",
					"padding-bottom",
					"padding-left",
					"margin",
					"margin-top",
					"margin-right",
					"margin-bottom",
					"margin-left",
					"border-radius",
					"width",
					"height"
				]) {
					const value = computed?.getPropertyValue(key);
					if (typeof value === "string" && value.length > 0) style[key] = value;
				}
				const id = element.getAttribute("id");
				return {
					selector: selectorFor(element),
					tag: element.tagName.toLowerCase(),
					...id === null ? {} : { id },
					classes: Array.from(element.classList),
					text: textOf(element),
					rect: {
						x: rect.left + (view?.scrollX ?? 0),
						y: rect.top + (view?.scrollY ?? 0),
						width: rect.width,
						height: rect.height
					},
					computed: style
				};
			};
			/** Short text excerpt for the selected-element display. */
			const textOf = (element) => {
				const raw = (element.textContent ?? "").replace(/\\s+/g, " ").trim();
				return raw.length > 160 ? raw.slice(0, 160) + "…" : raw;
			};
			const ensureChrome = () => {
				if (overlay !== null && box !== null) return;
				overlay = doc.createElement("div");
				overlay.setAttribute("data-dsh-design-overlay", "");
				overlay.style.cssText = "position:absolute;z-index:2147483646;pointer-events:none;border:1px solid #4c8dff;background:rgba(76,141,255,0.12);border-radius:2px;transition:all 60ms linear;display:none";
				box = doc.createElement("div");
				box.setAttribute("data-dsh-design-box", "");
				box.style.cssText = "position:absolute;z-index:2147483647;pointer-events:none;border:2px solid #4c8dff;box-shadow:0 0 0 1px rgba(255,255,255,0.6) inset;display:none";
				doc.body.append(overlay, box);
			};
			const place = (node, element) => {
				if (element === null) {
					node.style.display = "none";
					return;
				}
				const rect = element.getBoundingClientRect();
				const view = doc.defaultView;
				node.style.display = "block";
				node.style.left = rect.left + (view?.scrollX ?? 0) + "px";
				node.style.top = rect.top + (view?.scrollY ?? 0) + "px";
				node.style.width = rect.width + "px";
				node.style.height = rect.height + "px";
			};
			const interactive = (event) => {
				const target = event.target;
				if (!(target instanceof Element)) return false;
				return target.closest("[data-dsh-design-overlay],[data-dsh-design-box]") === null;
			};
			doc.addEventListener("mousemove", (event) => {
				if (mode === "browse" || mode === "annotate") return;
				if (!interactive(event)) return;
				const target = event.target;
				if (!(target instanceof Element) || target === hovered) return;
				hovered = target;
				ensureChrome();
				place(overlay, target);
				post({
					kind: "hover",
					selector: selectorFor(target),
					tag: target.tagName.toLowerCase()
				});
			}, true);
			doc.addEventListener("mouseleave", () => {
				hovered = null;
				place(overlay, null);
				post({
					kind: "hover",
					selector: null,
					tag: null
				});
			}, true);
			doc.addEventListener("click", (event) => {
				if (mode === "browse") return;
				if (!interactive(event)) return;
				const target = event.target;
				if (!(target instanceof Element)) return;
				event.preventDefault();
				event.stopPropagation();
				ensureChrome();
				place(box, target);
				post({
					kind: "select",
					anchor: anchorFor(target)
				});
			}, true);
			doc.addEventListener("mousedown", (event) => {
				if (mode !== "annotate") return;
				event.clientX, event.clientY;
			}, true);
			globalThis.addEventListener("message", (event) => {
				const data = event.data;
				if (typeof data !== "object" || data === null) return;
				const message = data;
				if (message.channel !== channel) return;
				ensureChrome();
				switch (message.kind) {
					case "mode":
						mode = String(data.mode ?? "browse");
						if (mode === "browse" || mode === "annotate") place(box, null);
						return;
					case "style": {
						const payload = data;
						const element = resolve(payload.selector);
						if (element instanceof HTMLElement) {
							for (const [property, value] of Object.entries(payload.declarations)) element.style.setProperty(property, value);
							place(box, element);
						}
						return;
					}
					case "text": {
						const payload = data;
						const element = resolve(payload.selector);
						if (element !== null) element.textContent = payload.value;
						return;
					}
					case "highlight": {
						const first = data.selectors.map(resolve).find((element) => element !== null) ?? null;
						place(box, first);
						return;
					}
					case "reset":
						hovered = null;
						place(box, null);
						place(overlay, null);
						return;
					default: return;
				}
			});
			post({ kind: "ready" });
		}
		//#endregion
		//#region src/client/document.ts
		/**
		* Build the preview document from a file's bytes.
		*
		* The preview needs scripts to run (an injected runtime observes hover and
		* selection and applies edits), so the frame is sandboxed with `allow-scripts`
		* but without `allow-same-origin`. That gives the page a unique opaque origin:
		* it cannot read the parent document, cookies, or storage, while the runtime
		* still reaches the parent over `postMessage`.
		*
		* The file's own markup is preserved. The runtime is appended as the last node
		* in the body so the page's DOM is complete before it installs its listeners.
		*
		* @module @guowenzhang/dsh-web-design/client/document
		*/
		/**
		* Decode a file's bytes as UTF-8 text.
		* @param data - the file's complete bytes.
		* @returns the decoded source, or `undefined` when the bytes are not valid UTF-8.
		*/
		function decodeSource(data) {
			try {
				return new TextDecoder("utf-8", { fatal: true }).decode(data);
			} catch {
				return;
			}
		}
		/**
		* Inject the design-tools runtime into an HTML source.
		*
		* A document with no `<body>` gets one appended rather than rejected: partial
		* fragments are common while an agent is still writing the file, and a preview
		* that refuses to open them is useless for reviewing work in progress.
		* @param source - the file's decoded HTML source.
		* @returns a complete document carrying the runtime.
		*/
		function withRuntime(source) {
			const script = `<script data-dsh-design-runtime>${frameRuntime()}<\/script>`;
			const bodyClose = source.lastIndexOf("</body>");
			if (bodyClose >= 0) return `${source.slice(0, bodyClose)}${script}${source.slice(bodyClose)}`;
			const htmlClose = source.lastIndexOf("</html>");
			if (htmlClose >= 0) return `${source.slice(0, htmlClose)}${script}${source.slice(htmlClose)}`;
			return `${source}${script}`;
		}
		/**
		* Build the complete preview document for one file.
		* @param data - the file's complete bytes.
		* @returns the document source, or `undefined` when the bytes are not text.
		*/
		function buildPreviewDocument(data) {
			const source = decodeSource(data);
			return source === void 0 ? void 0 : withRuntime(source);
		}
		//#endregion
		//#region src/client/store.ts
		/**
		* Client-side review state for one previewed document.
		*
		* The store holds what the preview renders: the selected element, the pending
		* comment draft, the review document loaded from the Host, and whether the
		* document has unsaved changes. It is a snapshot store so the render path
		* subscribes instead of mirroring, and it is created per registration so two
		* previewed files never share state.
		*
		* @module @guowenzhang/dsh-web-design/client/store
		*/
		/**
		* Create the store for one previewed document.
		* @param file - absolute path of the previewed file, recorded in new documents.
		* @returns the store handle the component reads through `useStore`.
		*/
		function createDesignStore(file) {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: () => ({
					mode: "browse",
					selectedSelector: null,
					selected: null,
					hovered: null,
					document: null,
					draft: "",
					draftSeverity: "note",
					region: null,
					screenshot: null,
					loading: true,
					dirty: false,
					saving: false,
					error: null,
					panelOpen: false,
					open: false,
					reloadToken: 0
				}),
				actions: {
					setMode: (state, mode) => {
						state.mode = mode;
						if (mode !== "annotate") state.region = null;
						if (mode !== "inspect") state.open = false;
					},
					setHovered: (state, hovered) => {
						state.hovered = hovered;
					},
					select: (state, anchor) => {
						state.selected = anchor;
						state.selectedSelector = anchor?.selector ?? null;
						state.draft = "";
					},
					load: (state, document) => {
						state.document = document;
						state.dirty = false;
						state.error = null;
					},
					setDraft: (state, body) => {
						state.draft = body;
					},
					setDraftSeverity: (state, severity) => {
						state.draftSeverity = severity;
					},
					setRegion: (state, region) => {
						state.region = region;
					},
					setScreenshot: (state, dataUrl) => {
						state.screenshot = dataUrl;
					},
					addComment: (state, comment) => {
						const current = state.document ?? emptyDocument(file);
						state.document = {
							...current,
							comments: [...current.comments, comment],
							updatedAt: comment.createdAt
						};
						state.dirty = true;
					},
					toggleResolved: (state, id) => {
						const current = state.document;
						if (current === null) return;
						state.document = {
							...current,
							comments: current.comments.map((comment) => comment.id === id ? {
								...comment,
								resolved: !comment.resolved
							} : comment),
							updatedAt: (/* @__PURE__ */ new Date()).toISOString()
						};
						state.dirty = true;
					},
					removeComment: (state, id) => {
						const current = state.document;
						if (current === null) return;
						state.document = {
							...current,
							comments: current.comments.filter((comment) => comment.id !== id),
							updatedAt: (/* @__PURE__ */ new Date()).toISOString()
						};
						state.dirty = true;
					},
					upsertEdit: (state, edit) => {
						const current = state.document ?? emptyDocument(file);
						const others = current.edits.filter((existing) => existing.selector !== edit.selector);
						state.document = {
							...current,
							edits: [...others, edit],
							updatedAt: edit.updatedAt
						};
						state.dirty = true;
					},
					removeEdit: (state, selector) => {
						const current = state.document;
						if (current === null) return;
						state.document = {
							...current,
							edits: current.edits.filter((edit) => edit.selector !== selector),
							updatedAt: (/* @__PURE__ */ new Date()).toISOString()
						};
						state.dirty = true;
					},
					clearEdits: (state) => {
						const current = state.document;
						if (current === null) return;
						state.document = {
							...current,
							edits: [],
							updatedAt: (/* @__PURE__ */ new Date()).toISOString()
						};
						state.dirty = true;
					},
					beginLoad: (state) => {
						state.loading = true;
					},
					endLoad: (state) => {
						state.loading = false;
					},
					beginSave: (state) => {
						state.saving = true;
						state.error = null;
					},
					endSave: (state, document) => {
						state.saving = false;
						state.document = document;
						state.dirty = false;
						state.error = null;
					},
					failSave: (state, message) => {
						state.saving = false;
						state.error = message;
					},
					togglePanel: (state) => {
						state.panelOpen = !state.panelOpen;
					},
					setOpen: (state, open) => {
						state.open = open;
					},
					requestReload: (state) => {
						state.reloadToken += 1;
					}
				}
			});
		}
		/** An empty review document, kept local so the store never imports the Host half. */
		function emptyDocument(file) {
			return {
				version: 1,
				file,
				comments: [],
				edits: [],
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			};
		}
		//#endregion
		//#region \0dsh-css:C:\02-codespace\deepseek-harness\dsh-web-design\src\client\HtmlDesignBody.module.css.mjs
		const css = ".YFfwAG_preview{box-sizing:border-box;width:100%;height:100%;min-height:300px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,system-ui, sans-serif);white-space:normal;flex-direction:column;display:flex;container-type:inline-size}.YFfwAG_toolbar{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex-wrap:wrap;flex:none;justify-content:space-between;align-items:center;gap:8px 12px;padding:8px 10px;display:flex}.YFfwAG_modes,.YFfwAG_toolbarEnd,.YFfwAG_severities,.YFfwAG_actions{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.YFfwAG_workspace{background:var(--dsw-alias-interactive-bg-hover-solid);flex:auto;min-height:0;position:relative;overflow:hidden}.YFfwAG_stage{box-sizing:border-box;min-width:0;padding:18px;display:flex;position:absolute;inset:0}.YFfwAG_frame{border:1px solid var(--dsw-alias-border-l2);background:#fff;border-radius:8px;flex:auto;width:100%;min-width:0;height:100%;min-height:0;display:block;box-shadow:0 14px 38px #00000021}.YFfwAG_editor{z-index:1150;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,system-ui, sans-serif);white-space:normal;border-radius:16px;flex-direction:column;display:flex;position:fixed;overflow:hidden;box-shadow:0 18px 52px #00000040}.YFfwAG_editorHeader,.YFfwAG_editorFooter{flex:none;align-items:center;gap:8px;padding:12px 16px;display:flex}.YFfwAG_editorHeader{border-bottom:1px solid var(--dsw-alias-border-l2);justify-content:space-between}.YFfwAG_editorIdentity{align-items:center;gap:8px;min-width:0;display:flex}.YFfwAG_elementTag{background:var(--dsw-alias-interactive-bg-hover);font-family:var(--dsw-font-mono,ui-monospace, monospace);border-radius:6px;flex:none;padding:4px 7px;font-size:11px;font-weight:700}.YFfwAG_editorSelector{min-width:0;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono,ui-monospace, monospace);text-overflow:ellipsis;white-space:nowrap;font-size:11px;overflow:hidden}.YFfwAG_editorScroll{overscroll-behavior:contain;flex-direction:column;gap:16px;min-height:0;padding:16px;display:flex;overflow-y:auto}.YFfwAG_editorFooter{border-top:1px solid var(--dsw-alias-border-l2)}.YFfwAG_footerSpace{flex:auto}.YFfwAG_panel{z-index:2;box-sizing:border-box;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex-direction:column;gap:16px;width:min(340px,100%);padding:16px;display:flex;position:absolute;inset:0 0 0 auto;overflow-y:auto;box-shadow:-8px 0 24px #0000001a}.YFfwAG_section{flex-direction:column;gap:8px;display:flex}.YFfwAG_sectionTitle{color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;margin:0;font-size:12px;font-weight:650;display:flex}.YFfwAG_count{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11px}.YFfwAG_meta{grid-template-columns:auto minmax(0,1fr);gap:3px 8px;margin:0;font-size:12px;display:grid}.YFfwAG_meta dt{color:var(--dsw-alias-label-tertiary)}.YFfwAG_meta dd{overflow-wrap:anywhere;margin:0}.YFfwAG_mono{overflow-wrap:anywhere;font-family:var(--dsw-font-mono,ui-monospace, monospace);font-size:11px}.YFfwAG_muted,.YFfwAG_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}.YFfwAG_fields{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;display:grid}.YFfwAG_field{flex-direction:column;gap:4px;min-width:0;display:flex}.YFfwAG_fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px}.YFfwAG_list{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}.YFfwAG_comment{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;flex-direction:column;gap:5px;padding:8px;display:flex}.YFfwAG_resolved{opacity:.55}.YFfwAG_commentHead,.YFfwAG_commentActions,.YFfwAG_edit{justify-content:space-between;align-items:center;gap:6px;display:flex}.YFfwAG_commentBody{overflow-wrap:anywhere;white-space:pre-wrap;margin:0;font-size:12px}.YFfwAG_draft{flex-direction:column;gap:8px;margin-top:4px;display:flex}.YFfwAG_notice{overflow-wrap:anywhere;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);margin:0;padding:7px 12px;font-size:12px}.YFfwAG_status{color:var(--dsw-alias-label-tertiary);margin:0;padding:12px;font-size:12px}@container (width<=430px){.YFfwAG_stage{padding:8px}}.YFfwAG_editor[data-compact] .YFfwAG_fields{grid-template-columns:minmax(0,1fr)}.YFfwAG_editor[data-compact] .YFfwAG_editorHeader,.YFfwAG_editor[data-compact] .YFfwAG_editorFooter{padding:10px 12px}.YFfwAG_editor[data-compact] .YFfwAG_editorScroll{padding:12px}";
		const tagId = "@guowenzhang/dsh-web-design/HtmlDesignBody.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var HtmlDesignBody_module_css_default = {
			"actions": "YFfwAG_actions",
			"comment": "YFfwAG_comment",
			"commentActions": "YFfwAG_commentActions",
			"commentBody": "YFfwAG_commentBody",
			"commentHead": "YFfwAG_commentHead",
			"count": "YFfwAG_count",
			"draft": "YFfwAG_draft",
			"edit": "YFfwAG_edit",
			"editor": "YFfwAG_editor",
			"editorFooter": "YFfwAG_editorFooter",
			"editorHeader": "YFfwAG_editorHeader",
			"editorIdentity": "YFfwAG_editorIdentity",
			"editorScroll": "YFfwAG_editorScroll",
			"editorSelector": "YFfwAG_editorSelector",
			"elementTag": "YFfwAG_elementTag",
			"field": "YFfwAG_field",
			"fieldLabel": "YFfwAG_fieldLabel",
			"fields": "YFfwAG_fields",
			"footerSpace": "YFfwAG_footerSpace",
			"frame": "YFfwAG_frame",
			"hint": "YFfwAG_hint",
			"list": "YFfwAG_list",
			"meta": "YFfwAG_meta",
			"modes": "YFfwAG_modes",
			"mono": "YFfwAG_mono",
			"muted": "YFfwAG_muted",
			"notice": "YFfwAG_notice",
			"panel": "YFfwAG_panel",
			"preview": "YFfwAG_preview",
			"resolved": "YFfwAG_resolved",
			"section": "YFfwAG_section",
			"sectionTitle": "YFfwAG_sectionTitle",
			"severities": "YFfwAG_severities",
			"stage": "YFfwAG_stage",
			"status": "YFfwAG_status",
			"toolbar": "YFfwAG_toolbar",
			"toolbarEnd": "YFfwAG_toolbarEnd",
			"workspace": "YFfwAG_workspace"
		};
		//#endregion
		//#region src/client/HtmlDesignBody.tsx
		/**
		* The Sidebar's web-design HTML preview.
		*
		* The reviewed page stays visible in the preview tab. A compact toolbar
		* switches pointer modes, the review panel opens on demand, and selecting an
		* element in edit mode opens its inputs in a dialog. Review state reaches the Host
		* through the injected `saveReview`/`loadReview` callbacks, which the plugin
		* body binds to the `webDesignReview` Remote.
		*
		* The component holds no subscriptions of its own: the store reaches it through
		* the framework's `useStore` seat, and everything else is owner or inject data.
		*
		* @module @guowenzhang/dsh-web-design/client/HtmlDesignBody
		*/
		const MODES = [
			"browse",
			"inspect",
			"comment",
			"annotate"
		];
		/** Severity values the comment form offers, in escalation order. */
		const SEVERITIES = [
			"note",
			"nit",
			"issue",
			"blocker"
		];
		/** Editable style properties, with the locale key naming each one. */
		const STYLE_FIELDS = [
			{
				key: "font-size",
				label: "fontSize"
			},
			{
				key: "font-weight",
				label: "fontWeight"
			},
			{
				key: "line-height",
				label: "lineHeight"
			},
			{
				key: "letter-spacing",
				label: "letterSpacing"
			},
			{
				key: "color",
				label: "color"
			},
			{
				key: "background-color",
				label: "background"
			},
			{
				key: "padding",
				label: "padding"
			},
			{
				key: "margin",
				label: "margin"
			},
			{
				key: "border-radius",
				label: "borderRadius"
			}
		];
		/** Keep an editing surface beside the Sidebar when space allows. */
		function placeEditor(stage) {
			const rect = stage.getBoundingClientRect();
			const visual = window.visualViewport;
			const viewportLeft = visual?.offsetLeft ?? 0;
			const viewportTop = visual?.offsetTop ?? 0;
			const viewportWidth = visual?.width ?? window.innerWidth;
			const viewportHeight = visual?.height ?? window.innerHeight;
			const inset = 12;
			const gap = 16;
			const viewportRight = viewportLeft + viewportWidth;
			const viewportBottom = viewportTop + viewportHeight;
			const leftRoom = rect.left - viewportLeft - inset - gap;
			const rightRoom = viewportRight - rect.right - inset - gap;
			const minimumSideWidth = 260;
			const maxHeight = Math.max(0, Math.min(560, viewportHeight - 24));
			if (leftRoom >= minimumSideWidth || rightRoom >= minimumSideWidth) {
				const side = leftRoom >= minimumSideWidth ? "left" : "right";
				const width = Math.min(480, side === "left" ? leftRoom : rightRoom);
				return {
					side,
					left: side === "left" ? rect.left - gap - width : rect.right + gap,
					top: Math.min(Math.max(rect.top + 20, viewportTop + inset), viewportBottom - inset - maxHeight),
					width,
					maxHeight
				};
			}
			const width = Math.max(0, Math.min(480, viewportWidth - 24));
			const visibleStageHeight = Math.max(0, Math.min(rect.bottom, viewportBottom) - Math.max(rect.top, viewportTop));
			const maxBottomHeight = Math.max(0, Math.min(400, viewportHeight * .48, visibleStageHeight * .55));
			return {
				side: "bottom",
				left: viewportLeft + (viewportWidth - width) / 2,
				top: viewportBottom - inset - maxBottomHeight,
				width,
				maxHeight: maxBottomHeight
			};
		}
		/** Mint a comment id unique across tabs and reloads. */
		function commentId() {
			const random = Math.random().toString(36).slice(2, 10);
			return `c-${Date.now().toString(36)}-${random}`;
		}
		/**
		* Render the HTML design preview.
		* @param props - document content, framework store seat, injected host callbacks, and locale.
		* @returns the preview, or the loading and failure states.
		*/
		function HtmlDesignBody(props) {
			const { content, resourceAddress, useStore, loadReview, saveReview, applyToFile, fileRefOf, actions, t } = props;
			const state = useStore((selector) => selector);
			const frameRef = (0, react.useRef)(null);
			const stageRef = (0, react.useRef)(null);
			const focusReturnRef = (0, react.useRef)(null);
			const [editorPlacement, setEditorPlacement] = (0, react.useState)(null);
			const [draftStyle, setDraftStyle] = (0, react.useState)({});
			const [computed, setComputed] = (0, react.useState)({});
			const [draftText, setDraftText] = (0, react.useState)("");
			const [textEdits, setTextEdits] = (0, react.useState)({});
			const [fileWrite, setFileWrite] = (0, react.useState)({
				kind: "idle",
				detail: ""
			});
			const [frameResource, setFrameResource] = (0, react.useState)(null);
			const [resolvedFile, setResolvedFile] = (0, react.useState)(null);
			const fileRef = (0, react.useMemo)(() => fileRefOf(resourceAddress), [fileRefOf, resourceAddress]);
			const hostPath = resolvedFile?.address === resourceAddress ? resolvedFile.path : void 0;
			const source = (0, react.useMemo)(() => content.kind === "bytes" ? buildPreviewDocument(content.data) : void 0, [content]);
			(0, react.useEffect)(() => {
				if (source === void 0) return;
				const url = URL.createObjectURL(new Blob([source], { type: "text/html;charset=utf-8" }));
				setFrameResource({
					source,
					url
				});
				return () => {
					URL.revokeObjectURL(url);
				};
			}, [source]);
			/** Adopt an element selection reported by the frame. */
			const selectAnchor = (0, react.useCallback)((anchor) => {
				actions.select(toAnchor(anchor));
				setComputed(anchor.computed);
				if (state.mode === "inspect") {
					focusReturnRef.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : frameRef.current;
					setDraftStyle(state.document?.edits.find((edit) => edit.selector === anchor.selector)?.declarations ?? {});
					setDraftText(textEdits[anchor.selector] ?? anchor.text);
					if (state.panelOpen) actions.togglePanel();
					actions.setOpen(true);
				}
			}, [
				actions,
				state.mode,
				state.document,
				state.panelOpen,
				textEdits
			]);
			const closeEditor = (0, react.useCallback)(() => {
				actions.setOpen(false);
				window.requestAnimationFrame(() => {
					const previous = focusReturnRef.current;
					if (previous?.isConnected) previous.focus();
					else frameRef.current?.focus();
				});
			}, [actions]);
			(0, react.useLayoutEffect)(() => {
				const stage = stageRef.current;
				if (!state.open || stage === null) {
					setEditorPlacement(null);
					return;
				}
				let frame = 0;
				const update = () => {
					setEditorPlacement(placeEditor(stage));
				};
				const schedule = () => {
					window.cancelAnimationFrame(frame);
					frame = window.requestAnimationFrame(update);
				};
				update();
				const observer = new ResizeObserver(schedule);
				observer.observe(stage);
				window.addEventListener("resize", schedule);
				window.document.addEventListener("scroll", schedule, true);
				window.visualViewport?.addEventListener("resize", schedule);
				window.visualViewport?.addEventListener("scroll", schedule);
				return () => {
					observer.disconnect();
					window.cancelAnimationFrame(frame);
					window.removeEventListener("resize", schedule);
					window.document.removeEventListener("scroll", schedule, true);
					window.visualViewport?.removeEventListener("resize", schedule);
					window.visualViewport?.removeEventListener("scroll", schedule);
				};
			}, [state.open]);
			(0, react.useEffect)(() => {
				postToFrame(frameRef.current, {
					kind: "mode",
					mode: state.mode
				});
			}, [
				state.mode,
				source,
				state.reloadToken
			]);
			(0, react.useEffect)(() => {
				if (!state.open) return;
				const closeOnEscape = (event) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						closeEditor();
					}
				};
				window.addEventListener("keydown", closeOnEscape);
				return () => {
					window.removeEventListener("keydown", closeOnEscape);
				};
			}, [state.open, closeEditor]);
			(0, react.useEffect)(() => {
				setResolvedFile(null);
				setTextEdits({});
				setFileWrite({
					kind: "idle",
					detail: ""
				});
				actions.load(null);
				actions.select(null);
				actions.setOpen(false);
				if (fileRef === void 0) {
					actions.endLoad();
					return;
				}
				let active = true;
				actions.beginLoad();
				loadReview(fileRef).then((result) => {
					if (!active) return;
					setResolvedFile({
						address: resourceAddress,
						path: result.path
					});
					actions.load(result.document);
					actions.endLoad();
				}).catch((error) => {
					if (!active) return;
					setResolvedFile(null);
					actions.load(null);
					actions.endLoad();
					setFileWrite({
						kind: "failed",
						detail: error instanceof Error ? error.message : String(error)
					});
				});
				return () => {
					active = false;
				};
			}, [
				fileRef,
				resourceAddress,
				loadReview,
				actions
			]);
			(0, react.useEffect)(() => {
				const edits = state.document?.edits ?? [];
				for (const edit of edits) postToFrame(frameRef.current, {
					kind: "style",
					selector: edit.selector,
					declarations: edit.declarations
				});
			}, [state.document, state.reloadToken]);
			(0, react.useEffect)(() => {
				const listener = (event) => {
					if (event.source !== frameRef.current?.contentWindow) return;
					const data = event.data;
					if (typeof data !== "object" || data === null) return;
					const message = data;
					if (message.channel !== "dsh-web-design") return;
					switch (message.kind) {
						case "ready":
							postToFrame(frameRef.current, {
								kind: "mode",
								mode: state.mode
							});
							for (const edit of state.document?.edits ?? []) postToFrame(frameRef.current, {
								kind: "style",
								selector: edit.selector,
								declarations: edit.declarations
							});
							for (const [selector, value] of Object.entries(textEdits)) postToFrame(frameRef.current, {
								kind: "text",
								selector,
								value
							});
							return;
						case "hover":
							actions.setHovered(message.selector === null || message.selector === void 0 || message.tag === null || message.tag === void 0 ? null : {
								selector: message.selector,
								tag: message.tag
							});
							return;
						case "select":
							if (message.anchor !== void 0) selectAnchor(message.anchor);
							return;
						default: return;
					}
				};
				window.addEventListener("message", listener);
				return () => {
					window.removeEventListener("message", listener);
				};
			}, [
				actions,
				selectAnchor,
				state.mode,
				state.document,
				textEdits
			]);
			/** Write the current review to the Host. */
			const persist = (0, react.useCallback)(async (next) => {
				if (fileRef === void 0 || hostPath === void 0) return;
				const canonical = {
					...next,
					file: hostPath
				};
				actions.beginSave();
				try {
					await saveReview(fileRef, canonical);
					actions.endSave(canonical);
				} catch (error) {
					actions.failSave(error instanceof Error ? error.message : String(error));
				}
			}, [
				fileRef,
				hostPath,
				saveReview,
				actions
			]);
			/** The document with one edit applied, replacing any prior edit for the selector. */
			const withEdit = (0, react.useCallback)((edit, path) => {
				const base = state.document ?? {
					version: 1,
					file: path,
					comments: [],
					edits: [],
					updatedAt: edit.updatedAt
				};
				return {
					...base,
					edits: [...base.edits.filter((existing) => existing.selector !== edit.selector), edit],
					updatedAt: edit.updatedAt
				};
			}, [state.document]);
			const submitComment = (0, react.useCallback)(() => {
				if (hostPath === void 0) return;
				const body = state.draft.trim();
				if (body.length === 0) return;
				const comment = {
					id: commentId(),
					kind: state.region === null ? "element" : "region",
					...state.selected === null ? {} : { element: state.selected },
					...state.region === null ? {} : { region: state.region },
					body,
					severity: state.draftSeverity,
					resolved: false,
					createdAt: (/* @__PURE__ */ new Date()).toISOString()
				};
				actions.addComment(comment);
				actions.setDraft("");
				actions.setRegion(null);
				persist({
					...state.document ?? emptyFor(hostPath),
					comments: [...state.document?.comments ?? [], comment],
					updatedAt: comment.createdAt
				});
			}, [
				state.draft,
				state.draftSeverity,
				state.region,
				state.selected,
				state.document,
				hostPath,
				actions,
				persist
			]);
			const saveSelection = (0, react.useCallback)(() => {
				const selector = state.selectedSelector;
				if (selector === null || hostPath === void 0) return;
				const declarations = Object.fromEntries(Object.entries(draftStyle).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value.length > 0));
				const previous = state.document?.edits.find((edit) => edit.selector === selector);
				if (!sameDeclarations(previous?.declarations ?? {}, declarations)) {
					if (Object.keys(declarations).length > 0) {
						const edit = {
							selector,
							declarations,
							updatedAt: (/* @__PURE__ */ new Date()).toISOString()
						};
						actions.upsertEdit(edit);
						persist(withEdit(edit, hostPath));
						if (previous !== void 0 && Object.keys(previous.declarations).some((key) => !(key in declarations))) actions.requestReload();
						else postToFrame(frameRef.current, {
							kind: "style",
							selector,
							declarations
						});
					} else {
						actions.removeEdit(selector);
						persist(withoutEdit(state.document, selector, hostPath));
						actions.requestReload();
					}
				}
				if (state.selected !== null && draftText !== state.selected.text) {
					postToFrame(frameRef.current, {
						kind: "text",
						selector,
						value: draftText
					});
					setTextEdits((current) => ({
						...current,
						[selector]: draftText
					}));
				}
				closeEditor();
			}, [
				draftStyle,
				draftText,
				state.selectedSelector,
				state.selected,
				state.document,
				hostPath,
				actions,
				persist,
				withEdit,
				closeEditor
			]);
			const resetStyle = (0, react.useCallback)(() => {
				setDraftStyle({});
			}, []);
			/**
			* Write the reviewer's edits into the file itself.
			*
			* This is deliberately explicit: the review sidecar accumulates edits as the
			* reviewer works, and only this action changes the artifact. The Host applies
			* each edit as a span rewrite, so the result is reported back — including any
			* selector it could not locate in the source, which the reviewer must know
			* about rather than discover later.
			*/
			const saveToFile = (0, react.useCallback)(() => {
				if (fileRef === void 0 || hostPath === void 0) return;
				const edits = state.document?.edits ?? [];
				if (edits.length === 0 && Object.keys(textEdits).length === 0) {
					setFileWrite({
						kind: "idle",
						detail: ""
					});
					return;
				}
				setFileWrite({
					kind: "saving",
					detail: ""
				});
				applyToFile({
					file: fileRef,
					edits,
					textEdits
				}).then((result) => {
					if (result.skipped.length > 0) {
						setFileWrite({
							kind: "partial",
							detail: result.skipped.map((entry) => entry.selector).join(", ")
						});
						return;
					}
					setFileWrite({
						kind: "saved",
						detail: String(result.bytes)
					});
					setTextEdits({});
				}).catch((error) => {
					setFileWrite({
						kind: "failed",
						detail: error instanceof Error ? error.message : String(error)
					});
				});
			}, [
				fileRef,
				hostPath,
				state.document,
				textEdits,
				applyToFile
			]);
			const hasFileEdits = (state.document?.edits.length ?? 0) > 0 || Object.keys(textEdits).length > 0;
			if (content.kind !== "bytes") return null;
			if (source === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: HtmlDesignBody_module_css_default.status,
				role: "alert",
				children: t("failed")
			});
			if (frameResource?.source !== source) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: HtmlDesignBody_module_css_default.status,
				role: "status",
				children: t("loading")
			});
			const document = state.document;
			const comments = document?.comments ?? [];
			const edits = document?.edits ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: HtmlDesignBody_module_css_default.preview,
				"data-html-design-surface": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: HtmlDesignBody_module_css_default.toolbar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: HtmlDesignBody_module_css_default.modes,
							role: "group",
							"aria-label": t("modes"),
							children: MODES.map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
								active: state.mode === mode,
								"aria-pressed": state.mode === mode,
								onClick: () => {
									actions.setMode(mode);
									actions.setOpen(false);
									if (mode === "inspect" && state.panelOpen) actions.togglePanel();
									if ((mode === "comment" || mode === "annotate") && !state.panelOpen) actions.togglePanel();
								},
								children: modeLabel(mode, t)
							}, mode))
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: HtmlDesignBody_module_css_default.toolbarEnd,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: state.error !== null ? "danger" : state.dirty ? "warning" : "neutral",
									children: state.saving ? t("saving") : state.error !== null ? t("saveFailed") : state.dirty ? t("unsaved") : t("saved")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: t("saveToFileHint"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "primary",
										size: "sm",
										disabled: hostPath === void 0 || !hasFileEdits || fileWrite.kind === "saving",
										onClick: saveToFile,
										children: fileWrite.kind === "saving" ? t("saving") : t("saveToFile")
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									onClick: () => actions.requestReload(),
									children: t("reload")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									size: "sm",
									"aria-expanded": state.panelOpen,
									onClick: () => actions.togglePanel(),
									children: state.panelOpen ? t("hidePanel") : t("showPanel")
								})
							]
						})]
					}),
					(state.error !== null || fileWrite.kind === "failed" || fileWrite.kind === "partial" || fileWrite.kind === "saved") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: HtmlDesignBody_module_css_default.notice,
						role: state.error !== null || fileWrite.kind === "failed" ? "alert" : "status",
						children: state.error ?? (fileWrite.kind === "failed" ? fileWrite.detail : fileWrite.kind === "partial" ? `${t("filePartial")}: ${fileWrite.detail}` : t("fileSaved"))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: HtmlDesignBody_module_css_default.workspace,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								ref: stageRef,
								className: HtmlDesignBody_module_css_default.stage,
								"data-html-design-stage": true,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
									ref: frameRef,
									className: HtmlDesignBody_module_css_default.frame,
									src: frameResource.url,
									sandbox: "allow-scripts allow-forms allow-popups allow-modals",
									title: t("frame"),
									"data-html-design-preview": true
								}, state.reloadToken)
							}),
							state.open && state.selected !== null && editorPlacement !== null && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: HtmlDesignBody_module_css_default.editor,
								role: "dialog",
								"aria-label": t("editElement"),
								"data-html-design-editor": true,
								"data-placement": editorPlacement.side,
								"data-compact": editorPlacement.width < 390 ? "" : void 0,
								style: {
									left: editorPlacement.left,
									top: editorPlacement.top,
									width: editorPlacement.width,
									maxHeight: editorPlacement.maxHeight
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: HtmlDesignBody_module_css_default.editorHeader,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: HtmlDesignBody_module_css_default.editorIdentity,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: HtmlDesignBody_module_css_default.elementTag,
												children: state.selected.tag.toUpperCase()
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: HtmlDesignBody_module_css_default.editorSelector,
												children: state.selected.selector
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "ghost",
											size: "sm",
											"aria-label": t("closeEditor"),
											onClick: closeEditor,
											children: "×"
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: HtmlDesignBody_module_css_default.editorScroll,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
												className: HtmlDesignBody_module_css_default.section,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
													className: HtmlDesignBody_module_css_default.sectionTitle,
													children: t("content")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: HtmlDesignBody_module_css_default.field,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: HtmlDesignBody_module_css_default.fieldLabel,
														children: t("textContent")
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
														autoFocus: true,
														value: draftText,
														onChange: (event) => setDraftText(event.target.value)
													})]
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
												className: HtmlDesignBody_module_css_default.section,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
													className: HtmlDesignBody_module_css_default.sectionTitle,
													children: t("styles")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: HtmlDesignBody_module_css_default.fields,
													children: STYLE_FIELDS.map((field) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: HtmlDesignBody_module_css_default.field,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: HtmlDesignBody_module_css_default.fieldLabel,
															children: t(field.label)
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
															value: draftStyle[field.key] ?? "",
															placeholder: computed[field.key] ?? "",
															onChange: (event) => {
																const value = event.target.value;
																setDraftStyle((current) => ({
																	...current,
																	[field.key]: value
																}));
															}
														})]
													}, field.key))
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
												className: HtmlDesignBody_module_css_default.meta,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("size") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
													Math.round(state.selected.rect.width),
													" × ",
													Math.round(state.selected.rect.height)
												] })]
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: HtmlDesignBody_module_css_default.editorFooter,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												variant: "ghost",
												size: "sm",
												onClick: resetStyle,
												children: t("resetStyle")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: HtmlDesignBody_module_css_default.footerSpace }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												variant: "outline",
												size: "sm",
												onClick: closeEditor,
												children: t("cancel")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												variant: "primary",
												size: "sm",
												disabled: hostPath === void 0,
												onClick: saveSelection,
												children: t("save")
											})
										]
									})
								]
							}), window.document.body),
							state.panelOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
								className: HtmlDesignBody_module_css_default.panel,
								children: [
									state.mode === "annotate" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: HtmlDesignBody_module_css_default.hint,
										children: t("annotateHint")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: HtmlDesignBody_module_css_default.section,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
											className: HtmlDesignBody_module_css_default.sectionTitle,
											children: t("selectedElement")
										}), state.selected === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: HtmlDesignBody_module_css_default.muted,
											children: t("noSelection")
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
											className: HtmlDesignBody_module_css_default.meta,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("selector") }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
													className: HtmlDesignBody_module_css_default.mono,
													children: state.selected.selector
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("tag") }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
													className: HtmlDesignBody_module_css_default.mono,
													children: state.selected.tag
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("size") }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
													Math.round(state.selected.rect.width),
													" × ",
													Math.round(state.selected.rect.height)
												] }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("text") }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: state.selected.text.length > 0 ? state.selected.text : "—" })
											]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: HtmlDesignBody_module_css_default.section,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
												className: HtmlDesignBody_module_css_default.sectionTitle,
												children: [
													t("comments"),
													" ",
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: HtmlDesignBody_module_css_default.count,
														children: comments.length
													})
												]
											}),
											comments.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: HtmlDesignBody_module_css_default.muted,
												children: t("emptyComments")
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
												className: HtmlDesignBody_module_css_default.list,
												children: comments.map((comment) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
													className: clsx(HtmlDesignBody_module_css_default.comment, comment.resolved && HtmlDesignBody_module_css_default.resolved),
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: HtmlDesignBody_module_css_default.commentHead,
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
																tone: severityTone(comment.severity),
																children: t(severityLabel(comment.severity))
															}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: HtmlDesignBody_module_css_default.mono,
																children: comment.element?.selector ?? comment.kind
															})]
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: HtmlDesignBody_module_css_default.commentBody,
															children: comment.body
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: HtmlDesignBody_module_css_default.commentActions,
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
																variant: "ghost",
																onClick: () => actions.toggleResolved(comment.id),
																children: comment.resolved ? t("unresolve") : t("resolve")
															}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
																variant: "ghost",
																onClick: () => actions.removeComment(comment.id),
																children: t("remove")
															})]
														})
													]
												}, comment.id))
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: HtmlDesignBody_module_css_default.draft,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: HtmlDesignBody_module_css_default.severities,
														children: SEVERITIES.map((severity) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
															active: state.draftSeverity === severity,
															onClick: () => actions.setDraftSeverity(severity),
															children: t(severityLabel(severity))
														}, severity))
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
														value: state.draft,
														placeholder: t("commentPlaceholder"),
														onChange: (event) => actions.setDraft(event.target.value)
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: HtmlDesignBody_module_css_default.actions,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
															variant: "primary",
															disabled: hostPath === void 0,
															onClick: submitComment,
															children: t("submitComment")
														}), state.region !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
															variant: "ghost",
															onClick: () => actions.setRegion(null),
															children: t("clearRegion")
														})]
													})
												]
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: HtmlDesignBody_module_css_default.section,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
											className: HtmlDesignBody_module_css_default.sectionTitle,
											children: [
												t("styles"),
												" ",
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: HtmlDesignBody_module_css_default.count,
													children: edits.length
												})
											]
										}), edits.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: HtmlDesignBody_module_css_default.muted,
											children: t("emptyEdits")
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
											className: HtmlDesignBody_module_css_default.list,
											children: edits.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
												className: HtmlDesignBody_module_css_default.edit,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: HtmlDesignBody_module_css_default.mono,
													children: item.selector
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
													label: JSON.stringify(item.declarations),
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: HtmlDesignBody_module_css_default.count,
														children: Object.keys(item.declarations).length
													})
												})]
											}, item.selector))
										})]
									})
								]
							})
						]
					})
				]
			});
		}
		/** Post one message into the frame, tolerating a frame that is not mounted yet. */
		function postToFrame(frame, message) {
			frame?.contentWindow?.postMessage({
				channel: CHANNEL,
				...message
			}, "*");
		}
		/** Convert a frame-reported anchor into the stored shape. */
		function toAnchor(anchor) {
			return {
				selector: anchor.selector,
				tag: anchor.tag,
				...anchor.id === void 0 ? {} : { id: anchor.id },
				classes: anchor.classes,
				text: anchor.text,
				rect: anchor.rect
			};
		}
		/** Compare editable declarations without depending on their insertion order. */
		function sameDeclarations(left, right) {
			const leftKeys = Object.keys(left);
			return leftKeys.length === Object.keys(right).length && leftKeys.every((key) => left[key] === right[key]);
		}
		/** Remove a selector's edit from the sidecar when the user saves cleared style fields. */
		function withoutEdit(document, selector, hostPath) {
			const base = document ?? emptyFor(hostPath);
			return {
				...base,
				edits: base.edits.filter((edit) => edit.selector !== selector),
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			};
		}
		/** An empty review document for a resolved file. */
		function emptyFor(hostPath) {
			return {
				version: 1,
				file: hostPath,
				comments: [],
				edits: [],
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			};
		}
		/** Locale key for a mode's label. */
		function modeLabel(mode, t) {
			switch (mode) {
				case "browse": return t("modeBrowse");
				case "inspect": return t("modeInspect");
				case "comment": return t("modeComment");
				case "annotate": return t("modeAnnotate");
			}
		}
		/** Locale key for a severity's label. */
		function severityLabel(severity) {
			switch (severity) {
				case "note": return "severityNote";
				case "nit": return "severityNit";
				case "issue": return "severityIssue";
				case "blocker": return "severityBlocker";
			}
		}
		/** Tag tone for a severity. */
		function severityTone(severity) {
			switch (severity) {
				case "note": return "neutral";
				case "nit": return "info";
				case "issue": return "warning";
				case "blocker": return "danger";
			}
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Copy for the Sidebar HTML design preview.
		*
		* Every product-visible string the preview renders lives here; components read
		* them through the slot's `t` seat. Values are plain strings because the locale
		* dictionary contract is `Record<key, string>`.
		*
		* @module @guowenzhang/dsh-web-design/client/locales
		*/
		/** Copy namespace of this preview. */
		const NS = "sidebarWebDesign";
		/** Simplified Chinese copy. */
		const zh = {
			title: "网页设计预览",
			editElement: "编辑元素",
			closeEditor: "关闭编辑弹窗",
			content: "内容",
			cancel: "取消",
			save: "保存",
			modes: "预览工具",
			showPanel: "查看评论",
			hidePanel: "收起评论",
			loading: "正在打开预览…",
			failed: "无法渲染这个 HTML 文件。",
			frame: "网页设计预览",
			modeBrowse: "预览",
			modeInspect: "编辑",
			modeComment: "评论",
			modeAnnotate: "标注",
			reload: "重新加载",
			saveToFile: "保存到文件",
			saveToFileHint: "把样式与文本修改写入这个 HTML 文件本身",
			fileSaved: "已写入文件。",
			filePartial: "部分修改未能定位",
			saving: "正在保存…",
			saved: "已保存",
			unsaved: "未保存",
			saveFailed: "保存失败",
			noSelection: "未选中元素",
			selectedElement: "选中元素",
			selector: "选择器",
			tag: "标签",
			size: "尺寸",
			text: "文本",
			textContent: "文本内容",
			fontSize: "字号",
			fontWeight: "字重",
			lineHeight: "行高",
			letterSpacing: "字距",
			color: "文字颜色",
			background: "背景色",
			padding: "内边距",
			margin: "外边距",
			borderRadius: "圆角",
			resetStyle: "重置",
			comments: "评论",
			styles: "样式修改",
			commentPlaceholder: "写点什么…",
			submitComment: "提交",
			resolve: "标记已解决",
			unresolve: "重新打开",
			remove: "删除",
			severityNote: "备注",
			severityNit: "细节",
			severityIssue: "问题",
			severityBlocker: "阻塞",
			annotateHint: "在预览上拖拽框选区域，然后写评论。",
			clearRegion: "清除选区",
			emptyComments: "还没有评论。",
			emptyEdits: "还没有样式修改。"
		};
		/** English copy. */
		const en = {
			title: "Web design preview",
			editElement: "Edit element",
			closeEditor: "Close edit dialog",
			content: "Content",
			cancel: "Cancel",
			save: "Save",
			modes: "Preview tools",
			showPanel: "Show comments",
			hidePanel: "Hide comments",
			loading: "Opening preview…",
			failed: "This HTML file could not be rendered.",
			frame: "Web design preview",
			modeBrowse: "Preview",
			modeInspect: "Edit",
			modeComment: "Comment",
			modeAnnotate: "Annotate",
			reload: "Reload",
			saveToFile: "Save to file",
			saveToFileHint: "Write the style and text edits into this HTML file",
			fileSaved: "Written to the file.",
			filePartial: "Some edits could not be located",
			saving: "Saving…",
			saved: "Saved",
			unsaved: "Unsaved",
			saveFailed: "Save failed",
			noSelection: "No element selected",
			selectedElement: "Selected element",
			selector: "Selector",
			tag: "Tag",
			size: "Size",
			text: "Text",
			textContent: "Text content",
			fontSize: "Font size",
			fontWeight: "Font weight",
			lineHeight: "Line height",
			letterSpacing: "Letter spacing",
			color: "Text color",
			background: "Background",
			padding: "Padding",
			margin: "Margin",
			borderRadius: "Corner radius",
			resetStyle: "Reset",
			comments: "Comments",
			styles: "Style edits",
			commentPlaceholder: "Write a comment…",
			submitComment: "Submit",
			resolve: "Mark resolved",
			unresolve: "Reopen",
			remove: "Delete",
			severityNote: "Note",
			severityNit: "Nit",
			severityIssue: "Issue",
			severityBlocker: "Blocker",
			annotateHint: "Drag on the preview to frame a region, then write a comment.",
			clearRegion: "Clear region",
			emptyComments: "No comments yet.",
			emptyEdits: "No style edits yet."
		};
		//#endregion
		//#region src/client/index.ts
		/** Implementation identity, shared by the registry entry and the keyed slot. */
		const HTML_DESIGN_ID = "@guowenzhang/dsh-web-design/html";
		/** Required browser services: the slot registry, the document registry, copy, and the Remote. */
		const inject = [
			"slots",
			"locale",
			"documentPreviews",
			"remote"
		];
		/** Unwrap a Typert `RemoteResult` or surface the Host failure. */
		async function unwrapRemote(call) {
			const result = await call();
			if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
			return result.value;
		}
		/**
		* Mount the review Remote, register the dictionary, the document metadata, and
		* the preview body.
		* @param ctx - client root context carrying the registries and copy.
		* @returns once every registration is installed.
		*/
		async function apply(ctx) {
			const disposeMount = await ctx.remote.$mount(TYPERT_REMOTE);
			ctx.effect(() => () => disposeMount(), "dsh-web-design: remote mount");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-web-design: dictionaries");
			const t = ctx.locale.bind(NS);
			const namespace = () => {
				const mounted = ctx.get(`remote.${REMOTE_NAMESPACE}`);
				if (mounted === void 0) throw new Error(`${REMOTE_NAMESPACE} namespace service is not mounted`);
				return mounted;
			};
			ctx.effect(() => ctx.documentPreviews.register({
				id: HTML_DESIGN_ID,
				extensions: ["html", "htm"],
				priority: "extension",
				title: () => t("title"),
				loading: "bytes-complete",
				wrap: false
			}), "dsh-web-design: document metadata");
			const store = createDesignStore("");
			ctx.effect(() => ctx.slots.inject("sidebar.right.tab.document", () => ctx.slots.register({
				name: "sidebar.right.tab.document",
				key: HTML_DESIGN_ID,
				locale: NS,
				store,
				inject: () => ({
					loadReview: async (file) => await unwrapRemote(() => namespace().read({ file })),
					saveReview: async (file, document) => {
						await unwrapRemote(() => namespace().write({
							file,
							document
						}));
					},
					applyToFile: async (request) => await unwrapRemote(() => namespace().apply(request)),
					fileRefOf
				})
			}, HtmlDesignBody)), "dsh-web-design: preview body");
		}
		/**
		* Parse the Session address of one previewed file.
		*
		* The Host uses the Session to resolve a relative path; an absolute address
		* carries no Session and leaves this preview read-only.
		* @param address - the tab's resource address.
		* @returns the Session and path the Host receives, or `undefined`.
		*/
		function fileRefOf(address) {
			const parsed = parseFileAddress(address);
			if (parsed?.scope !== "session") return void 0;
			return {
				sessionId: parsed.sessionId,
				path: parsed.path
			};
		}
		//#endregion
		exports.HTML_DESIGN_ID = HTML_DESIGN_ID;
		exports.NS = NS;
		exports.apply = apply;
		exports.createDesignStore = createDesignStore;
		exports.fileRefOf = fileRefOf;
		exports.inject = inject;
		return module.exports;
	}
});
