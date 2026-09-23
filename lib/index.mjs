import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { parse, parseFragment } from "parse5";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
//#region src/source-edit.ts
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
function parseSelector(selector) {
	const trimmed = selector.trim();
	if (trimmed.length === 0) return void 0;
	const steps = [];
	for (const raw of trimmed.split(/\s*>\s*/u)) {
		const match = /^([a-z][a-z0-9-]*)(?:#([^\s:>]+))?(?::nth-of-type\((\d+)\))?$/iu.exec(raw);
		if (match === null) return void 0;
		const tag = match[1];
		/* v8 ignore next -- group 1 is mandatory in the pattern, so exec guarantees it. */
		if (tag === void 0) return void 0;
		steps.push({
			tag: tag.toLowerCase(),
			...match[2] === void 0 ? {} : { id: match[2] },
			...match[3] === void 0 ? {} : { nth: Number(match[3]) }
		});
	}
	return steps;
}
/** Whether a tree node is an element. */
function isElement(node) {
	return "tagName" in node;
}
/** Whether a tree node is a text node. */
function isText(node) {
	return "value" in node && !("tagName" in node);
}
/** The direct element children of a node. */
function childElements(node) {
	return ("childNodes" in node ? node.childNodes : []).filter(isElement);
}
/** Lowercased tag name of an element. */
function tagOf(element) {
	return element.tagName.toLowerCase();
}
/** An attribute's value, or `undefined` when absent. */
function attrOf(element, name) {
	return element.attrs.find((attribute) => attribute.name === name)?.value;
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
function locate(root, steps) {
	const first = steps[0];
	/* v8 ignore next -- parseSelector returns a non-empty array or undefined. */
	if (first === void 0) return void 0;
	if (first.id !== void 0) {
		const anchored = findById(root, first.id, first.tag);
		if (anchored === void 0) return void 0;
		return descend(anchored, steps, 1) ?? anchored;
	}
	const roots = childElements(root);
	return descend(roots.length === 1 && tagOf(roots[0]) === "html" ? roots[0] : root, steps, 0);
}
/**
* Apply selector steps from an index onward.
* @param scope - node whose element children the next step selects from.
* @param steps - the complete parsed path.
* @param from - index of the first step to apply.
* @returns the located element, or `undefined`.
*/
function descend(scope, steps, from) {
	let current = scope;
	let found;
	for (let index = from; index < steps.length; index += 1) {
		const step = steps[index];
		/* v8 ignore next -- the loop bounds keep every index inside the array. */
		if (step === void 0) return void 0;
		const candidates = childElements(current).filter((child) => tagOf(child) === step.tag);
		let next;
		if (step.id !== void 0) next = candidates.find((candidate) => attrOf(candidate, "id") === step.id);
		else if (step.nth !== void 0) next = candidates[step.nth - 1];
		else next = candidates[0];
		if (next === void 0) return void 0;
		found = next;
		current = next;
	}
	return found;
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
function findById(root, id, tag) {
	let fallback;
	const visit = (node) => {
		for (const child of childElements(node)) {
			if (attrOf(child, "id") === id) {
				if (tagOf(child) === tag) return child;
				fallback ??= child;
			}
			const deeper = visit(child);
			if (deeper !== void 0) return deeper;
		}
	};
	return visit(root) ?? fallback;
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
function applySourceEdits(source, edits, textEdits = {}) {
	if (edits.length === 0 && Object.keys(textEdits).length === 0) return {
		source,
		applied: [],
		skipped: []
	};
	const document = parse(source, { sourceCodeLocationInfo: true });
	const replacementFor = /* @__PURE__ */ new Map();
	const skipped = [];
	for (const edit of edits) {
		const steps = parseSelector(edit.selector);
		if (steps === void 0) {
			skipped.push({
				selector: edit.selector,
				reason: "unsupported selector grammar"
			});
			continue;
		}
		const element = locate(document, steps);
		if (element === void 0) {
			skipped.push({
				selector: edit.selector,
				reason: "element not found in source"
			});
			continue;
		}
		const location = element.sourceCodeLocation;
		if (location === void 0 || location === null) {
			skipped.push({
				selector: edit.selector,
				reason: "element has no source location"
			});
			continue;
		}
		const declarations = mergeDeclarations(attrOf(element, "style"), edit.declarations);
		if (declarations === void 0) {
			skipped.push({
				selector: edit.selector,
				reason: "no declarations to apply"
			});
			continue;
		}
		const list = replacementFor.get(edit.selector) ?? [];
		list.push(styleReplacement(source, element, location, declarations));
		replacementFor.set(edit.selector, list);
	}
	for (const [selector, value] of Object.entries(textEdits)) {
		const steps = parseSelector(selector);
		if (steps === void 0) {
			skipped.push({
				selector,
				reason: "unsupported selector grammar"
			});
			continue;
		}
		const element = locate(document, steps);
		if (element === void 0) {
			skipped.push({
				selector,
				reason: "element not found in source"
			});
			continue;
		}
		const replacement = textReplacement(source, element, value);
		if (replacement === void 0) {
			skipped.push({
				selector,
				reason: "element has no editable text"
			});
			continue;
		}
		replacementFor.set(selector, [...replacementFor.get(selector) ?? [], replacement]);
	}
	const replacements = [...replacementFor.values()].flat().sort((left, right) => left.start - right.start);
	const applied = [];
	let out = "";
	let cursor = 0;
	for (const replacement of replacements) {
		if (replacement.start < cursor) continue;
		out += source.slice(cursor, replacement.start) + replacement.text;
		cursor = replacement.end;
	}
	out += source.slice(cursor);
	for (const selector of replacementFor.keys()) applied.push(selector);
	return {
		source: out,
		applied,
		skipped
	};
}
/** Merge new declarations over an element's existing `style` attribute. */
function mergeDeclarations(existing, declarations) {
	const merged = /* @__PURE__ */ new Map();
	for (const part of (existing ?? "").split(";")) {
		const at = part.indexOf(":");
		if (at <= 0) continue;
		const property = part.slice(0, at).trim();
		const value = part.slice(at + 1).trim();
		if (property.length > 0) merged.set(property, value);
	}
	for (const [property, value] of Object.entries(declarations)) {
		const trimmed = value.trim();
		if (trimmed.length === 0) merged.delete(property);
		else merged.set(property, trimmed);
	}
	return merged.size === 0 ? void 0 : merged;
}
/** Serialize a declaration map back into an attribute value. */
function serializeDeclarations(declarations) {
	return [...declarations.entries()].map(([property, value]) => `${property}: ${value}`).join("; ");
}
/**
* Build the span replacement that writes an element's `style` attribute.
*
* An element with an existing `style` attribute has only that attribute's value
* replaced. One without gets a new attribute appended after the last existing
* attribute (or right after the tag name when there is none), so the authored
* attribute order is preserved and the rest of the start tag stays byte-identical.
*/
function styleReplacement(source, element, location, declarations) {
	const value = serializeDeclarations(declarations);
	const styleAttr = location.attrs?.["style"];
	if (styleAttr !== void 0) return {
		start: styleAttr.startOffset,
		end: styleAttr.endOffset,
		text: `style="${escapeAttribute(value)}"`
	};
	const attributeEnds = Object.values(location.attrs ?? {}).map((attribute) => attribute.endOffset);
	const insertAt = attributeEnds.length > 0 ? Math.max(...attributeEnds) : location.startOffset + 1 + element.tagName.length;
	return {
		start: insertAt,
		end: insertAt,
		text: ` style="${escapeAttribute(value)}"`
	};
}
/**
* Build the span replacement that writes an element's text.
*
* Only a single-text-child element is rewritten: replacing an element with
* nested markup would discard that markup, which is not what editing text in a
* preview should mean.
*/
function textReplacement(source, element, value) {
	const texts = ("childNodes" in element ? element.childNodes : []).filter(isText);
	if (texts.length !== 1) return void 0;
	const location = texts[0].sourceCodeLocation;
	if (location === void 0 || location === null) return void 0;
	return {
		start: location.startOffset,
		end: location.endOffset,
		text: escapeText(value)
	};
}
/** Escape a value for an HTML attribute. */
function escapeAttribute(value) {
	return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
}
/** Escape text content. */
function escapeText(value) {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
/**
* Parse an HTML source into a fragment tree.
*
* Exposed so callers can verify a source is parseable before offering write-back.
* @param source - the complete HTML source text.
* @returns the parsed fragment.
*/
function parseSource(source) {
	return parseFragment(source, { sourceCodeLocationInfo: true });
}
//#endregion
//#region src/store.ts
/**
* Persistence for design review state.
*
* Review state is a sidecar file next to the previewed document, named
* `<file>.design.json`. Keeping it beside the file means a review travels with
* the artifact and survives a workspace move; keeping it out of the HTML means
* the preview never rewrites the file under review.
*
* @module @guowenzhang/dsh-web-design/store
*/
/** Suffix appended to a previewed file's path to name its review sidecar. */
const SIDECAR_SUFFIX = ".design.json";
/** Most comments one file may retain. */
const MAX_COMMENTS = 500;
/** Longest comment body retained, in characters. */
const MAX_BODY_CHARS = 8e3;
/** Most element edits one file may retain. */
const MAX_EDITS = 500;
/**
* Resolve the sidecar path for one previewed file.
* @param filePath - absolute path of the previewed HTML file.
* @returns the absolute sidecar path.
*/
function sidecarPath(filePath) {
	return `${filePath}${SIDECAR_SUFFIX}`;
}
/**
* Read one file's review state.
* @param filePath - absolute path of the previewed HTML file.
* @returns the stored document, or `null` when the sidecar is absent or unreadable.
*/
async function readAnnotations(filePath) {
	try {
		const raw = await readFile(sidecarPath(filePath), "utf8");
		return parseDocument(JSON.parse(raw), filePath);
	} catch {
		return null;
	}
}
/**
* Replace one file's review state.
*
* The write is atomic: a temporary file in the same directory is renamed over
* the target, so a preview reload never observes a half-written sidecar.
* @param filePath - absolute path of the previewed HTML file.
* @param document - the review state to persist.
* @returns the sidecar path, retained comment count, and retained edit count.
*/
async function writeAnnotations(filePath, document) {
	const bounded = boundDocument(document, filePath);
	const storePath = sidecarPath(filePath);
	await mkdir(dirname(storePath), { recursive: true });
	const temporary = `${storePath}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(bounded, null, 2)}\n`, "utf8");
	await rename(temporary, storePath);
	return {
		storePath,
		comments: bounded.comments.length,
		edits: bounded.edits.length
	};
}
/**
* Validate and bound a document received from the browser half.
*
* The client is a separate process boundary, so its payload is untrusted here:
* unknown fields are dropped, unbounded text is capped, and a document whose
* own `file` disagrees with the request path is rejected rather than stored
* under the wrong key.
* @param path - absolute path from the request, which the document must agree with.
* @param document - the submitted document.
* @returns the bounded document.
* @throws when the payload is not a review document for this path.
*/
function validateWrite(path, document) {
	if (typeof document !== "object" || document === null) throw new TypeError("web-design: document must be an object");
	const candidate = document;
	if (candidate.file !== path) throw new Error(`web-design: document.file "${String(candidate.file)}" does not match the requested path`);
	if (candidate.version !== 1) throw new Error(`web-design: unsupported document version ${String(candidate.version)}`);
	if (!Array.isArray(candidate.comments) || !Array.isArray(candidate.edits)) throw new TypeError("web-design: document.comments and document.edits must be arrays");
	return boundDocument(document, path);
}
/** Parse a stored document, returning `null` for anything unusable. */
function parseDocument(value, filePath) {
	if (typeof value !== "object" || value === null) return null;
	const candidate = value;
	if (candidate.version !== 1) return null;
	if (candidate.file !== filePath) return null;
	if (!Array.isArray(candidate.comments) || !Array.isArray(candidate.edits)) return null;
	return boundDocument(value, filePath);
}
/** Cap a document's collections and text so a hostile payload cannot grow the sidecar without bound. */
function boundDocument(document, filePath) {
	const now = (/* @__PURE__ */ new Date()).toISOString();
	return {
		version: 1,
		file: filePath,
		comments: document.comments.slice(0, MAX_COMMENTS).map((comment) => ({
			id: String(comment.id),
			kind: comment.kind === "region" ? "region" : "element",
			...comment.element === void 0 ? {} : { element: comment.element },
			...comment.region === void 0 ? {} : { region: comment.region },
			body: String(comment.body ?? "").slice(0, MAX_BODY_CHARS),
			severity: normalizeSeverity(comment.severity),
			resolved: comment.resolved === true,
			createdAt: typeof comment.createdAt === "string" ? comment.createdAt : now
		})),
		edits: document.edits.slice(0, MAX_EDITS).map((edit) => ({
			selector: String(edit.selector),
			declarations: edit.declarations ?? {},
			updatedAt: typeof edit.updatedAt === "string" ? edit.updatedAt : now
		})),
		updatedAt: typeof document.updatedAt === "string" ? document.updatedAt : now
	};
}
/** Map an unknown severity onto the accepted set. */
function normalizeSeverity(value) {
	switch (value) {
		case "note":
		case "nit":
		case "issue":
		case "blocker": return value;
		default: return "note";
	}
}
/** An empty review document for one file. */
function emptyDocument(filePath) {
	return {
		version: 1,
		file: filePath,
		comments: [],
		edits: [],
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
}
//#endregion
//#region src/remote.ts
/**
* Host owner of the `webDesignReview` Remote namespace.
*
* The Sidebar HTML preview runs in the browser, but review state must outlive a
* page load and stay readable by the agent that owns the artifact. The Remote
* is the only write path: the generated `workspaceFiles` namespace the Client
* already has is read-only, so the preview cannot persist a comment without
* this service.
*
* The service registers unconditionally. A guarded registration would make
* every client call fail with a missing namespace instead of a reportable
* error.
*
* @module @guowenzhang/dsh-web-design/remote
*/
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) {
			if (kind === "field") initializers.unshift(_);
			else descriptor[key] = _;
		}
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/**
* Host service behind the `webDesignReview` Remote namespace.
*
* The browser sends a Session id and the path from its file resource address.
* Each operation resolves that path against the Session's workspace, then
* confines the target before reading or writing the file and its sidecar.
*/
let WebDesignRemote = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _read_decorators;
	let _write_decorators;
	let _apply_decorators;
	return class WebDesignRemote extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_read_decorators = [Remote("read")];
			_write_decorators = [Remote("write")];
			_apply_decorators = [Remote("apply")];
			__esDecorate(this, null, _read_decorators, {
				kind: "method",
				name: "read",
				static: false,
				private: false,
				access: {
					has: (obj) => "read" in obj,
					get: (obj) => obj.read
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _write_decorators, {
				kind: "method",
				name: "write",
				static: false,
				private: false,
				access: {
					has: (obj) => "write" in obj,
					get: (obj) => obj.write
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _apply_decorators, {
				kind: "method",
				name: "apply",
				static: false,
				private: false,
				access: {
					has: (obj) => "apply" in obj,
					get: (obj) => obj.apply
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		/**
		* @param ctx - host context.
		*/
		constructor(ctx) {
			super(ctx, "webDesignReview");
			__runInitializers(this, _instanceExtraInitializers);
		}
		/**
		* Read the review state stored beside one previewed file.
		* @param request - the previewed file's Session address. The parameter must keep
		*   this name: the gateway derives its descriptor from the method signature
		*   and rejects a payload whose field does not match.
		* @returns the stored document, or `null` when the file has no review yet.
		* @throws a typed error when the Session or file address cannot be resolved.
		*/
		async read(request) {
			const path = await this.resolveFile(request?.file, "read");
			return {
				path,
				document: await readAnnotations(path),
				storePath: sidecarPath(path)
			};
		}
		/**
		* Replace the review state stored beside one previewed file.
		* @param request - the previewed file's Session address and the document to store.
		* @returns the sidecar path and the retained comment and edit counts.
		* @throws a typed error when the payload is not a review document for that path.
		*/
		async write(request) {
			const path = await this.resolveFile(request?.file, "write");
			let document;
			try {
				document = validateWrite(path, request?.document);
			} catch (cause) {
				throw new RemoteError("web-design/invalid", "the submitted review document was rejected", { reason: cause instanceof Error ? cause.message : String(cause) });
			}
			try {
				return await writeAnnotations(path, document);
			} catch (cause) {
				throw new RemoteError("web-design/io", `writing the review for ${path} failed`, { reason: cause instanceof Error ? cause.message : String(cause) }, { cause });
			}
		}
		/**
		* Rewrite one previewed file from the reviewer's edits.
		*
		* Each edit is applied as a span rewrite against the file's own source text,
		* so the rewrite touches only the located elements' `style` attributes and
		* text nodes. Nothing else in the file changes, and edits that cannot be
		* located are reported rather than silently dropped.
		*
		* The write is atomic: a temporary file beside the target is renamed over it,
		* so a reader never observes a half-written document.
		* @param request - the previewed file's Session address, its style edits, and
		*   its element text replacements.
		* @returns the path, what was applied and skipped, and the written size.
		* @throws a typed error when the request is unusable or the write fails.
		*/
		async apply(request) {
			const path = await this.resolveFile(request?.file, "apply");
			if (!Array.isArray(request?.edits)) throw new RemoteError("web-design/invalid", "apply requires an `edits` array", { reason: `edits was ${typeof request?.edits}` });
			const textEdits = request.textEdits ?? {};
			if (typeof textEdits !== "object" || textEdits === null || Array.isArray(textEdits)) throw new RemoteError("web-design/invalid", "apply requires `textEdits` to be an object", { reason: `textEdits was ${typeof textEdits}` });
			let original;
			try {
				original = await readFile(path, "utf8");
			} catch (cause) {
				throw new RemoteError("web-design/io", `reading ${path} failed`, { reason: cause instanceof Error ? cause.message : String(cause) }, { cause });
			}
			const result = applySourceEdits(original, request.edits, textEdits);
			const changed = result.source !== original;
			if (changed) try {
				const temporary = `${path}.${process.pid}.dsh-web-design.tmp`;
				await writeFile(temporary, result.source, "utf8");
				await rename(temporary, path);
			} catch (cause) {
				throw new RemoteError("web-design/io", `writing ${path} failed`, { reason: cause instanceof Error ? cause.message : String(cause) }, { cause });
			}
			return {
				path,
				applied: result.applied,
				skipped: result.skipped,
				bytes: Buffer.byteLength(result.source, "utf8"),
				changed
			};
		}
		/** Resolve one browser-supplied file address through its Session workspace. */
		async resolveFile(value, method) {
			if (typeof value !== "object" || value === null) throw invalidFile(method, "file must carry a sessionId and path");
			const file = value;
			if (typeof file.sessionId !== "string" || file.sessionId.length === 0) throw invalidFile(method, "sessionId must be a non-empty string");
			if (typeof file.path !== "string" || file.path.trim().length === 0 || file.path.includes("\0")) throw invalidFile(method, "path must be a non-empty string without NUL bytes");
			const sessionId = SessionId(file.sessionId);
			const sessions = this.ctx.get("sessions");
			if (sessions === void 0) throw invalidFile(method, "Session service is unavailable");
			const live = sessions.get(sessionId)?.header;
			const stored = live === void 0 ? await this.ctx.get("sessionPersistence")?.stat(sessionId) : void 0;
			const header = live ?? stored?.header;
			if (header === void 0) throw invalidFile(method, `Session ${sessionId} does not exist`);
			const workspaceRoot = header.cwd ?? this.ctx.get("sandboxPolicy")?.workspaceRoot;
			if (workspaceRoot === void 0) throw invalidFile(method, `Session ${sessionId} has no workspace root`);
			const fs = this.ctx.get("fs");
			if (fs === void 0) throw invalidFile(method, "filesystem service is unavailable");
			const root = await fs.resolve(workspaceRoot);
			const target = await fs.resolve(file.path, { cwd: workspaceRoot });
			if (!fs.contains(root, target)) throw invalidFile(method, `path "${file.path}" is outside the Session workspace`);
			if ((await fs.stat(target))?.type !== "file") throw invalidFile(method, `path "${file.path}" is not a regular file`);
			const path = fs.processPath(target);
			if (!isAbsolute(path)) throw invalidFile(method, "filesystem did not return an absolute host path");
			return path;
		}
	};
})();
/** A malformed file address fails before any host filesystem call. */
function invalidFile(method, reason) {
	return new RemoteError("web-design/invalid", `${method} cannot resolve the previewed file: ${reason}`, { reason });
}
//#endregion
//#region src/skills.ts
/**
* Materialize the bundled web-design skills into the agent skills directory.
*
* The DeepSeek Harness filesystem skill provider discovers directory bundles
* under `$DSH_AGENTS_HOME/skills` (`~/.agents/skills` by default). Copying the
* plugin's bundled skills there is what makes them appear in a session's skill
* catalog, including for agents that never load this plugin's own Host half.
*
* Ownership is explicit: every directory this module writes carries a marker
* file recording the plugin and version that wrote it. A directory without that
* marker belongs to the user and is never overwritten or removed; a directory
* whose content drifted from the bundled source is refreshed only when it is
* still marked as ours.
*
* @module @guowenzhang/dsh-web-design/skills
*/
/** Marker filename identifying a directory this plugin owns. */
const MARKER_NAME = ".dsh-web-design.json";
/** Plugin identity recorded in ownership markers. */
const OWNER = "@guowenzhang/dsh-web-design";
/**
* Resolve the agent skills directory the same way the filesystem skill provider
* does, so both halves agree without importing it.
* @param configured - explicit `targetDir` from plugin config, when set.
* @returns the absolute target directory.
*/
function resolveSkillsDir(configured) {
	if (configured !== void 0 && configured.length > 0) return resolve(expandHome(configured));
	const agentsHome = process.env.DSH_AGENTS_HOME;
	const base = agentsHome !== void 0 && agentsHome.length > 0 ? resolve(expandHome(agentsHome)) : join(homedir(), ".agents");
	return join(base, "skills");
}
/** Expand a leading `~` against the user's home directory. */
function expandHome(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
/**
* List the skill directory names bundled with this plugin.
* @param sourceDir - absolute `assets/skills` directory.
* @returns sorted skill names, excluding the generated index file.
*/
async function listBundledSkills(sourceDir) {
	return (await readdir(sourceDir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && existsSync(join(sourceDir, entry.name, "SKILL.md"))).map((entry) => entry.name).sort();
}
/**
* Copy every bundled skill into the agent skills directory.
*
* A skill already present with the same digest is left untouched, so repeated
* applies do not rewrite files the session watcher would then report as
* changed. A skill present but stale is replaced, because a stale copy from an
* older plugin version is exactly what would otherwise keep a fixed skill
* broken forever.
* @param options - bundled and target directories, plugin version, and the
*   skill allowlist from plugin config.
* @returns what the pass installed, left alone, and refused to touch.
* @throws when the bundled source directory does not exist, since silently
*   installing nothing would look like a working plugin.
*/
async function materializeSkills(options) {
	const { sourceDir, targetDir, version } = options;
	if (!existsSync(sourceDir)) throw new Error(`web-design: bundled skills directory not found at ${sourceDir}`);
	const bundled = await listBundledSkills(sourceDir);
	const selected = options.skillNames === void 0 || options.skillNames.length === 0 ? bundled : bundled.filter((name) => options.skillNames?.includes(name) === true);
	const unknown = (options.skillNames ?? []).filter((name) => !bundled.includes(name));
	if (unknown.length > 0) throw new Error(`web-design: unknown skill name(s) in config: ${unknown.join(", ")}`);
	await mkdir(targetDir, { recursive: true });
	const installed = [];
	const unchanged = [];
	const foreign = [];
	for (const name of selected) {
		const source = join(sourceDir, name);
		const target = join(targetDir, name);
		const digest = await digestDirectory(source);
		const marker = await readMarker(target);
		if (marker !== void 0 && marker.owner !== "@guowenzhang/dsh-web-design") {
			foreign.push(name);
			continue;
		}
		const present = existsSync(join(target, "SKILL.md"));
		if (present && marker?.digest === digest && marker.version === version) {
			unchanged.push(name);
			continue;
		}
		if (present && marker === void 0) {
			foreign.push(name);
			continue;
		}
		await rm(target, {
			recursive: true,
			force: true
		});
		await cp(source, target, { recursive: true });
		const written = {
			owner: OWNER,
			version,
			digest
		};
		await writeFile(join(target, MARKER_NAME), `${JSON.stringify(written, null, 2)}\n`, "utf8");
		installed.push(name);
	}
	return {
		targetDir,
		installed,
		unchanged,
		foreign
	};
}
/**
* Remove every skill directory this plugin owns.
*
* Called when the plugin stops. Directories the user created are left alone,
* and the target directory itself is never removed, because other producers
* share it.
* @param options - target directory and optional allowlist matching the one
*   {@link materializeSkills} was given.
* @returns the skill names removed.
*/
async function removeMaterializedSkills(options) {
	const { targetDir } = options;
	if (!existsSync(targetDir)) return [];
	const removed = [];
	for (const name of await listBundledSkillsOrAny(targetDir)) {
		if (options.skillNames !== void 0 && options.skillNames.length > 0 && !options.skillNames.includes(name)) continue;
		const target = join(targetDir, name);
		if ((await readMarker(target))?.owner !== "@guowenzhang/dsh-web-design") continue;
		await rm(target, {
			recursive: true,
			force: true
		});
		removed.push(name);
	}
	return removed;
}
/** List skill directories under a directory, tolerating individual read failures. */
async function listBundledSkillsOrAny(dir) {
	return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "SKILL.md"))).map((entry) => entry.name).sort();
}
/** Read one directory's ownership marker, or `undefined` when absent or unreadable. */
async function readMarker(dir) {
	try {
		const raw = await readFile(join(dir, MARKER_NAME), "utf8");
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return void 0;
		const candidate = parsed;
		if (typeof candidate.owner !== "string" || typeof candidate.version !== "string" || typeof candidate.digest !== "string") return;
		return {
			owner: candidate.owner,
			version: candidate.version,
			digest: candidate.digest
		};
	} catch {
		return;
	}
}
/**
* Digest a skill directory's contents, excluding the ownership marker itself
* so a marker write cannot change the digest it records.
* @param dir - skill directory.
* @returns a stable hex digest over sorted relative paths and file bytes.
*/
async function digestDirectory(dir) {
	const hash = createHash("sha256");
	for (const file of await listRelativeFiles(dir)) {
		if (file === ".dsh-web-design.json") continue;
		hash.update(file);
		hash.update("\0");
		hash.update(await readFile(join(dir, file)));
		hash.update("\0");
	}
	return hash.digest("hex");
}
/** Recursively list files under a directory as sorted slash-separated relative paths. */
async function listRelativeFiles(dir, base = dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...await listRelativeFiles(full, base));
		else if (entry.isFile()) out.push(relative(base, full).split(sep).join("/"));
	}
	return out.sort();
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
//#region src/index.ts
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
/** Cordis plugin name used by loader diagnostics. */
const name = "web-design";
/** Services this plugin requires; none, so it loads in any composition. */
const inject = [];
/** Schemastery validation for {@link Config}. */
const Config = z.object({
	enabled: z.boolean().default(true),
	targetDir: z.string(),
	skillNames: z.array(z.string()).default([]),
	verifyOnLoad: z.boolean().default(false)
});
/** Absolute `assets/skills` directory shipped beside this plugin's entry. */
function bundledSkillsDir() {
	return join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "skills");
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
function apply(ctx, config = {
	enabled: true,
	skillNames: [],
	verifyOnLoad: false
}) {
	new WebDesignRemote(ctx);
	if (!config.enabled) return;
	const targetDir = resolveSkillsDir(config.targetDir);
	const sourceDir = bundledSkillsDir();
	const skillNames = config.skillNames.length > 0 ? config.skillNames : void 0;
	const version = pluginVersion();
	const selection = skillNames === void 0 ? {} : { skillNames };
	const settled = materializeSkills({
		sourceDir,
		targetDir,
		version,
		...selection
	}).then((report) => {
		if (report.installed.length > 0) ctx.logger.info(`web-design: installed ${report.installed.length} skill(s) into ${report.targetDir}`);
		if (report.foreign.length > 0) ctx.logger.info(`web-design: left ${report.foreign.length} unowned skill director(ies) untouched: ${report.foreign.join(", ")}`);
	}).catch((error) => {
		ctx.logger.warn(`web-design: installing bundled skills failed: ${String(error)}`);
	});
	ctx.effect(() => () => {
		settled.then(async () => {
			const removed = await removeMaterializedSkills({
				targetDir,
				...selection
			});
			if (removed.length > 0) ctx.logger.info(`web-design: removed ${removed.length} installed skill(s) from ${targetDir}`);
		}).catch((error) => {
			ctx.logger.warn(`web-design: removing installed skills failed: ${String(error)}`);
		});
	}, "web-design: bundled skills");
}
/**
* Read this plugin's own version.
*
* The version is inlined at build time so the Host half never reads a manifest
* at runtime; a source-tree load falls back to a value that forces one refresh,
* which is the safe direction for an install that may be stale.
* @returns the build version, or a sentinel that always refreshes.
*/
function pluginVersion() {
	return "0.1.0";
}
//#endregion
export { Config, MARKER_NAME, OWNER, REMOTE_NAMESPACE, SIDECAR_SUFFIX, TYPERT_REMOTE, WebDesignRemote, apply, applySourceEdits, digestDirectory, emptyDocument, inject, listBundledSkills, materializeSkills, name, parseSelector, parseSource, readAnnotations, removeMaterializedSkills, resolveSkillsDir, sidecarPath, validateWrite, writeAnnotations };
