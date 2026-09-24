import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { parse, parseFragment } from "parse5";
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
* located element's `style` attribute, text node, or full source span is
* replaced. Every other byte of the file is preserved.
*
* @module @guowenzhang/dsh-web-design/source-edit
*/
/**
* Parse the selector grammar the preview frame emits.
*
* The frame builds `tag`, `tag#id`, and `tag:nth-of-type(n)` steps joined by
* ` > `. Id anchors use plain CSS identifiers. Other selectors are reported
* as skipped rather than guessed.
* @param selector - the frame's selector string.
* @returns the parsed steps, or `undefined` when the grammar does not match.
*/
function parseSelector(selector) {
	const trimmed = selector.trim();
	if (trimmed.length === 0) return void 0;
	const steps = [];
	for (const raw of trimmed.split(/\s*>\s*/u)) {
		const match = /^([a-z][a-z0-9-]*)(?:#([a-z_][a-z0-9_-]*))?(?::nth-of-type\((\d+)\))?$/iu.exec(raw);
		if (match === null) return void 0;
		const tag = match[1];
		/* v8 ignore next -- group 1 is mandatory in the pattern, so exec guarantees it. */
		if (tag === void 0) return void 0;
		if (match[2] !== void 0 && match[3] !== void 0) return void 0;
		const nth = match[3] === void 0 ? void 0 : Number(match[3]);
		if (nth !== void 0 && (!Number.isSafeInteger(nth) || nth < 1)) return void 0;
		steps.push({
			tag: tag.toLowerCase(),
			...match[2] === void 0 ? {} : { id: match[2] },
			...nth === void 0 ? {} : { nth }
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
* @returns the unique located element, or the reason the path cannot be trusted.
*/
function locate(root, steps) {
	const first = steps[0];
	/* v8 ignore next -- parseSelector returns a non-empty array or undefined. */
	if (first === void 0) return { reason: "element not found in source" };
	if (first.id !== void 0) {
		const anchors = findById(root, first.id);
		if (anchors.length !== 1) return { reason: anchors.length === 0 ? "element not found in source" : "duplicate id in source" };
		const anchored = anchors[0];
		/* v8 ignore next -- the length check guarantees this element. */
		if (anchored === void 0) return { reason: "element not found in source" };
		if (tagOf(anchored) !== first.tag) return { reason: "id anchor tag differs from source" };
		return steps.length === 1 ? { element: anchored } : descend(anchored, steps, 1);
	}
	const roots = childElements(root);
	const scope = roots.length === 1 && tagOf(roots[0]) === "html" ? roots[0] : root;
	if (steps.length === 1 && first.tag === "html" && isElement(scope)) return { element: scope };
	return descend(scope, steps, 0);
}
/**
* Apply selector steps from an index onward.
* @param scope - node whose element children the next step selects from.
* @param steps - the complete parsed path.
* @param from - index of the first step to apply.
* @returns the unique located element, or the reason the path cannot be trusted.
*/
function descend(scope, steps, from) {
	let current = scope;
	let found;
	for (let index = from; index < steps.length; index += 1) {
		const step = steps[index];
		/* v8 ignore next -- the loop bounds keep every index inside the array. */
		if (step === void 0) return { reason: "element not found in source" };
		const candidates = childElements(current).filter((child) => tagOf(child) === step.tag);
		let next;
		if (step.id !== void 0) {
			const matches = candidates.filter((candidate) => attrOf(candidate, "id") === step.id);
			if (matches.length > 1) return { reason: "duplicate id in source" };
			next = matches[0];
		} else if (step.nth !== void 0) {
			if (candidates.length < 2) return { reason: "sibling count differs from preview" };
			next = candidates[step.nth - 1];
		} else {
			if (candidates.length > 1) return { reason: "ambiguous selector in source" };
			next = candidates[0];
		}
		if (next === void 0) return { reason: "element not found in source" };
		found = next;
		current = next;
	}
	return found === void 0 ? { reason: "element not found in source" } : { element: found };
}
/**
* Find all elements with an id anywhere in the source tree. Duplicate ids are
* not safe anchors, even when only one match has the selector's tag.
* @param root - subtree to search.
* @param id - the id to match.
* @returns every matching element.
*/
function findById(root, id) {
	const matches = [];
	const visit = (node) => {
		for (const child of childElements(node)) {
			if (attrOf(child, "id") === id) matches.push(child);
			visit(child);
		}
	};
	visit(root);
	return matches;
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
function applySourceEdits(source, edits, textEdits = {}, deletions = []) {
	if (edits.length === 0 && Object.keys(textEdits).length === 0 && deletions.length === 0) return {
		source,
		applied: [],
		skipped: []
	};
	const document = parse(source, { sourceCodeLocationInfo: true });
	const requested = [];
	const skipped = [];
	const deletionSelectors = new Set(deletions.map((deletion) => deletion.selector));
	const locatedDeletions = [];
	for (const deletion of deletions) {
		const { selector } = deletion;
		const steps = parseSelector(selector);
		if (steps === void 0) {
			skipped.push({
				selector,
				reason: "unsupported selector grammar"
			});
			continue;
		}
		const located = locate(document, steps);
		if (located.element === void 0) {
			skipped.push({
				selector,
				reason: located.reason
			});
			continue;
		}
		const element = located.element;
		if (tagOf(element) === "html" || tagOf(element) === "head" || tagOf(element) === "body") {
			skipped.push({
				selector,
				reason: "document structure cannot be deleted"
			});
			continue;
		}
		if (normalizedElementText(element) !== deletion.text || !sameClasses(element, deletion.classes)) {
			skipped.push({
				selector,
				reason: "element fingerprint differs from source"
			});
			continue;
		}
		if (steps.some((step) => step.nth !== void 0) && matchingFingerprints(document, element, deletion).length !== 1) {
			skipped.push({
				selector,
				reason: "element fingerprint is not unique in source"
			});
			continue;
		}
		const replacement = deletionReplacement(source, element);
		if (replacement === void 0) {
			skipped.push({
				selector,
				reason: "element has no source span"
			});
			continue;
		}
		locatedDeletions.push({
			selector,
			element,
			replacement
		});
	}
	locatedDeletions.sort((left, right) => left.replacement.start - right.replacement.start || right.replacement.end - left.replacement.end);
	const deletionGroups = [];
	for (const deletion of locatedDeletions) {
		const covering = deletionGroups.find((group) => deletion.replacement.start >= group.replacement.start && deletion.replacement.end <= group.replacement.end);
		if (covering !== void 0) {
			covering.selectors.push(deletion.selector);
			continue;
		}
		deletionGroups.push({
			element: deletion.element,
			replacement: deletion.replacement,
			selectors: [deletion.selector]
		});
	}
	for (const { replacement, selectors } of deletionGroups) requested.push({
		replacement,
		selectors
	});
	const deletedElements = new Set(deletionGroups.map((group) => group.element));
	for (const edit of edits) {
		if (deletionSelectors.has(edit.selector)) continue;
		const steps = parseSelector(edit.selector);
		if (steps === void 0) {
			skipped.push({
				selector: edit.selector,
				reason: "unsupported selector grammar"
			});
			continue;
		}
		const located = locate(document, steps);
		if (located.element === void 0) {
			skipped.push({
				selector: edit.selector,
				reason: located.reason
			});
			continue;
		}
		const element = located.element;
		if (insideDeletedElement(element, deletedElements)) continue;
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
		requested.push({
			selectors: [edit.selector],
			replacement: styleReplacement(source, element, location, declarations)
		});
	}
	for (const [selector, value] of Object.entries(textEdits)) {
		if (deletionSelectors.has(selector)) continue;
		const steps = parseSelector(selector);
		if (steps === void 0) {
			skipped.push({
				selector,
				reason: "unsupported selector grammar"
			});
			continue;
		}
		const located = locate(document, steps);
		if (located.element === void 0) {
			skipped.push({
				selector,
				reason: located.reason
			});
			continue;
		}
		if (insideDeletedElement(located.element, deletedElements)) continue;
		const replacement = textReplacement(source, located.element, value);
		if (replacement === void 0) {
			skipped.push({
				selector,
				reason: "element has no editable text"
			});
			continue;
		}
		requested.push({
			selectors: [selector],
			replacement
		});
	}
	requested.sort((left, right) => left.replacement.start - right.replacement.start);
	const applied = /* @__PURE__ */ new Set();
	let out = "";
	let cursor = 0;
	let previousStart = -1;
	for (const { selectors, replacement } of requested) {
		if (replacement.start < cursor || replacement.start === previousStart) {
			for (const selector of selectors) skipped.push({
				selector,
				reason: "overlapping source edits"
			});
			continue;
		}
		out += source.slice(cursor, replacement.start) + replacement.text;
		cursor = replacement.end;
		previousStart = replacement.start;
		for (const selector of selectors) applied.add(selector);
	}
	out += source.slice(cursor);
	return {
		source: out,
		applied: [...applied],
		skipped
	};
}
/** Remove exactly one authored element span, including its descendants. */
function deletionReplacement(source, element) {
	const location = element.sourceCodeLocation;
	if (location === void 0 || location === null || location.startOffset < 0 || location.endOffset <= location.startOffset || location.endOffset > source.length) return void 0;
	return {
		start: location.startOffset,
		end: location.endOffset,
		text: ""
	};
}
/** Whether the element is covered by a deletion of itself or an ancestor. */
function insideDeletedElement(element, deleted) {
	let current = element;
	while (current !== null) {
		if (isElement(current) && deleted.has(current)) return true;
		current = "parentNode" in current ? current.parentNode : null;
	}
	return false;
}
/** Browser textContent with runs of whitespace collapsed for source comparison. */
function normalizedElementText(element) {
	const parts = [];
	const visit = (node) => {
		if (isText(node)) parts.push(node.value);
		else if ("childNodes" in node) for (const child of node.childNodes) visit(child);
	};
	visit(element);
	return parts.join("").replace(/\s+/gu, " ").trim();
}
/** Compare DOM classList tokens with the authored class attribute. */
function sameClasses(element, classes) {
	const sourceClasses = [...new Set((attrOf(element, "class") ?? "").split(/\s+/u).filter(Boolean))];
	return sourceClasses.length === classes.length && sourceClasses.every((value, index) => value === classes[index]);
}
/** Find every source element with the same fingerprint as a positional target. */
function matchingFingerprints(root, target, deletion) {
	const matches = [];
	const visit = (node) => {
		for (const child of childElements(node)) {
			if (tagOf(child) === tagOf(target) && normalizedElementText(child) === deletion.text && sameClasses(child, deletion.classes)) matches.push(child);
			visit(child);
		}
	};
	visit(root);
	return matches;
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
* A text-only element's sole text child or the only non-whitespace direct text
* child is rewritten. Descendant elements and other direct whitespace nodes
* keep their authored bytes. Multiple meaningful direct text nodes are
* ambiguous and cannot be rewritten safely.
*/
function textReplacement(source, element, value) {
	const children = "childNodes" in element ? element.childNodes : [];
	const directText = children.filter(isText);
	const meaningful = directText.filter((node) => node.value.trim() !== "");
	const text = meaningful.length === 1 ? meaningful[0] : children.length === 1 ? directText[0] : void 0;
	if (text === void 0) return void 0;
	const location = text.sourceCodeLocation;
	if (location === void 0 || location === null || location.startOffset < 0 || location.endOffset <= location.startOffset || location.endOffset > source.length) return void 0;
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
	await writeFileAtomic(storePath, `${JSON.stringify(bounded, null, 2)}\n`, { mode: 384 });
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
* already has is read-only, so the preview cannot persist edits without
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
		* so the rewrite touches only the located elements' `style` attributes,
		* text nodes, and spans selected for deletion. Nothing else in the file
		* changes. Edits that cannot be located are reported rather than dropped.
		*
		* The write is atomic: a temporary file beside the target is renamed over it,
		* so a reader never observes a half-written document.
		* @param request - the previewed file's Session address, its style edits, and
		*   its element text replacements and deletions.
		* @returns the path, what was applied and skipped, and the written size.
		* @throws a typed error when the request is unusable or the write fails.
		*/
		async apply(request) {
			const path = await this.resolveFile(request?.file, "apply");
			if (!Array.isArray(request?.edits)) throw new RemoteError("web-design/invalid", "apply requires an `edits` array", { reason: `edits was ${typeof request?.edits}` });
			const textEdits = request.textEdits ?? {};
			if (typeof textEdits !== "object" || textEdits === null || Array.isArray(textEdits)) throw new RemoteError("web-design/invalid", "apply requires `textEdits` to be an object", { reason: `textEdits was ${typeof textEdits}` });
			const deletions = request.deletions ?? [];
			if (!Array.isArray(deletions) || deletions.some((deletion) => typeof deletion !== "object" || deletion === null || typeof deletion.selector !== "string" || typeof deletion.text !== "string" || !Array.isArray(deletion.classes) || deletion.classes.some((token) => typeof token !== "string"))) throw new RemoteError("web-design/invalid", "apply requires fingerprinted `deletions`", { reason: "each deletion needs selector, normalized text, and class tokens" });
			let original;
			try {
				original = await readFile(path, "utf8");
			} catch (cause) {
				throw new RemoteError("web-design/io", `reading ${path} failed`, { reason: cause instanceof Error ? cause.message : String(cause) }, { cause });
			}
			const result = applySourceEdits(original, request.edits, textEdits, deletions);
			const changed = result.source !== original;
			if (changed) try {
				const mode = (await stat(path)).mode & 511;
				await writeFileAtomic(path, result.source, { mode });
			} catch (cause) {
				const reason = cause instanceof Error ? cause.message : String(cause);
				throw new RemoteError("web-design/io", `writing ${path} failed: ${reason}`, { reason }, { cause });
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
/** Cordis plugin name used by loader diagnostics. */
const name = "web-design";
/** Services this plugin requires; none, so it loads in any composition. */
const inject = [];
/**
* Register the review Remote the Sidebar preview calls.
*
* The Remote registers unconditionally, because a guarded registration would
* make every client call fail with a missing namespace rather than a reportable
* error.
* @param ctx - plugin context; every registration is disposed with it.
*/
function apply(ctx) {
	new WebDesignRemote(ctx);
}
//#endregion
export { REMOTE_NAMESPACE, SIDECAR_SUFFIX, TYPERT_REMOTE, WebDesignRemote, apply, applySourceEdits, emptyDocument, inject, name, parseSelector, parseSource, readAnnotations, sidecarPath, validateWrite, writeAnnotations };
