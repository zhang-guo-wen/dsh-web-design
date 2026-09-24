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
		//#region src/client/frame-runtime.ts
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
		const CHANNEL = "dsh-web-design";
		/**
		* Render the runtime script for one frame.
		*
		* The script is a plain function stringified into the document. It runs once,
		* installs capture-phase listeners for edit gestures, and
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
			let selected = null;
			let selectedSelector = null;
			const originalSelectors = /* @__PURE__ */ new WeakMap();
			const originalParents = /* @__PURE__ */ new WeakMap();
			const originalTargets = /* @__PURE__ */ new Map();
			const ambiguousSelectors = /* @__PURE__ */ new Set();
			const originalSource = /* @__PURE__ */ new WeakMap();
			const editableTextTargets = /* @__PURE__ */ new WeakMap();
			let selectorsFrozen = false;
			let overlay = null;
			let box = null;
			let drag = null;
			let handle = null;
			const post = (message) => {
				try {
					globalThis.parent?.postMessage({
						channel,
						...message
					}, "*");
				} catch (error) {}
			};
			/** Build a selector path that still resolves when ids repeat or need escaping. */
			const currentSelectorFor = (element) => {
				const parts = [];
				let current = element;
				while (current !== null && current !== doc.documentElement) {
					const tag = current.tagName.toLowerCase();
					const id = current.getAttribute("id");
					if (id !== null && /^[a-z_][a-z0-9_-]*$/iu.test(id) && doc.querySelectorAll("#" + id).length === 1) {
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
			const selectorFor = (element) => originalSelectors.get(element) ?? currentSelectorFor(element);
			const normalizedText = (element) => (element.textContent ?? "").replace(/\s+/g, " ").trim();
			const sourceFor = (element) => {
				let source = originalSource.get(element);
				if (source === void 0) {
					source = {
						text: normalizedText(element),
						classes: Array.from(element.classList)
					};
					originalSource.set(element, source);
				}
				return source;
			};
			for (const element of doc.querySelectorAll("*")) sourceFor(element);
			/** Freeze paths before the first removal so sibling positions keep their original meaning. */
			const freezeSelectors = () => {
				if (selectorsFrozen) return;
				for (const element of doc.querySelectorAll("*")) {
					if (element.closest("[data-dsh-design-overlay],[data-dsh-design-box]") !== null) continue;
					const selector = currentSelectorFor(element);
					originalSelectors.set(element, selector);
					originalParents.set(element, element.parentElement);
					if (ambiguousSelectors.has(selector)) continue;
					try {
						const matches = doc.querySelectorAll(selector);
						if (matches.length !== 1 || matches[0] !== element || originalTargets.has(selector)) {
							originalTargets.delete(selector);
							ambiguousSelectors.add(selector);
							continue;
						}
					} catch (error) {
						ambiguousSelectors.add(selector);
						continue;
					}
					originalTargets.set(selector, element);
				}
				selectorsFrozen = true;
			};
			const resolve = (selector) => {
				if (selector === selectedSelector) return selected?.isConnected ? selected : null;
				if (selectorsFrozen) {
					const element = originalTargets.get(selector);
					return element?.isConnected ? element : null;
				}
				try {
					const matches = doc.querySelectorAll(selector);
					return matches.length === 1 ? matches[0] ?? null : null;
				} catch (error) {
					return null;
				}
			};
			const anchorFor = (element, selector = selectorFor(element)) => {
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
					"height",
					"position",
					"left",
					"top",
					"translate"
				]) {
					const value = computed?.getPropertyValue(key);
					if (typeof value === "string" && value.length > 0) style[key] = value;
				}
				const id = element.getAttribute("id");
				const source = sourceFor(element);
				return {
					selector,
					parentSelector: element.parentElement === null ? null : selectorFor(element.parentElement),
					tag: element.tagName.toLowerCase(),
					...id === null ? {} : { id },
					classes: Array.from(element.classList),
					text: textOf(element),
					sourceText: source.text,
					sourceClasses: source.classes,
					editableText: editableTextOf(element),
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
				const raw = normalizedText(element);
				return raw.length > 160 ? raw.slice(0, 160) + "…" : raw;
			};
			/** Locate the only non-blank direct text node without crossing into child elements. */
			const editableTextNodeOf = (element) => {
				if (/^(?:script|style|textarea|template|noscript)$/iu.test(element.tagName)) return null;
				const previous = editableTextTargets.get(element);
				if (previous?.parentNode === element) return previous;
				const directText = Array.from(element.childNodes).filter((child) => child.nodeType === 3);
				const meaningful = directText.filter((child) => (child.textContent ?? "").trim() !== "");
				const target = meaningful.length === 1 ? meaningful[0] : directText.length === 1 ? directText[0] : void 0;
				if (target !== void 0) editableTextTargets.set(element, target);
				return target ?? null;
			};
			const editableTextOf = (element) => editableTextNodeOf(element)?.textContent ?? null;
			const lengthTerm = /^(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%|em|rem|vw|vh|vmin|vmax)?|calc\(.+\))$/iu;
			/** Split a computed translate value without breaking spaces inside calc(). */
			const translateParts = (value) => {
				if (value === "" || value === "none") return {
					x: "0px",
					y: "0px",
					z: null
				};
				const parts = [];
				let depth = 0;
				let start = 0;
				for (let index = 0; index < value.length; index += 1) {
					const char = value[index];
					if (char === "(") depth += 1;
					else if (char === ")") depth -= 1;
					else if (depth === 0 && /\s/u.test(char ?? "")) {
						if (index > start) parts.push(value.slice(start, index));
						start = index + 1;
					}
					if (depth < 0) return null;
				}
				if (depth !== 0) return null;
				if (start < value.length) parts.push(value.slice(start));
				if (parts.length < 1 || parts.length > 3) return null;
				if (!parts.every((part) => lengthTerm.test(part))) return null;
				return {
					x: parts[0],
					y: parts[1] ?? "0px",
					z: parts[2] ?? null
				};
			};
			/** Resolve one side of a relatively positioned inline element. */
			const positionBase = (leading, trailing) => {
				if (leading !== "" && leading !== "auto") return lengthTerm.test(leading) ? leading : null;
				if (trailing !== "" && trailing !== "auto") return lengthTerm.test(trailing) ? "calc(0px - " + trailing + ")" : null;
				return "0px";
			};
			const offset = (base, delta) => {
				if (delta === 0) return base;
				if (base === "0px") return delta + "px";
				return "calc(" + base + (delta < 0 ? " - " : " + ") + Math.abs(delta) + "px)";
			};
			const restoreDragStyles = (active) => {
				for (const [property, value] of Object.entries(active.restore)) if (value === "") active.element.style.removeProperty(property);
				else active.element.style.setProperty(property, value, active.priorities[property] ?? "");
			};
			const stopDrag = (commit) => {
				const active = drag;
				if (active === null) return;
				drag = null;
				if (handle !== null) handle.style.cursor = "grab";
				if (!commit || active.declarations === null) {
					restoreDragStyles(active);
					place(box, selected?.isConnected ? selected : null);
					return;
				}
				post({
					kind: "move",
					selector: active.selector,
					declarations: active.declarations,
					restore: active.restore,
					anchor: anchorFor(active.element, active.selector)
				});
			};
			const removable = (element) => element.isConnected && element.ownerDocument === doc && element.parentElement !== null && !/^(?:html|head|body)$/iu.test(element.tagName) && element.closest("[data-dsh-design-overlay],[data-dsh-design-box]") === null;
			const originallyWithin = (element, ancestor) => {
				let current = element;
				while (current !== null) {
					if (current === ancestor) return true;
					current = originalParents.get(current) ?? null;
				}
				return false;
			};
			const removeElement = (element) => {
				stopDrag(false);
				const removedSelectors = /* @__PURE__ */ new Set();
				for (const [selector, original] of originalTargets) if (originallyWithin(original, element)) removedSelectors.add(selector);
				for (const descendant of [element, ...element.querySelectorAll("*")]) {
					const selector = originalSelectors.get(descendant);
					if (selector !== void 0) removedSelectors.add(selector);
				}
				if (selected !== null && (element === selected || element.contains(selected))) {
					selected = null;
					selectedSelector = null;
					if (box !== null) place(box, null);
				}
				if (hovered !== null && (element === hovered || element.contains(hovered))) {
					hovered = null;
					if (overlay !== null) place(overlay, null);
					post({
						kind: "hover",
						selector: null,
						tag: null
					});
				}
				element.remove();
				return Array.from(removedSelectors);
			};
			const handleRemoval = (data, selectedOnly) => {
				const payload = data;
				if (typeof payload.requestId !== "string" || typeof payload.selector !== "string") return;
				let element = null;
				if (selectedOnly) {
					if (mode === "inspect" && selected !== null && removable(selected) && selectedSelector === payload.selector) {
						freezeSelectors();
						if (originalTargets.get(payload.selector) === selected) element = selected;
					}
				} else {
					freezeSelectors();
					const original = originalTargets.get(payload.selector);
					if (original !== void 0 && removable(original)) element = original;
				}
				const removedSelectors = element === null ? [] : removeElement(element);
				post({
					kind: "removeResult",
					requestId: payload.requestId,
					selector: payload.selector,
					success: element !== null,
					removedSelectors
				});
			};
			const ensureChrome = () => {
				if (overlay !== null && box !== null) return;
				overlay = doc.createElement("div");
				overlay.setAttribute("data-dsh-design-overlay", "");
				overlay.style.cssText = "position:absolute;z-index:2147483646;pointer-events:none;border:1px solid #4c8dff;background:rgba(76,141,255,0.12);border-radius:2px;transition:all 60ms linear;display:none";
				box = doc.createElement("div");
				box.setAttribute("data-dsh-design-box", "");
				box.style.cssText = "position:absolute;z-index:2147483647;pointer-events:none;border:2px solid #4c8dff;box-shadow:0 0 0 1px rgba(255,255,255,0.6) inset;display:none";
				handle = doc.createElement("button");
				handle.type = "button";
				handle.setAttribute("data-dsh-design-drag-handle", "");
				handle.textContent = "✥";
				handle.style.cssText = "position:absolute;top:-32px;right:0;width:26px;height:26px;display:grid;place-items:center;padding:0;border:2px solid #4c8dff;border-radius:6px;background:#fff;color:#2459c7;font:18px/1 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);cursor:grab;pointer-events:auto;touch-action:none;user-select:none";
				handle.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
				});
				handle.addEventListener("pointerdown", (event) => {
					if (mode !== "inspect" || drag !== null || selected === null || !selected.isConnected || !(selected instanceof HTMLElement || selected instanceof SVGElement)) return;
					const element = selected;
					const computed = doc.defaultView?.getComputedStyle(element);
					const strategy = element instanceof HTMLElement && computed?.display === "inline" ? "inline" : "translate";
					const properties = strategy === "inline" ? [
						"position",
						"left",
						"top"
					] : ["translate"];
					const restore = {};
					const priorities = {};
					for (const property of properties) {
						restore[property] = element.style.getPropertyValue(property);
						priorities[property] = element.style.getPropertyPriority(property);
					}
					if (Object.values(priorities).some((priority) => priority === "important")) return;
					let baseX;
					let baseY;
					let baseZ = null;
					if (strategy === "inline") {
						const position = computed?.getPropertyValue("position") || "static";
						if (position !== "static" && position !== "relative") return;
						const x = position === "static" ? "0px" : positionBase(computed?.getPropertyValue("left") ?? "", computed?.getPropertyValue("right") ?? "");
						const y = position === "static" ? "0px" : positionBase(computed?.getPropertyValue("top") ?? "", computed?.getPropertyValue("bottom") ?? "");
						if (x === null || y === null) return;
						baseX = x;
						baseY = y;
					} else {
						const original = restore.translate ?? "";
						if (original !== "" && translateParts(original.trim()) === null) return;
						const baseline = translateParts(computed?.getPropertyValue("translate").trim() || original);
						if (baseline === null) return;
						baseX = baseline.x;
						baseY = baseline.y;
						baseZ = baseline.z;
					}
					event.preventDefault();
					event.stopPropagation();
					drag = {
						pointerId: event.pointerId,
						element,
						selector: selectedSelector ?? selectorFor(element),
						x: event.clientX,
						y: event.clientY,
						strategy,
						baseX,
						baseY,
						baseZ,
						restore,
						priorities,
						declarations: null
					};
					if (handle !== null) handle.style.cursor = "grabbing";
				});
				box.append(handle);
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
				if (node === box && handle !== null) handle.style.top = rect.top < 34 ? rect.height + 6 + "px" : "-32px";
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
			/** A transparent control covers its label; use the pointer position to distinguish text from the box. */
			const editTargetFor = (target, event) => {
				if (!(target instanceof HTMLInputElement) || !/^(?:radio|checkbox)$/iu.test(target.type)) return target;
				const computed = doc.defaultView?.getComputedStyle(target);
				const opacity = Number.parseFloat(computed?.opacity ?? "");
				if (computed?.position !== "absolute" || !Number.isFinite(opacity) || opacity > .01) return target;
				const label = target.closest("label");
				if (label === null) return target;
				const leaves = Array.from(label.querySelectorAll("*")).filter((element) => element.closest("label") === label && editableTextNodeOf(element) !== null && normalizedText(element) !== "");
				if (leaves.length === 0) return label;
				if (event.type !== "mousemove" && event.detail === 0 && leaves.length === 1) return leaves[0];
				const hits = leaves.filter((leaf) => {
					const rect = leaf.getBoundingClientRect();
					return rect.width > 0 && rect.height > 0 && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
				});
				if (hits.length === 1) return hits[0];
				return label;
			};
			const selectTarget = (target, kind) => {
				selected = target;
				selectedSelector = selectorFor(target);
				ensureChrome();
				place(box, target);
				post({
					kind,
					anchor: anchorFor(target, selectedSelector)
				});
			};
			doc.addEventListener("mousemove", (event) => {
				if (mode !== "inspect" || drag !== null) return;
				if (!interactive(event)) return;
				const rawTarget = event.target;
				if (!(rawTarget instanceof Element)) return;
				const target = editTargetFor(rawTarget, event);
				if (target === hovered) return;
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
				if (overlay !== null) place(overlay, null);
				post({
					kind: "hover",
					selector: null,
					tag: null
				});
			}, true);
			doc.addEventListener("pointerdown", (event) => {
				if (mode !== "inspect" || !interactive(event)) return;
				event.preventDefault();
				event.stopPropagation();
			}, true);
			doc.addEventListener("click", (event) => {
				if (mode !== "inspect") return;
				if (!interactive(event)) return;
				const target = event.target;
				if (!(target instanceof Element)) return;
				event.preventDefault();
				event.stopPropagation();
				selectTarget(editTargetFor(target, event), "select");
			}, true);
			doc.addEventListener("dblclick", (event) => {
				if (mode !== "inspect" || !interactive(event)) return;
				const target = event.target;
				if (!(target instanceof Element)) return;
				event.preventDefault();
				event.stopPropagation();
				selectTarget(editTargetFor(target, event), "edit");
			}, true);
			doc.addEventListener("pointermove", (event) => {
				const active = drag;
				if (active === null || active.pointerId !== event.pointerId) return;
				event.preventDefault();
				event.stopPropagation();
				if (!active.element.isConnected) {
					stopDrag(false);
					return;
				}
				const dx = Math.round(event.clientX - active.x);
				const dy = Math.round(event.clientY - active.y);
				if (dx === 0 && dy === 0) {
					if (active.declarations !== null) {
						restoreDragStyles(active);
						active.declarations = null;
						place(box, active.element);
					}
					return;
				}
				const x = offset(active.baseX, dx);
				const y = offset(active.baseY, dy);
				const declarations = active.strategy === "inline" ? {
					position: "relative",
					left: x,
					top: y
				} : { translate: x + " " + y + (active.baseZ === null ? "" : " " + active.baseZ) };
				for (const [property, value] of Object.entries(declarations)) active.element.style.setProperty(property, value);
				active.declarations = declarations;
				place(box, active.element);
			}, true);
			doc.addEventListener("pointerup", (event) => {
				if (drag === null || drag.pointerId !== event.pointerId) return;
				event.preventDefault();
				event.stopPropagation();
				stopDrag(true);
			}, true);
			doc.addEventListener("pointercancel", (event) => {
				if (drag === null || drag.pointerId !== event.pointerId) return;
				event.preventDefault();
				event.stopPropagation();
				stopDrag(false);
			}, true);
			globalThis.addEventListener("message", (event) => {
				const data = event.data;
				if (typeof data !== "object" || data === null) return;
				const message = data;
				if (message.channel !== channel) return;
				ensureChrome();
				switch (message.kind) {
					case "mode": {
						mode = data.mode === "inspect" ? "inspect" : "browse";
						const label = data.dragHandleLabel;
						if (typeof label === "string" && handle !== null) {
							if (label.trim() === "") {
								handle.removeAttribute("aria-label");
								handle.removeAttribute("title");
							} else {
								handle.setAttribute("aria-label", label);
								handle.title = label;
							}
						}
						if (mode === "browse") {
							stopDrag(false);
							selected = null;
							selectedSelector = null;
							hovered = null;
							place(box, null);
							place(overlay, null);
							post({
								kind: "hover",
								selector: null,
								tag: null
							});
						}
						post({
							kind: "modeApplied",
							mode
						});
						return;
					}
					case "style": {
						const payload = data;
						const element = resolve(payload.selector);
						if (element instanceof HTMLElement || element instanceof SVGElement) {
							for (const [property, value] of Object.entries(payload.declarations)) if (value === "") element.style.removeProperty(property);
							else element.style.setProperty(property, value);
							if (element === selected) place(box, element);
						}
						return;
					}
					case "text": {
						const payload = data;
						const element = resolve(payload.selector);
						const textNode = element === null ? null : editableTextNodeOf(element);
						if (textNode !== null) textNode.textContent = payload.value;
						return;
					}
					case "selectParent": {
						const parent = selected?.parentElement;
						if (mode === "inspect" && parent !== null && parent !== void 0) selectTarget(parent, "edit");
						return;
					}
					case "removeSelected":
						handleRemoval(data, true);
						return;
					case "replayRemoval":
						handleRemoval(data, false);
						return;
					case "highlight": {
						const first = data.selectors.map(resolve).find((element) => element !== null) ?? null;
						place(box, first);
						return;
					}
					case "reset":
						selected = null;
						selectedSelector = null;
						hovered = null;
						stopDrag(false);
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
		* The store holds what the preview renders: the selected element, the review
		* document loaded from the Host, and whether the document has unsaved changes.
		* It is a snapshot store so the render path
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
					loading: true,
					dirty: false,
					saving: false,
					error: null,
					open: false,
					reloadToken: 0
				}),
				actions: {
					setMode: (state, mode) => {
						state.mode = mode;
						if (mode !== "inspect") state.open = false;
					},
					setHovered: (state, hovered) => {
						state.hovered = hovered;
					},
					select: (state, anchor) => {
						state.selected = anchor;
						state.selectedSelector = anchor?.selector ?? null;
					},
					load: (state, document) => {
						state.document = document;
						state.dirty = false;
						state.error = null;
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
					removeEdits: (state, selectors) => {
						const current = state.document;
						if (current === null) return;
						const removed = new Set(selectors);
						const edits = current.edits.filter((edit) => !removed.has(edit.selector));
						if (edits.length === current.edits.length) return;
						state.document = {
							...current,
							edits,
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
		const css = ".YFfwAG_preview{box-sizing:border-box;width:100%;height:100%;min-height:300px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,system-ui, sans-serif);white-space:normal;flex-direction:column;display:flex;container-type:inline-size}.YFfwAG_toolbar{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex-wrap:wrap;flex:none;justify-content:space-between;align-items:center;gap:8px 12px;padding:8px 10px;display:flex}.YFfwAG_toolbarEnd{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.YFfwAG_modeSwitch{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;flex:none;grid-template-columns:repeat(2,minmax(0,1fr));min-width:158px;padding:3px;display:grid;position:relative}.YFfwAG_modeSwitch:before{background:var(--dsw-alias-bg-layer-2);content:\"\";border-radius:999px;width:calc(50% - 3px);height:calc(100% - 6px);transition:transform .16s;position:absolute;top:3px;left:3px;box-shadow:0 1px 5px #00000021}.YFfwAG_modeSwitch[data-mode=inspect]:before{transform:translate(100%)}.YFfwAG_modeOption{z-index:1;min-height:30px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;background:0 0;border:0;border-radius:999px;padding:0 14px;font-size:12px;font-weight:600;position:relative}.YFfwAG_modeOption[aria-pressed=true]{color:var(--dsw-alias-label-primary)}.YFfwAG_modeOption:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}@media (prefers-reduced-motion:reduce){.YFfwAG_modeSwitch:before{transition:none}}.YFfwAG_workspace{background:var(--dsw-alias-interactive-bg-hover-solid);flex:auto;min-height:0;position:relative;overflow:hidden}.YFfwAG_stage{box-sizing:border-box;min-width:0;padding:18px;display:flex;position:absolute;inset:0}.YFfwAG_frame{border:1px solid var(--dsw-alias-border-l2);background:#fff;border-radius:8px;flex:auto;width:100%;min-width:0;height:100%;min-height:0;display:block;box-shadow:0 14px 38px #00000021}.YFfwAG_frame[data-frame-mode-ready=false]{pointer-events:none}.YFfwAG_editor{z-index:1150;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,system-ui, sans-serif);white-space:normal;border-radius:16px;flex-direction:column;display:flex;position:fixed;overflow:hidden;box-shadow:0 18px 52px #00000040}.YFfwAG_editorHeader,.YFfwAG_editorFooter{flex:none;align-items:center;gap:8px;padding:12px 16px;display:flex}.YFfwAG_editorHeader{border-bottom:1px solid var(--dsw-alias-border-l2)}.YFfwAG_editorHeaderActions{flex:none;justify-content:flex-end;align-items:center;gap:10px;display:flex}.YFfwAG_editorHeaderAction{min-height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;text-decoration:underline;text-decoration-color:var(--dsw-alias-border-l2);text-underline-offset:3px;white-space:nowrap;background:0 0;border:0;padding:0;font-size:12px;font-weight:600}.YFfwAG_editorHeaderAction:hover{text-decoration-color:currentColor}.YFfwAG_editorHeaderAction:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}.YFfwAG_editorIdentity{flex:auto;align-items:center;gap:8px;min-width:0;display:flex}.YFfwAG_elementTag{background:var(--dsw-alias-interactive-bg-hover);font-family:var(--dsw-font-mono,ui-monospace, monospace);border-radius:6px;flex:none;padding:4px 7px;font-size:11px;font-weight:700}.YFfwAG_editorSelector{min-width:0;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono,ui-monospace, monospace);text-overflow:ellipsis;white-space:nowrap;font-size:11px;overflow:hidden}.YFfwAG_locatorLabel{color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px}.YFfwAG_editorScroll{overscroll-behavior:contain;flex-direction:column;gap:16px;min-height:0;padding:16px;display:flex;overflow-y:auto}.YFfwAG_editorFooter{border-top:1px solid var(--dsw-alias-border-l2)}.YFfwAG_footerSpace{flex:auto}.YFfwAG_deleteButton{color:var(--dsw-alias-state-error-primary)}.YFfwAG_deleteButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}.YFfwAG_section{flex-direction:column;gap:8px;display:flex}.YFfwAG_sectionTitle{color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;margin:0;font-size:12px;font-weight:650;display:flex}.YFfwAG_meta{grid-template-columns:auto minmax(0,1fr);gap:3px 8px;margin:0;font-size:12px;display:grid}.YFfwAG_meta dt{color:var(--dsw-alias-label-tertiary)}.YFfwAG_meta dd{overflow-wrap:anywhere;margin:0}.YFfwAG_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}.YFfwAG_fields{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;display:grid}.YFfwAG_field{flex-direction:column;gap:4px;min-width:0;display:flex}.YFfwAG_fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px}.YFfwAG_textInput{box-sizing:border-box;resize:vertical;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);width:100%;min-height:78px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;padding:8px 10px;font-size:13px;line-height:1.45}.YFfwAG_notice{overflow-wrap:anywhere;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);margin:0;padding:7px 12px;font-size:12px}.YFfwAG_status{color:var(--dsw-alias-label-tertiary);margin:0;padding:12px;font-size:12px}@container (width<=430px){.YFfwAG_stage{padding:8px}}.YFfwAG_editor[data-compact] .YFfwAG_fields{grid-template-columns:minmax(0,1fr)}.YFfwAG_editor[data-compact] .YFfwAG_editorHeader,.YFfwAG_editor[data-compact] .YFfwAG_editorFooter{padding:10px 12px}.YFfwAG_editor[data-compact] .YFfwAG_editorFooter{flex-wrap:wrap}.YFfwAG_editor[data-compact] .YFfwAG_footerSpace{flex-basis:100%;height:0}.YFfwAG_editor[data-compact] .YFfwAG_editorScroll{padding:12px}";
		const tagId = "@guowenzhang/dsh-web-design/HtmlDesignBody.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var HtmlDesignBody_module_css_default = {
			"deleteButton": "YFfwAG_deleteButton",
			"editor": "YFfwAG_editor",
			"editorFooter": "YFfwAG_editorFooter",
			"editorHeader": "YFfwAG_editorHeader",
			"editorHeaderAction": "YFfwAG_editorHeaderAction",
			"editorHeaderActions": "YFfwAG_editorHeaderActions",
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
			"locatorLabel": "YFfwAG_locatorLabel",
			"meta": "YFfwAG_meta",
			"modeOption": "YFfwAG_modeOption",
			"modeSwitch": "YFfwAG_modeSwitch",
			"notice": "YFfwAG_notice",
			"preview": "YFfwAG_preview",
			"section": "YFfwAG_section",
			"sectionTitle": "YFfwAG_sectionTitle",
			"stage": "YFfwAG_stage",
			"status": "YFfwAG_status",
			"textInput": "YFfwAG_textInput",
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
		* switches pointer modes, and double-clicking a selected element in edit
		* mode opens its inputs in a dialog. Review state reaches the Host
		* through the injected `saveReview`/`loadReview` callbacks, which the plugin
		* body binds to the `webDesignReview` Remote.
		*
		* The component holds no subscriptions of its own: the store reaches it through
		* the framework's `useStore` seat, and everything else is owner or inject data.
		*
		* @module @guowenzhang/dsh-web-design/client/HtmlDesignBody
		*/
		const MODES = ["browse", "inspect"];
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
			const [editableText, setEditableText] = (0, react.useState)(null);
			const [selectedParentSelector, setSelectedParentSelector] = (0, react.useState)(null);
			const [locatorCopy, setLocatorCopy] = (0, react.useState)(null);
			const selectedSource = (0, react.useRef)(null);
			const deletionRequest = (0, react.useRef)(null);
			const nextDeletionRequest = (0, react.useRef)(0);
			const [deleting, setDeleting] = (0, react.useState)(false);
			const [deletions, setDeletions] = (0, react.useState)([]);
			const deletionsRef = (0, react.useRef)([]);
			const pendingMove = (0, react.useRef)(null);
			const [textEdits, setTextEdits] = (0, react.useState)({});
			const [pendingEdits, setPendingEdits] = (0, react.useState)(false);
			const editRevision = (0, react.useRef)(0);
			const [fileWrite, setFileWrite] = (0, react.useState)({
				kind: "idle",
				detail: ""
			});
			const [frameResource, setFrameResource] = (0, react.useState)(null);
			const [frameAppliedMode, setFrameAppliedMode] = (0, react.useState)(null);
			const [resolvedFile, setResolvedFile] = (0, react.useState)(null);
			const documentRef = (0, react.useRef)(state.document);
			documentRef.current = state.document;
			(0, react.useEffect)(() => {
				if (locatorCopy === null) return;
				const timeout = window.setTimeout(() => setLocatorCopy(null), 1600);
				return () => window.clearTimeout(timeout);
			}, [locatorCopy]);
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
			/** Restore a dragged element when its dialog is discarded. */
			const discardMove = (0, react.useCallback)(() => {
				const move = pendingMove.current;
				if (move === null) return;
				postToFrame(frameRef.current, {
					kind: "style",
					selector: move.selector,
					declarations: move.restore
				});
				pendingMove.current = null;
			}, []);
			/** Adopt a frame selection; only an explicit edit gesture opens the dialog. */
			const selectAnchor = (0, react.useCallback)((anchor, openEditor) => {
				selectedSource.current = {
					selector: anchor.selector,
					text: anchor.sourceText,
					classes: anchor.sourceClasses
				};
				setSelectedParentSelector(anchor.parentSelector);
				const sameSelection = state.selectedSelector === anchor.selector;
				if (state.open && sameSelection) {
					actions.select(toAnchor(anchor));
					return;
				}
				discardMove();
				actions.select(toAnchor(anchor));
				if (!openEditor || state.mode !== "inspect") {
					if (state.open) actions.setOpen(false);
					return;
				}
				setComputed(anchor.computed);
				focusReturnRef.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : frameRef.current;
				setDraftStyle(state.document?.edits.find((edit) => edit.selector === anchor.selector)?.declarations ?? {});
				setEditableText(anchor.editableText);
				setDraftText(anchor.editableText === null ? "" : textEdits[anchor.selector] ?? anchor.editableText);
				actions.setOpen(true);
			}, [
				actions,
				discardMove,
				state.mode,
				state.document,
				state.open,
				state.selectedSelector,
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
			const cancelEditor = (0, react.useCallback)(() => {
				discardMove();
				closeEditor();
			}, [closeEditor, discardMove]);
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
					mode: state.mode,
					dragHandleLabel: t("dragHandle")
				});
			}, [
				state.mode,
				source,
				state.reloadToken,
				t
			]);
			(0, react.useEffect)(() => {
				if (!state.open) return;
				const closeOnEscape = (event) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						cancelEditor();
					}
				};
				window.addEventListener("keydown", closeOnEscape);
				return () => {
					window.removeEventListener("keydown", closeOnEscape);
				};
			}, [state.open, cancelEditor]);
			(0, react.useEffect)(() => {
				setResolvedFile(null);
				setTextEdits({});
				setDeletions([]);
				deletionsRef.current = [];
				selectedSource.current = null;
				setSelectedParentSelector(null);
				deletionRequest.current = null;
				setDeleting(false);
				setPendingEdits(false);
				editRevision.current = 0;
				pendingMove.current = null;
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
								mode: state.mode,
								dragHandleLabel: t("dragHandle")
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
							for (const deletion of deletionsRef.current) postToFrame(frameRef.current, {
								kind: "replayRemoval",
								selector: deletion.selector,
								requestId: `replay-${++nextDeletionRequest.current}`
							});
							return;
						case "modeApplied":
							if (message.mode === state.mode && source !== void 0) setFrameAppliedMode({
								source,
								reloadToken: state.reloadToken,
								mode: message.mode
							});
							return;
						case "hover":
							actions.setHovered(message.selector === null || message.selector === void 0 || message.tag === null || message.tag === void 0 ? null : {
								selector: message.selector,
								tag: message.tag
							});
							return;
						case "select":
							if (message.anchor !== void 0) selectAnchor(message.anchor, false);
							return;
						case "edit":
							if (message.anchor !== void 0) selectAnchor(message.anchor, true);
							return;
						case "move":
							if (message.anchor === void 0 || message.declarations === void 0 || message.restore === void 0 || message.selector === void 0) return;
							if (state.selectedSelector !== message.selector || !state.open) return;
							if (pendingMove.current === null) pendingMove.current = {
								selector: message.selector,
								restore: message.restore
							};
							actions.select(toAnchor(message.anchor));
							setDraftStyle((current) => ({
								...current,
								...message.declarations
							}));
							setFileWrite({
								kind: "idle",
								detail: ""
							});
							return;
						case "removeResult": {
							if (typeof message.requestId !== "string" || typeof message.selector !== "string") return;
							const request = deletionRequest.current;
							if (request?.requestId === message.requestId && request.source.selector === message.selector) {
								deletionRequest.current = null;
								setDeleting(false);
								const removedSelectors = Array.isArray(message.removedSelectors) ? message.removedSelectors.filter((selector) => typeof selector === "string") : [];
								if (message.success !== true || !removedSelectors.includes(message.selector)) {
									setFileWrite({
										kind: "failed",
										detail: t("deleteFailed")
									});
									return;
								}
								const deletion = {
									...request.source,
									removedSelectors
								};
								const next = [...deletionsRef.current.filter((current) => !removedSelectors.includes(current.selector)), deletion];
								deletionsRef.current = next;
								setDeletions(next);
								pendingMove.current = null;
								editRevision.current += 1;
								setFileWrite({
									kind: "idle",
									detail: ""
								});
								actions.select(null);
								closeEditor();
								return;
							}
							if (message.requestId.startsWith("replay-") && message.success !== true) setFileWrite({
								kind: "failed",
								detail: `${t("deleteFailed")}: ${message.selector}`
							});
							return;
						}
						default: return;
					}
				};
				window.addEventListener("message", listener);
				return () => {
					window.removeEventListener("message", listener);
				};
			}, [
				actions,
				closeEditor,
				selectAnchor,
				source,
				state.mode,
				state.document,
				state.reloadToken,
				state.selectedSelector,
				state.open,
				textEdits,
				t
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
			const saveSelection = (0, react.useCallback)(() => {
				const selector = state.selectedSelector;
				if (selector === null || hostPath === void 0) return;
				const declarations = cleanDeclarations(draftStyle);
				const previous = state.document?.edits.find((edit) => edit.selector === selector);
				const styleChanged = !sameDeclarations(previous?.declarations ?? {}, declarations);
				const textChanged = editableText !== null && draftText !== editableText;
				if (styleChanged) {
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
				if (textChanged) {
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
				if (styleChanged || textChanged) {
					editRevision.current += 1;
					setPendingEdits(true);
				}
				pendingMove.current = null;
				setFileWrite({
					kind: "idle",
					detail: ""
				});
				closeEditor();
			}, [
				draftStyle,
				draftText,
				editableText,
				state.selectedSelector,
				state.document,
				hostPath,
				actions,
				persist,
				withEdit,
				closeEditor
			]);
			/** Remove only the selected frame element and stage its source deletion. */
			const deleteSelection = (0, react.useCallback)(() => {
				const source = selectedSource.current;
				if (hostPath === void 0 || !state.open || state.mode !== "inspect" || deleting || fileWrite.kind === "saving" || source === null || source.selector !== state.selectedSelector || /^(?:html|head|body)$/iu.test(state.selected?.tag ?? "")) return;
				const requestId = `remove-${++nextDeletionRequest.current}`;
				deletionRequest.current = {
					requestId,
					source
				};
				setDeleting(true);
				setFileWrite({
					kind: "idle",
					detail: ""
				});
				postToFrame(frameRef.current, {
					kind: "removeSelected",
					selector: source.selector,
					requestId
				});
			}, [
				deleting,
				fileWrite.kind,
				hostPath,
				state.mode,
				state.open,
				state.selected?.tag,
				state.selectedSelector
			]);
			/** Restore every deletion that has not yet been written into the source. */
			const undoDeletions = (0, react.useCallback)(() => {
				if (deletionsRef.current.length === 0 || fileWrite.kind === "saving") return;
				cancelEditor();
				deletionsRef.current = [];
				setDeletions([]);
				editRevision.current += 1;
				setFileWrite({
					kind: "idle",
					detail: ""
				});
				actions.requestReload();
			}, [
				actions,
				cancelEditor,
				fileWrite.kind
			]);
			const resetStyle = (0, react.useCallback)(() => {
				setDraftStyle({});
				setFileWrite({
					kind: "idle",
					detail: ""
				});
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
				if (edits.length === 0 && Object.keys(textEdits).length === 0 && deletions.length === 0) {
					setFileWrite({
						kind: "idle",
						detail: ""
					});
					return;
				}
				const revision = editRevision.current;
				setFileWrite({
					kind: "saving",
					detail: ""
				});
				applyToFile({
					file: fileRef,
					edits,
					textEdits,
					deletions: deletions.map(({ selector, text, classes }) => ({
						selector,
						text,
						classes
					}))
				}).then((result) => {
					const skipped = new Set(result.skipped.map((entry) => entry.selector));
					const applied = new Set(result.applied);
					const writtenDeletions = deletions.filter((deletion) => applied.has(deletion.selector) && !skipped.has(deletion.selector));
					const missingDeletions = deletions.filter((deletion) => !applied.has(deletion.selector) && !skipped.has(deletion.selector));
					if (writtenDeletions.length > 0) {
						const written = new Set(writtenDeletions.map((deletion) => deletion.selector));
						const remaining = deletionsRef.current.filter((deletion) => !written.has(deletion.selector));
						deletionsRef.current = remaining;
						setDeletions(remaining);
						const removedSelectors = new Set(writtenDeletions.flatMap((deletion) => deletion.removedSelectors));
						setTextEdits((current) => Object.fromEntries(Object.entries(current).filter(([selector]) => !removedSelectors.has(selector))));
						const document = documentRef.current;
						if (document !== null && document.edits.some((edit) => removedSelectors.has(edit.selector))) {
							const next = {
								...document,
								edits: document.edits.filter((edit) => !removedSelectors.has(edit.selector)),
								updatedAt: (/* @__PURE__ */ new Date()).toISOString()
							};
							actions.removeEdits([...removedSelectors]);
							persist(next);
						}
					}
					if (result.skipped.length > 0 || missingDeletions.length > 0) {
						const missed = [...result.skipped.map((entry) => entry.selector), ...missingDeletions.map((deletion) => deletion.selector)];
						setFileWrite({
							kind: "partial",
							detail: missed.join(", ")
						});
						return;
					}
					setFileWrite({
						kind: "saved",
						detail: String(result.bytes)
					});
					if (editRevision.current === revision) setPendingEdits(false);
					setTextEdits((current) => Object.fromEntries(Object.entries(current).filter(([selector, value]) => textEdits[selector] !== value)));
				}).catch((error) => {
					setFileWrite({
						kind: "failed",
						detail: error instanceof Error ? error.message : String(error)
					});
				});
			}, [
				actions,
				applyToFile,
				deletions,
				fileRef,
				hostPath,
				persist,
				state.document,
				textEdits
			]);
			const hasFileEdits = (state.document?.edits.length ?? 0) > 0 || Object.keys(textEdits).length > 0 || deletions.length > 0;
			const previousStyle = state.document?.edits.find((edit) => edit.selector === state.selectedSelector)?.declarations ?? {};
			const draftDirty = state.open && state.selected !== null && (!sameDeclarations(previousStyle, cleanDeclarations(draftStyle)) || editableText !== null && draftText !== editableText);
			const statusDirty = state.dirty || draftDirty || pendingEdits || deletions.length > 0;
			const rootSelected = /^(?:html|head|body)$/iu.test(state.selected?.tag ?? "");
			const frameInteractive = frameAppliedMode !== null && frameAppliedMode.source === source && frameAppliedMode.reloadToken === state.reloadToken && frameAppliedMode.mode === state.mode;
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: HtmlDesignBody_module_css_default.preview,
				"data-html-design-surface": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: HtmlDesignBody_module_css_default.toolbar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: HtmlDesignBody_module_css_default.modeSwitch,
							role: "group",
							"aria-label": t("modes"),
							"data-mode": state.mode,
							children: MODES.map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: HtmlDesignBody_module_css_default.modeOption,
								"aria-pressed": state.mode === mode,
								title: mode === "inspect" ? t("editGestureHint") : void 0,
								disabled: deleting,
								onClick: () => {
									if (state.mode === mode) return;
									cancelEditor();
									postToFrame(frameRef.current, {
										kind: "mode",
										mode,
										dragHandleLabel: t("dragHandle")
									});
									actions.setMode(mode);
								},
								children: modeLabel(mode, t)
							}, mode))
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: HtmlDesignBody_module_css_default.toolbarEnd,
							children: [
								deletions.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: t("undoDeletionsHint"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "ghost",
										size: "sm",
										disabled: deleting || fileWrite.kind === "saving",
										onClick: undoDeletions,
										children: t("undoDeletions")
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: statusDirty ? "warning" : state.error !== null || fileWrite.kind === "failed" ? "danger" : "neutral",
									children: draftDirty ? t("unsaved") : state.saving ? t("saving") : statusDirty ? t("unsaved") : state.error !== null || fileWrite.kind === "failed" ? t("saveFailed") : t("saved")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: t("saveToFileHint"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "primary",
										size: "sm",
										disabled: hostPath === void 0 || !hasFileEdits || draftDirty || deleting || state.saving || fileWrite.kind === "saving",
										onClick: saveToFile,
										children: fileWrite.kind === "saving" ? t("saving") : t("saveToFile")
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									onClick: () => {
										deletionRequest.current = null;
										setDeleting(false);
										cancelEditor();
										actions.requestReload();
									},
									children: t("reload")
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
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							ref: stageRef,
							className: HtmlDesignBody_module_css_default.stage,
							"data-html-design-stage": true,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
								ref: frameRef,
								className: HtmlDesignBody_module_css_default.frame,
								src: frameResource.url,
								sandbox: "allow-scripts allow-forms allow-popups allow-modals",
								title: t("frame"),
								"data-html-design-preview": true,
								"data-frame-mode-ready": frameInteractive ? "true" : "false"
							}, state.reloadToken)
						}), state.open && state.selected !== null && editorPlacement !== null && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: HtmlDesignBody_module_css_default.elementTag,
												title: t("elementTag"),
												children: state.selected.tag.toUpperCase()
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: HtmlDesignBody_module_css_default.locatorLabel,
												children: t("elementLocator")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: HtmlDesignBody_module_css_default.editorSelector,
												title: state.selected.selector,
												children: state.selected.selector
											})
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: HtmlDesignBody_module_css_default.editorHeaderActions,
										children: [
											selectedParentSelector !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: HtmlDesignBody_module_css_default.editorHeaderAction,
												title: t("selectParentHint"),
												onClick: () => {
													postToFrame(frameRef.current, { kind: "selectParent" });
												},
												children: t("selectParent")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: HtmlDesignBody_module_css_default.editorHeaderAction,
												title: t("copyLocatorHint"),
												onClick: () => {
													const selector = state.selected?.selector;
													if (selector === void 0) return;
													(0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(selector).then((success) => setLocatorCopy({
														selector,
														success
													}));
												},
												children: locatorCopy?.selector === state.selected.selector ? t(locatorCopy.success ? "locatorCopied" : "locatorCopyFailed") : t("copyLocator")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												variant: "ghost",
												size: "sm",
												"aria-label": t("closeEditor"),
												onClick: cancelEditor,
												children: "×"
											})
										]
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
											}), editableText === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: HtmlDesignBody_module_css_default.hint,
												children: t("textSelectionHint")
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: HtmlDesignBody_module_css_default.field,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: HtmlDesignBody_module_css_default.fieldLabel,
													children: t("textContent")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
													className: HtmlDesignBody_module_css_default.textInput,
													autoFocus: true,
													value: draftText,
													onChange: (event) => {
														setDraftText(event.target.value);
														setFileWrite({
															kind: "idle",
															detail: ""
														});
													}
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
															setFileWrite({
																kind: "idle",
																detail: ""
															});
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
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: HtmlDesignBody_module_css_default.hint,
											children: t("dragHint")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: HtmlDesignBody_module_css_default.hint,
											children: t(rootSelected ? "deleteRootHint" : "deleteHint")
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
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "ghost",
											size: "sm",
											className: HtmlDesignBody_module_css_default.deleteButton,
											disabled: hostPath === void 0 || rootSelected || deleting || fileWrite.kind === "saving",
											onClick: deleteSelection,
											children: deleting ? t("deleting") : t("deleteElement")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: HtmlDesignBody_module_css_default.footerSpace }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "outline",
											size: "sm",
											disabled: deleting,
											onClick: cancelEditor,
											children: t("cancel")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "primary",
											size: "sm",
											disabled: hostPath === void 0 || deleting,
											onClick: saveSelection,
											children: t("save")
										})
									]
								})
							]
						}), window.document.body)]
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
		/** Ignore blank draft fields before comparing or persisting style edits. */
		function cleanDeclarations(draft) {
			return Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value.length > 0));
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
			elementTag: "HTML 标签",
			elementLocator: "定位",
			selectParent: "父级",
			selectParentHint: "选中当前元素的外层区块；可连续点击向上定位",
			closeEditor: "关闭编辑弹窗",
			content: "内容",
			cancel: "取消",
			save: "保存",
			deleteElement: "删除元素",
			deleteHint: "删除会移除所选元素及其内部所有内容。保存到文件后才会改动 HTML。",
			deleteRootHint: "页面结构元素不可删除。请选择页面内的具体区块。",
			deleting: "正在删除…",
			deleteFailed: "无法删除所选元素",
			undoDeletions: "撤销删除",
			undoDeletionsHint: "恢复尚未保存到文件的元素",
			modes: "预览工具",
			loading: "正在打开预览…",
			failed: "无法渲染这个 HTML 文件。",
			frame: "网页设计预览",
			modeBrowse: "预览",
			modeInspect: "编辑",
			editGestureHint: "单击选中元素，双击打开编辑弹窗",
			reload: "重新加载",
			saveToFile: "保存到文件",
			saveToFileHint: "把样式与文本修改写入这个 HTML 文件本身",
			fileSaved: "已写入文件。",
			filePartial: "部分修改未能定位",
			saving: "正在保存…",
			saved: "已保存",
			unsaved: "未保存",
			saveFailed: "保存失败",
			size: "尺寸",
			textContent: "文本内容",
			copyLocator: "复制",
			copyLocatorHint: "复制当前元素的 CSS 定位到剪贴板",
			locatorCopied: "已复制",
			locatorCopyFailed: "复制失败",
			textSelectionHint: "此元素没有唯一的直属文字。请双击具体的文字元素。",
			dragHint: "拖动选中框的手柄可以移动元素。",
			dragHandle: "拖动选中元素",
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
			styles: "样式修改"
		};
		/** English copy. */
		const en = {
			title: "Web design preview",
			editElement: "Edit element",
			elementTag: "HTML tag",
			elementLocator: "Selector",
			selectParent: "Parent",
			selectParentHint: "Select the containing element; click again to move up",
			closeEditor: "Close edit dialog",
			content: "Content",
			cancel: "Cancel",
			save: "Save",
			deleteElement: "Delete element",
			deleteHint: "Deleting removes the selected element and everything inside it. Save to file to change the HTML.",
			deleteRootHint: "Page structure elements cannot be deleted. Select a block inside the page.",
			deleting: "Deleting…",
			deleteFailed: "Could not delete the selected element",
			undoDeletions: "Undo deletion",
			undoDeletionsHint: "Restore elements not yet saved to the file",
			modes: "Preview tools",
			loading: "Opening preview…",
			failed: "This HTML file could not be rendered.",
			frame: "Web design preview",
			modeBrowse: "Preview",
			modeInspect: "Edit",
			editGestureHint: "Click to select an element; double-click to open the editor",
			reload: "Reload",
			saveToFile: "Save to file",
			saveToFileHint: "Write the style and text edits into this HTML file",
			fileSaved: "Written to the file.",
			filePartial: "Some edits could not be located",
			saving: "Saving…",
			saved: "Saved",
			unsaved: "Unsaved",
			saveFailed: "Save failed",
			size: "Size",
			textContent: "Text content",
			copyLocator: "Copy",
			copyLocatorHint: "Copy this element’s CSS selector to the clipboard",
			locatorCopied: "Copied",
			locatorCopyFailed: "Copy failed",
			textSelectionHint: "This element has no unique direct text. Double-click the exact text element instead.",
			dragHint: "Drag the selected outline handle to move the element.",
			dragHandle: "Drag selected element",
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
			styles: "Style edits"
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
