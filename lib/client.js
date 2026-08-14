window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-file-review",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/turn-deliverables.ts
		/**
		* Paths a call view reports having created or changed, by render intent rather
		* than tool name: a diff card, or a generic card whose kind is `edit` (the
		* shape `str_replace_editor`'s insert presents). Every other card produces
		* nothing to open — a read looked, a delete removed, a terminal ran. Only
		* root call views enter this Turn accumulator; nested Code Mode dispatches
		* preserve the pre-assembly behavior and do not contribute independently.
		*/
		function producedPaths(view) {
			if (view === null || view.card !== "diff" && !(view.card === "generic" && view.kind === "edit")) return [];
			const locations = view.locations;
			if (!Array.isArray(locations)) return [];
			const paths = [];
			const seen = /* @__PURE__ */ new Set();
			for (const location of locations) {
				if (typeof location !== "object" || location === null || Array.isArray(location)) continue;
				const path = location.path;
				if (typeof path !== "string" || seen.has(path)) continue;
				seen.add(path);
				paths.push(path);
			}
			return paths;
		}
		/** Validate diff hunks crossing the Host/browser transport. */
		function producedDiffs(view) {
			if (typeof view !== "object" || view === null || Array.isArray(view)) return [];
			const record = view;
			if (record.card !== "diff" || !Array.isArray(record.diffs)) return [];
			const diffs = [];
			for (const value of record.diffs) {
				if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
				const { path, oldText, newText, oldStart, newStart } = value;
				if (typeof path !== "string" || oldText !== null && typeof oldText !== "string" || typeof newText !== "string" || oldStart !== void 0 && (typeof oldStart !== "number" || !Number.isInteger(oldStart) || oldStart < 1) || newStart !== void 0 && (typeof newStart !== "number" || !Number.isInteger(newStart) || newStart < 1)) return [];
				diffs.push({
					path,
					oldText,
					newText,
					...typeof oldStart === "number" ? { oldStart } : {},
					...typeof newStart === "number" ? { newStart } : {}
				});
			}
			return diffs;
		}
		/** Applied result hunks, or successful-call intent only when no result view exists. */
		function reviewDiffs(callView, resultView) {
			if (resultView?.for === "result") return producedDiffs(resultView.view);
			return producedDiffs(callView);
		}
		/**
		* Files and review hunks available at one closing Assistant boundary.
		* @param data - engine-published Deliverables data for one Turn.
		* @param seq - closing Assistant seq; later Tool settlements are excluded.
		* @returns Produced files in first-seen order with same-path hunks appended in settlement order.
		*/
		function reviewsForClosing(data, seq = Number.POSITIVE_INFINITY) {
			if (data === void 0) return [];
			const reviews = [];
			const byPath = /* @__PURE__ */ new Map();
			for (const produced of data.produced) {
				if (produced.seq > seq) continue;
				const review = byPath.get(produced.path);
				if (review === void 0) {
					const created = {
						path: produced.path,
						diffs: [...produced.diffs]
					};
					byPath.set(produced.path, created);
					reviews.push(created);
				} else review.diffs.push(...produced.diffs);
			}
			return reviews;
		}
		/**
		* Claim the turn-tail chain only when its closing turn produced files.
		* @param owner - Turn-tail owner currency for the closing assistant.
		* @returns Produced-file reviews as the component's match, or null to decline before mount.
		*/
		function selectProducedFiles(owner) {
			const reviews = reviewsForClosing(owner.turn.data.get("deliverables"), owner.seq);
			return reviews.length === 0 ? null : reviews;
		}
		/** Turn-local successful mutation accumulator; it publishes no view Node. */
		const deliverablesDefinition = {
			kind: "deliverables",
			match: (event) => {
				if (event.type === "turn/start") return {
					id: String(event.data.turn),
					role: "start"
				};
				if (event.type === "tool/call") return {
					id: String(event.data.turn),
					role: "update"
				};
				if (event.type === "tool/result" && event.surfaceOp === "append") return {
					id: String(event.data.turn),
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "turn/start") throw new Error("deliverables start requires turn/start");
				return {
					turn: match.event.data.turn,
					calls: /* @__PURE__ */ new Map(),
					produced: []
				};
			},
			update: (context, match) => {
				if (match.event.type === "tool/call") {
					const calls = new Map(context.state.calls);
					calls.set(String(match.event.data.callId), match.view?.for === "call" ? match.view.view : null);
					return {
						...context.state,
						calls
					};
				}
				if (match.event.type !== "tool/result") return context.state;
				if (match.event.data.message.content[0].isError === true) return context.state;
				const callId = String(match.event.data.message.source.callId);
				const callView = context.state.calls.get(callId) ?? null;
				const diffs = reviewDiffs(callView, match.view);
				const additions = producedPaths(callView).map((path) => ({
					seq: match.event.seq,
					path,
					diffs: diffs.filter((diff) => diff.path === path)
				}));
				return additions.length === 0 ? context.state : {
					...context.state,
					produced: [...context.state.produced, ...additions]
				};
			},
			buildLocationData: (context, scope) => scope !== "turn" || context.state === void 0 ? null : {
				kind: "turn",
				turn: context.state.turn,
				key: "deliverables",
				value: { produced: context.state.produced }
			}
		};
		/**
		* Trailing path segment, the part that identifies the file at a glance.
		* @param path - Slash- or backslash-separated path.
		* @returns The final segment, or the whole string when separator-free.
		*/
		function basename(path) {
			const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return at === -1 ? path : path.slice(at + 1);
		}
		/**
		* File-mention vocabulary over one turn's produced paths, for the closing
		* message's prose: an inline-code token opens the file it names. A token
		* resolves by exact path, or by being exactly the basename of exactly one
		* produced path — a basename two paths share stays inert rather than
		* guessing, so a mention link can never open the wrong file or 404.
		* @param paths - The turn's produced paths (tool order, already deduped).
		* @param openFile - The chat view's file opener.
		* @param label - Localizes the accessible open-label for a resolved path.
		* @returns The resolver MarkdownText consumes; the full path rides `title`,
		* the same disambiguator the row's chips carry.
		*/
		function producedFileMentions(paths, openFile, label) {
			return { resolve(value) {
				const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value);
				if (path === void 0) return void 0;
				return {
					open: () => {
						openFile(path);
					},
					label: label(path),
					title: path
				};
			} };
		}
		/** The single produced path whose basename is exactly `value`, else undefined. */
		function onlyPathWithBasename(paths, value) {
			const matches = paths.filter((path) => basename(path) === value);
			return matches.length === 1 ? matches[0] : void 0;
		}
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/base.js
		var Diff = class {
			diff(oldStr, newStr, options = {}) {
				let callback;
				if (typeof options === "function") {
					callback = options;
					options = {};
				} else if ("callback" in options) callback = options.callback;
				const oldString = this.castInput(oldStr, options);
				const newString = this.castInput(newStr, options);
				const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
				const newTokens = this.removeEmpty(this.tokenize(newString, options));
				return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
			}
			diffWithOptionsObj(oldTokens, newTokens, options, callback) {
				var _a;
				const done = (value) => {
					value = this.postProcess(value, options);
					if (callback) {
						setTimeout(function() {
							callback(value);
						}, 0);
						return;
					} else return value;
				};
				const newLen = newTokens.length, oldLen = oldTokens.length;
				let editLength = 1;
				let maxEditLength = newLen + oldLen;
				if (options.maxEditLength != null) maxEditLength = Math.min(maxEditLength, options.maxEditLength);
				const maxExecutionTime = (_a = options.timeout) !== null && _a !== void 0 ? _a : Infinity;
				const abortAfterTimestamp = Date.now() + maxExecutionTime;
				const bestPath = [{
					oldPos: -1,
					lastComponent: void 0
				}];
				let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
				if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
				let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
				const execEditLength = () => {
					for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
						let basePath;
						const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
						if (removePath) bestPath[diagonalPath - 1] = void 0;
						let canAdd = false;
						if (addPath) {
							const addPathNewPos = addPath.oldPos - diagonalPath;
							canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
						}
						const canRemove = removePath && removePath.oldPos + 1 < oldLen;
						if (!canAdd && !canRemove) {
							bestPath[diagonalPath] = void 0;
							continue;
						}
						if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) basePath = this.addToPath(addPath, true, false, 0, options);
						else basePath = this.addToPath(removePath, false, true, 1, options);
						newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
						if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
						else {
							bestPath[diagonalPath] = basePath;
							if (basePath.oldPos + 1 >= oldLen) maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
							if (newPos + 1 >= newLen) minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
						}
					}
					editLength++;
				};
				if (callback) (function exec() {
					setTimeout(function() {
						if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) return callback(void 0);
						if (!execEditLength()) exec();
					}, 0);
				})();
				else while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
					const ret = execEditLength();
					if (ret) return ret;
				}
			}
			addToPath(path, added, removed, oldPosInc, options) {
				const last = path.lastComponent;
				if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) return {
					oldPos: path.oldPos + oldPosInc,
					lastComponent: {
						count: last.count + 1,
						added,
						removed,
						previousComponent: last.previousComponent
					}
				};
				else return {
					oldPos: path.oldPos + oldPosInc,
					lastComponent: {
						count: 1,
						added,
						removed,
						previousComponent: last
					}
				};
			}
			extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
				const newLen = newTokens.length, oldLen = oldTokens.length;
				let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
				while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
					newPos++;
					oldPos++;
					commonCount++;
					if (options.oneChangePerToken) basePath.lastComponent = {
						count: 1,
						previousComponent: basePath.lastComponent,
						added: false,
						removed: false
					};
				}
				if (commonCount && !options.oneChangePerToken) basePath.lastComponent = {
					count: commonCount,
					previousComponent: basePath.lastComponent,
					added: false,
					removed: false
				};
				basePath.oldPos = oldPos;
				return newPos;
			}
			equals(left, right, options) {
				if (options.comparator) return options.comparator(left, right);
				else return left === right || !!options.ignoreCase && left.toLowerCase() === right.toLowerCase();
			}
			removeEmpty(array) {
				const ret = [];
				for (let i = 0; i < array.length; i++) if (array[i]) ret.push(array[i]);
				return ret;
			}
			castInput(value, options) {
				return value;
			}
			tokenize(value, options) {
				return Array.from(value);
			}
			join(chars) {
				return chars.join("");
			}
			postProcess(changeObjects, options) {
				return changeObjects;
			}
			get useLongestToken() {
				return false;
			}
			buildValues(lastComponent, newTokens, oldTokens) {
				const components = [];
				let nextComponent;
				while (lastComponent) {
					components.push(lastComponent);
					nextComponent = lastComponent.previousComponent;
					delete lastComponent.previousComponent;
					lastComponent = nextComponent;
				}
				components.reverse();
				const componentLen = components.length;
				let componentPos = 0, newPos = 0, oldPos = 0;
				for (; componentPos < componentLen; componentPos++) {
					const component = components[componentPos];
					if (!component.removed) {
						if (!component.added && this.useLongestToken) {
							let value = newTokens.slice(newPos, newPos + component.count);
							value = value.map(function(value, i) {
								const oldValue = oldTokens[oldPos + i];
								return oldValue.length > value.length ? oldValue : value;
							});
							component.value = this.join(value);
						} else component.value = this.join(newTokens.slice(newPos, newPos + component.count));
						newPos += component.count;
						if (!component.added) oldPos += component.count;
					} else {
						component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
						oldPos += component.count;
					}
				}
				return components;
			}
		};
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/character.js
		var CharacterDiff = class extends Diff {};
		new CharacterDiff();
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/util/string.js
		function longestCommonPrefix(str1, str2) {
			let i;
			for (i = 0; i < str1.length && i < str2.length; i++) if (str1[i] != str2[i]) return str1.slice(0, i);
			return str1.slice(0, i);
		}
		function longestCommonSuffix(str1, str2) {
			let i;
			if (!str1 || !str2 || str1[str1.length - 1] != str2[str2.length - 1]) return "";
			for (i = 0; i < str1.length && i < str2.length; i++) if (str1[str1.length - (i + 1)] != str2[str2.length - (i + 1)]) return str1.slice(-i);
			return str1.slice(-i);
		}
		function replacePrefix(string, oldPrefix, newPrefix) {
			if (string.slice(0, oldPrefix.length) != oldPrefix) throw Error(`string ${JSON.stringify(string)} doesn't start with prefix ${JSON.stringify(oldPrefix)}; this is a bug`);
			return newPrefix + string.slice(oldPrefix.length);
		}
		function replaceSuffix(string, oldSuffix, newSuffix) {
			if (!oldSuffix) return string + newSuffix;
			if (string.slice(-oldSuffix.length) != oldSuffix) throw Error(`string ${JSON.stringify(string)} doesn't end with suffix ${JSON.stringify(oldSuffix)}; this is a bug`);
			return string.slice(0, -oldSuffix.length) + newSuffix;
		}
		function removePrefix(string, oldPrefix) {
			return replacePrefix(string, oldPrefix, "");
		}
		function removeSuffix(string, oldSuffix) {
			return replaceSuffix(string, oldSuffix, "");
		}
		function maximumOverlap(string1, string2) {
			return string2.slice(0, overlapCount(string1, string2));
		}
		function overlapCount(a, b) {
			let startA = 0;
			if (a.length > b.length) startA = a.length - b.length;
			let endB = b.length;
			if (a.length < b.length) endB = a.length;
			const map = Array(endB);
			let k = 0;
			map[0] = 0;
			for (let j = 1; j < endB; j++) {
				if (b[j] == b[k]) map[j] = map[k];
				else map[j] = k;
				while (k > 0 && b[j] != b[k]) k = map[k];
				if (b[j] == b[k]) k++;
			}
			k = 0;
			for (let i = startA; i < a.length; i++) {
				while (k > 0 && a[i] != b[k]) k = map[k];
				if (a[i] == b[k]) k++;
			}
			return k;
		}
		/**
		* Split a string into segments using a word segmenter, merging consecutive
		* segments if they are both whitespace segments. Whitespace segments can
		* appear adjacent to one another for two reasons:
		* - newlines always get their own segment
		* - where a diacritic is attached to a whitespace character in the text, the
		*   segment ends after the diacritic, so e.g. " \u0300 " becomes two segments.
		* This function therefore runs the segmenter's .segment() method and then
		* merges consecutive segments of whitespace into a single part.
		*/
		function segment(string, segmenter) {
			const parts = [];
			for (const segmentObj of Array.from(segmenter.segment(string))) {
				const segment = segmentObj.segment;
				if (parts.length && /\s/.test(parts[parts.length - 1]) && /\s/.test(segment)) parts[parts.length - 1] += segment;
				else parts.push(segment);
			}
			return parts;
		}
		function trailingWs(string, segmenter) {
			if (segmenter) return leadingAndTrailingWs(string, segmenter)[1];
			let i;
			for (i = string.length - 1; i >= 0; i--) if (!string[i].match(/\s/)) break;
			return string.substring(i + 1);
		}
		function leadingWs(string, segmenter) {
			if (segmenter) return leadingAndTrailingWs(string, segmenter)[0];
			const match = string.match(/^\s*/);
			return match ? match[0] : "";
		}
		function leadingAndTrailingWs(string, segmenter) {
			if (!segmenter) return [leadingWs(string), trailingWs(string)];
			if (segmenter.resolvedOptions().granularity != "word") throw new Error("The segmenter passed must have a granularity of \"word\"");
			const segments = segment(string, segmenter);
			const firstSeg = segments[0];
			const lastSeg = segments[segments.length - 1];
			return [/\s/.test(firstSeg) ? firstSeg : "", /\s/.test(lastSeg) ? lastSeg : ""];
		}
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/word.js
		const extendedWordChars = "a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}";
		const tokenizeIncludingWhitespace = new RegExp(`[${extendedWordChars}]+|\\s+|[^${extendedWordChars}]`, "ug");
		var WordDiff = class extends Diff {
			equals(left, right, options) {
				if (options.ignoreCase) {
					left = left.toLowerCase();
					right = right.toLowerCase();
				}
				return left.trim() === right.trim();
			}
			tokenize(value, options = {}) {
				let parts;
				if (options.intlSegmenter) {
					const segmenter = options.intlSegmenter;
					if (segmenter.resolvedOptions().granularity != "word") throw new Error("The segmenter passed must have a granularity of \"word\"");
					parts = segment(value, segmenter);
				} else parts = value.match(tokenizeIncludingWhitespace) || [];
				const tokens = [];
				let prevPart = null;
				parts.forEach((part) => {
					if (/\s/.test(part)) {
						if (prevPart == null) tokens.push(part);
						else tokens.push(tokens.pop() + part);
					} else if (prevPart != null && /\s/.test(prevPart)) {
						if (tokens[tokens.length - 1] == prevPart) tokens.push(tokens.pop() + part);
						else tokens.push(prevPart + part);
					} else tokens.push(part);
					prevPart = part;
				});
				return tokens;
			}
			join(tokens) {
				return tokens.map((token, i) => {
					if (i == 0) return token;
					else return token.replace(/^\s+/, "");
				}).join("");
			}
			postProcess(changes, options) {
				if (!changes || options.oneChangePerToken) return changes;
				let lastKeep = null;
				let insertion = null;
				let deletion = null;
				changes.forEach((change) => {
					if (change.added) insertion = change;
					else if (change.removed) deletion = change;
					else {
						if (insertion || deletion) dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, change, options.intlSegmenter);
						lastKeep = change;
						insertion = null;
						deletion = null;
					}
				});
				if (insertion || deletion) dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, null, options.intlSegmenter);
				return changes;
			}
		};
		new WordDiff();
		function dedupeWhitespaceInChangeObjects(startKeep, deletion, insertion, endKeep, segmenter) {
			if (deletion && insertion) {
				const [oldWsPrefix, oldWsSuffix] = leadingAndTrailingWs(deletion.value, segmenter);
				const [newWsPrefix, newWsSuffix] = leadingAndTrailingWs(insertion.value, segmenter);
				if (startKeep) {
					const commonWsPrefix = longestCommonPrefix(oldWsPrefix, newWsPrefix);
					startKeep.value = replaceSuffix(startKeep.value, newWsPrefix, commonWsPrefix);
					deletion.value = removePrefix(deletion.value, commonWsPrefix);
					insertion.value = removePrefix(insertion.value, commonWsPrefix);
				}
				if (endKeep) {
					const commonWsSuffix = longestCommonSuffix(oldWsSuffix, newWsSuffix);
					endKeep.value = replacePrefix(endKeep.value, newWsSuffix, commonWsSuffix);
					deletion.value = removeSuffix(deletion.value, commonWsSuffix);
					insertion.value = removeSuffix(insertion.value, commonWsSuffix);
				}
			} else if (insertion) {
				if (startKeep) {
					const ws = leadingWs(insertion.value, segmenter);
					insertion.value = insertion.value.substring(ws.length);
				}
				if (endKeep) {
					const ws = leadingWs(endKeep.value, segmenter);
					endKeep.value = endKeep.value.substring(ws.length);
				}
			} else if (startKeep && endKeep) {
				const newWsFull = leadingWs(endKeep.value, segmenter), [delWsStart, delWsEnd] = leadingAndTrailingWs(deletion.value, segmenter);
				const newWsStart = longestCommonPrefix(newWsFull, delWsStart);
				deletion.value = removePrefix(deletion.value, newWsStart);
				const newWsEnd = longestCommonSuffix(removePrefix(newWsFull, newWsStart), delWsEnd);
				deletion.value = removeSuffix(deletion.value, newWsEnd);
				endKeep.value = replacePrefix(endKeep.value, newWsFull, newWsEnd);
				startKeep.value = replaceSuffix(startKeep.value, newWsFull, newWsFull.slice(0, newWsFull.length - newWsEnd.length));
			} else if (endKeep) {
				const endKeepWsPrefix = leadingWs(endKeep.value, segmenter);
				const overlap = maximumOverlap(trailingWs(deletion.value, segmenter), endKeepWsPrefix);
				deletion.value = removeSuffix(deletion.value, overlap);
			} else if (startKeep) {
				const overlap = maximumOverlap(trailingWs(startKeep.value, segmenter), leadingWs(deletion.value, segmenter));
				deletion.value = removePrefix(deletion.value, overlap);
			}
		}
		var WordsWithSpaceDiff = class extends Diff {
			tokenize(value) {
				const regex = new RegExp(`(\\r?\\n)|[${extendedWordChars}]+|[^\\S\\n\\r]+|[^${extendedWordChars}]`, "ug");
				return value.match(regex) || [];
			}
		};
		new WordsWithSpaceDiff();
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/line.js
		var LineDiff = class extends Diff {
			constructor() {
				super(...arguments);
				this.tokenize = tokenize;
			}
			equals(left, right, options) {
				if (options.ignoreWhitespace) {
					if (!options.newlineIsToken || !left.includes("\n")) left = left.trim();
					if (!options.newlineIsToken || !right.includes("\n")) right = right.trim();
				} else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
					if (left.endsWith("\n")) left = left.slice(0, -1);
					if (right.endsWith("\n")) right = right.slice(0, -1);
				}
				return super.equals(left, right, options);
			}
		};
		new LineDiff();
		function tokenize(value, options) {
			if (options.stripTrailingCr) value = value.replace(/\r\n/g, "\n");
			const retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
			if (!linesAndNewlines[linesAndNewlines.length - 1]) linesAndNewlines.pop();
			for (let i = 0; i < linesAndNewlines.length; i++) {
				const line = linesAndNewlines[i];
				if (i % 2 && !options.newlineIsToken) retLines[retLines.length - 1] += line;
				else retLines.push(line);
			}
			return retLines;
		}
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/sentence.js
		function isSentenceEndPunct(char) {
			return char == "." || char == "!" || char == "?";
		}
		var SentenceDiff = class extends Diff {
			tokenize(value) {
				var _a;
				const result = [];
				let tokenStartI = 0;
				for (let i = 0; i < value.length; i++) {
					if (i == value.length - 1) {
						result.push(value.slice(tokenStartI));
						break;
					}
					if (isSentenceEndPunct(value[i]) && value[i + 1].match(/\s/)) {
						result.push(value.slice(tokenStartI, i + 1));
						i = tokenStartI = i + 1;
						while ((_a = value[i + 1]) === null || _a === void 0 ? void 0 : _a.match(/\s/)) i++;
						result.push(value.slice(tokenStartI, i + 1));
						tokenStartI = i + 1;
					}
				}
				return result;
			}
		};
		new SentenceDiff();
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/css.js
		var CssDiff = class extends Diff {
			tokenize(value) {
				return value.split(/([{}:;,]|\s+)/);
			}
		};
		new CssDiff();
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/json.js
		var JsonDiff = class extends Diff {
			constructor() {
				super(...arguments);
				this.tokenize = tokenize;
			}
			get useLongestToken() {
				return true;
			}
			castInput(value, options) {
				const { undefinedReplacement, stringifyReplacer = (k, v) => typeof v === "undefined" ? undefinedReplacement : v } = options;
				return typeof value === "string" ? value : JSON.stringify(canonicalize(value, null, null, stringifyReplacer), null, "  ");
			}
			equals(left, right, options) {
				return super.equals(left.replace(/,([\r\n])/g, "$1"), right.replace(/,([\r\n])/g, "$1"), options);
			}
		};
		new JsonDiff();
		function canonicalize(obj, stack, replacementStack, replacer, key) {
			stack = stack || [];
			replacementStack = replacementStack || [];
			if (replacer) obj = replacer(key === void 0 ? "" : key, obj);
			let i;
			for (i = 0; i < stack.length; i += 1) if (stack[i] === obj) return replacementStack[i];
			let canonicalizedObj;
			if ("[object Array]" === Object.prototype.toString.call(obj)) {
				stack.push(obj);
				canonicalizedObj = new Array(obj.length);
				replacementStack.push(canonicalizedObj);
				for (i = 0; i < obj.length; i += 1) canonicalizedObj[i] = canonicalize(obj[i], stack, replacementStack, replacer, String(i));
				stack.pop();
				replacementStack.pop();
				return canonicalizedObj;
			}
			if (obj && obj.toJSON) obj = obj.toJSON();
			if (typeof obj === "object" && obj !== null) {
				stack.push(obj);
				canonicalizedObj = {};
				replacementStack.push(canonicalizedObj);
				const sortedKeys = [];
				let key;
				for (key in obj)
 /* istanbul ignore else */
				if (Object.prototype.hasOwnProperty.call(obj, key)) sortedKeys.push(key);
				sortedKeys.sort();
				for (i = 0; i < sortedKeys.length; i += 1) {
					key = sortedKeys[i];
					canonicalizedObj[key] = canonicalize(obj[key], stack, replacementStack, replacer, key);
				}
				stack.pop();
				replacementStack.pop();
			} else canonicalizedObj = obj;
			return canonicalizedObj;
		}
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/array.js
		var ArrayDiff = class extends Diff {
			tokenize(value) {
				return value.slice();
			}
			join(value) {
				return value;
			}
			removeEmpty(value) {
				return value;
			}
		};
		const arrayDiff = new ArrayDiff();
		function diffArrays(oldArr, newArr, options) {
			return arrayDiff.diff(oldArr, newArr, options);
		}
		//#endregion
		//#region src/client/diff-text.ts
		/**
		* Split one side of a diff into content lines without manufacturing a final
		* empty line for a trailing line terminator.
		* @param text - One diff side's text.
		* @returns Content lines without the terminating newline.
		*/
		function diffContentLines(text) {
			if (text === "") return [];
			return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
		}
		//#endregion
		//#region \0dsh-file-review-css:/Users/leftover/Desktop/projects/deepseek-harness/plugins/dsh-file-review/src/client/UnifiedDiff.module.css.mjs
		const css$1 = ".OSxS6G_unifiedBlock{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-markdown-code-block);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;margin:16px 0;position:relative;overflow:hidden}.OSxS6G_unifiedCopyButton{z-index:2;color:var(--dsw-alias-label-secondary);cursor:pointer;font:var(--dsw-font-xs-13);background:0 0;border:0;padding:0;position:absolute;top:10px;right:12px}.OSxS6G_unifiedFile+.OSxS6G_unifiedFile{border-top:1px solid var(--dsw-alias-border-l2)}.OSxS6G_unifiedHeader{border-bottom:1px solid var(--dsw-alias-border-l2);min-height:38px;font:var(--dsw-font-markdown-code-block);align-items:center;gap:8px;padding:0 72px 0 12px;display:flex}.OSxS6G_unifiedStatus{color:var(--dsw-alias-state-success-primary);font-weight:700}.OSxS6G_unifiedPath{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.OSxS6G_unifiedAdded{color:var(--dsw-alias-state-success-primary);margin-left:auto}.OSxS6G_unifiedRemoved{color:var(--dsw-alias-state-error-primary)}.OSxS6G_unifiedHunkHeader{border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-markdown-code-block);padding:6px 12px}.OSxS6G_unifiedBody{font:var(--dsw-font-markdown-code-block);overflow:auto hidden}.OSxS6G_unifiedLine{white-space:pre;grid-template-columns:48px 48px 24px minmax(max-content,1fr);min-width:max-content;min-height:23px;line-height:23px;display:grid}.OSxS6G_unifiedOldNumber,.OSxS6G_unifiedNewNumber{border-right:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);text-align:right;user-select:none;padding:0 8px}.OSxS6G_unifiedSign{text-align:center;user-select:none}.OSxS6G_unifiedText{padding-right:14px}.OSxS6G_unified_del{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 11%, transparent)}.OSxS6G_unified_add{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 11%, transparent)}.OSxS6G_unified_context{color:var(--dsw-alias-label-primary)}.OSxS6G_unifiedGap{border:0;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-border-l1);width:100%;min-height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:var(--dsw-font-xs-13);text-align:left;padding:0 12px 0 120px;display:block}.OSxS6G_unifiedGap:hover{color:var(--dsw-alias-label-primary)}.OSxS6G_unifiedOmitted{border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-border-l1);min-height:32px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);align-items:center;gap:12px;padding:0 12px;display:flex}";
		const styleId$1 = "@deepseek-ai/dsh-file-review/UnifiedDiff.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId$1) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "@deepseek-ai/dsh-file-review";
			style.dataset.pluginCss = styleId$1;
			style.textContent = css$1;
			document.head.appendChild(style);
		}
		var UnifiedDiff_module_css_default = {
			"unified_del": "OSxS6G_unified_del",
			"unifiedOldNumber": "OSxS6G_unifiedOldNumber",
			"unifiedFile": "OSxS6G_unifiedFile",
			"unifiedRemoved": "OSxS6G_unifiedRemoved",
			"unifiedCopyButton": "OSxS6G_unifiedCopyButton",
			"unifiedBody": "OSxS6G_unifiedBody",
			"unified_context": "OSxS6G_unified_context",
			"unifiedAdded": "OSxS6G_unifiedAdded",
			"unifiedNewNumber": "OSxS6G_unifiedNewNumber",
			"unifiedHeader": "OSxS6G_unifiedHeader",
			"unifiedLine": "OSxS6G_unifiedLine",
			"unifiedText": "OSxS6G_unifiedText",
			"unified_add": "OSxS6G_unified_add",
			"unifiedBlock": "OSxS6G_unifiedBlock",
			"unifiedStatus": "OSxS6G_unifiedStatus",
			"unifiedPath": "OSxS6G_unifiedPath",
			"unifiedHunkHeader": "OSxS6G_unifiedHunkHeader",
			"unifiedGap": "OSxS6G_unifiedGap",
			"unifiedOmitted": "OSxS6G_unifiedOmitted",
			"unifiedSign": "OSxS6G_unifiedSign"
		};
		//#endregion
		//#region src/client/UnifiedDiff.tsx
		function hunkLines(diff) {
			const changes = diffArrays(diff.oldText === null ? [] : diffContentLines(diff.oldText), diffContentLines(diff.newText));
			const lines = [];
			let oldNumber = diff.oldStart ?? 1;
			let newNumber = diff.newStart ?? 1;
			for (const change of changes) if (change.removed) for (const text of change.value) {
				lines.push({
					kind: "del",
					oldNumber,
					newNumber: null,
					text
				});
				oldNumber++;
			}
			else if (change.added) for (const text of change.value) {
				lines.push({
					kind: "add",
					oldNumber: null,
					newNumber,
					text
				});
				newNumber++;
			}
			else for (const text of change.value) {
				lines.push({
					kind: "context",
					oldNumber,
					newNumber,
					text
				});
				oldNumber++;
				newNumber++;
			}
			return lines;
		}
		function collapsedRows(lines, contextLines, hunkIndex) {
			const rows = [];
			let cursor = 0;
			let gapIndex = 0;
			while (cursor < lines.length) {
				const current = lines[cursor];
				if (current?.kind !== "context") {
					if (current !== void 0) rows.push(current);
					cursor++;
					continue;
				}
				const start = cursor;
				while (cursor < lines.length && lines[cursor]?.kind === "context") cursor++;
				const run = lines.slice(start, cursor);
				const leading = start === 0;
				const trailing = cursor === lines.length;
				const hiddenStart = leading ? 0 : Math.min(contextLines, run.length);
				const hiddenEnd = trailing ? run.length : Math.max(hiddenStart, run.length - contextLines);
				rows.push(...run.slice(0, hiddenStart));
				const hidden = run.slice(hiddenStart, hiddenEnd);
				if (hidden.length > 0) {
					rows.push({
						kind: "gap",
						id: `${hunkIndex}:${gapIndex}`,
						lines: hidden
					});
					gapIndex++;
				}
				rows.push(...run.slice(hiddenEnd));
			}
			return rows;
		}
		function buildHunks(diffs, contextLines) {
			let previousPath;
			let previousOldEnd = 1;
			let previousNewEnd = 1;
			return diffs.map((diff, index) => {
				const lines = hunkLines(diff);
				const oldCount = lines.filter((line) => line.oldNumber !== null).length;
				const newCount = lines.filter((line) => line.newNumber !== null).length;
				const oldStart = diff.oldStart ?? 1;
				const newStart = diff.newStart ?? 1;
				const unchangedBefore = diff.oldStart !== void 0 && diff.newStart !== void 0 ? Math.max(0, Math.min(oldStart - (diff.path === previousPath ? previousOldEnd : 1), newStart - (diff.path === previousPath ? previousNewEnd : 1))) : 0;
				previousPath = diff.path;
				previousOldEnd = oldStart + oldCount;
				previousNewEnd = newStart + newCount;
				return {
					rows: collapsedRows(lines, contextLines, index),
					added: lines.filter((line) => line.kind === "add").length,
					removed: lines.filter((line) => line.kind === "del").length,
					unchangedBefore
				};
			});
		}
		function copyText(diffs) {
			let previousPath;
			const output = [];
			for (const diff of diffs) {
				if (diff.path !== previousPath) output.push(diff.path);
				else output.push(`@@ -${diff.oldStart ?? 1} +${diff.newStart ?? 1} @@`);
				previousPath = diff.path;
				for (const line of hunkLines(diff)) {
					const prefix = line.kind === "del" ? "-" : line.kind === "add" ? "+" : " ";
					output.push(`${prefix} ${line.text}`);
				}
			}
			return output.join("\n");
		}
		function lineNumbers(line) {
			return `${line.oldNumber === null ? "" : String(line.oldNumber)}, ${line.newNumber === null ? "" : String(line.newNumber)}`;
		}
		/**
		* Render line-aligned hunks with old/new gutters and expandable context gaps.
		* @param props - Unified diff data, locale labels, and presentation options.
		* @returns The line-numbered unified diff surface.
		*/
		function UnifiedDiff({ diffs, contextLines, labels, className }) {
			const hunks = (0, react.useMemo)(() => buildHunks(diffs, contextLines), [contextLines, diffs]);
			const [expandedGaps, setExpandedGaps] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [copied, setCopied] = (0, react.useState)(false);
			const onCopy = (0, react.useCallback)(() => {
				if (copied) return;
				navigator.clipboard?.writeText(copyText(diffs)).then(() => {
					setCopied(true);
					window.setTimeout(() => {
						setCopied(false);
					}, 1e3);
				}).catch(() => {});
			}, [copied, diffs]);
			if (diffs.length === 0) return null;
			const totals = /* @__PURE__ */ new Map();
			for (const [index, diff] of diffs.entries()) {
				const hunk = hunks[index];
				const previous = totals.get(diff.path) ?? {
					added: 0,
					removed: 0
				};
				totals.set(diff.path, {
					added: previous.added + (hunk?.added ?? 0),
					removed: previous.removed + (hunk?.removed ?? 0)
				});
			}
			let previousPath;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${UnifiedDiff_module_css_default.unifiedBlock} ${className ?? ""}`,
				"data-diff": "",
				"data-diff-layout": "unified",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: UnifiedDiff_module_css_default.unifiedCopyButton,
					onClick: onCopy,
					children: copied ? labels.copied : labels.copy
				}), diffs.map((diff, hunkIndex) => {
					const firstForPath = diff.path !== previousPath;
					previousPath = diff.path;
					const total = totals.get(diff.path) ?? {
						added: 0,
						removed: 0
					};
					const hunk = hunks[hunkIndex];
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: UnifiedDiff_module_css_default.unifiedFile,
						children: [firstForPath ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: UnifiedDiff_module_css_default.unifiedHeader,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: UnifiedDiff_module_css_default.unifiedStatus,
									children: "M"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: UnifiedDiff_module_css_default.unifiedPath,
									children: diff.path
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: UnifiedDiff_module_css_default.unifiedAdded,
									children: ["+", total.added]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: UnifiedDiff_module_css_default.unifiedRemoved,
									children: ["-", total.removed]
								})
							]
						}) : (hunk?.unchangedBefore ?? 0) === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: UnifiedDiff_module_css_default.unifiedHunkHeader,
							children: [
								"@@ -",
								diff.oldStart ?? 1,
								" +",
								diff.newStart ?? 1,
								" @@"
							]
						}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: UnifiedDiff_module_css_default.unifiedBody,
							children: [(hunk?.unchangedBefore ?? 0) > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: UnifiedDiff_module_css_default.unifiedOmitted,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									children: "↕"
								}), labels.showUnchanged(hunk?.unchangedBefore ?? 0)]
							}), (hunk?.rows ?? []).flatMap((row) => {
								if (row.kind !== "gap") {
									const sign = row.kind === "del" ? "-" : row.kind === "add" ? "+" : " ";
									return [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: `${UnifiedDiff_module_css_default.unifiedLine} ${UnifiedDiff_module_css_default[`unified_${row.kind}`] ?? ""}`,
										"data-line-kind": row.kind,
										"data-old-line": row.oldNumber ?? void 0,
										"data-new-line": row.newNumber ?? void 0,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: UnifiedDiff_module_css_default.unifiedOldNumber,
												children: row.oldNumber
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: UnifiedDiff_module_css_default.unifiedNewNumber,
												children: row.newNumber
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: UnifiedDiff_module_css_default.unifiedSign,
												children: sign
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: UnifiedDiff_module_css_default.unifiedText,
												children: row.text
											})
										]
									}, `${row.kind}:${row.oldNumber ?? ""}:${row.newNumber ?? ""}`)];
								}
								if (expandedGaps.has(row.id)) return [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: UnifiedDiff_module_css_default.unifiedGap,
									"aria-expanded": "true",
									onClick: () => {
										setExpandedGaps((current) => {
											const next = new Set(current);
											next.delete(row.id);
											return next;
										});
									},
									children: labels.hideUnchanged(row.lines.length)
								}, `${row.id}:control`), ...row.lines.map((line) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: `${UnifiedDiff_module_css_default.unifiedLine} ${UnifiedDiff_module_css_default.unified_context}`,
									"data-line-kind": "context",
									"data-old-line": line.oldNumber ?? void 0,
									"data-new-line": line.newNumber ?? void 0,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: UnifiedDiff_module_css_default.unifiedOldNumber,
											children: line.oldNumber
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: UnifiedDiff_module_css_default.unifiedNewNumber,
											children: line.newNumber
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: UnifiedDiff_module_css_default.unifiedSign,
											children: " "
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: UnifiedDiff_module_css_default.unifiedText,
											children: line.text
										})
									]
								}, `${row.id}:${lineNumbers(line)}`))];
								return [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: UnifiedDiff_module_css_default.unifiedGap,
									"aria-expanded": "false",
									onClick: () => {
										setExpandedGaps((current) => /* @__PURE__ */ new Set([...current, row.id]));
									},
									children: labels.showUnchanged(row.lines.length)
								}, row.id)];
							})]
						})]
					}, `${diff.path}:${hunkIndex}`);
				})]
			});
		}
		//#endregion
		//#region \0dsh-file-review-css:/Users/leftover/Desktop/projects/deepseek-harness/plugins/dsh-file-review/src/client/ProducedFiles.module.css.mjs
		const css = ".LUmeZW_root{grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:6px 8px;margin-top:16px;font-size:13px;line-height:22px;display:grid;position:relative}.LUmeZW_label{color:var(--dsw-alias-label-tertiary);grid-area:1/1}.LUmeZW_row{flex-wrap:nowrap;grid-area:1/2;align-items:center;gap:8px;min-width:0;display:flex;overflow:hidden}.LUmeZW_file{text-overflow:ellipsis;white-space:nowrap;background:var(--dsw-alias-interactive-bg-hover);max-width:320px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border:none;border-radius:6px;flex:none;margin:0;padding:0 8px;overflow:hidden}.LUmeZW_file:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}.LUmeZW_file:focus-visible,.LUmeZW_showFolder:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}.LUmeZW_more{white-space:nowrap;color:var(--dsw-alias-label-tertiary);flex:none}.LUmeZW_showFolder{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:none;border-radius:4px;grid-area:2/2;justify-self:start;margin:0;padding:0 2px;line-height:20px}.LUmeZW_showFolder:hover{color:var(--dsw-alias-label-secondary);text-decoration:underline}.LUmeZW_measure{visibility:hidden;pointer-events:none;contain:strict;width:0;height:0;position:absolute;overflow:hidden}.LUmeZW_probe{width:max-content;position:absolute;inset:0 auto auto 0}.LUmeZW_reviewDialog.LUmeZW_reviewDialog{width:min(760px,100%);max-height:calc(100vh - 48px)}.LUmeZW_reviewContent{min-height:0;overflow:auto}.LUmeZW_reviewDiff{flex:none}.LUmeZW_reviewUnavailable{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:20px}";
		const styleId = "@deepseek-ai/dsh-file-review/ProducedFiles.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "@deepseek-ai/dsh-file-review";
			style.dataset.pluginCss = styleId;
			style.textContent = css;
			document.head.appendChild(style);
		}
		var ProducedFiles_module_css_default = {
			"probe": "LUmeZW_probe",
			"row": "LUmeZW_row",
			"showFolder": "LUmeZW_showFolder",
			"reviewUnavailable": "LUmeZW_reviewUnavailable",
			"measure": "LUmeZW_measure",
			"reviewDialog": "LUmeZW_reviewDialog",
			"reviewContent": "LUmeZW_reviewContent",
			"reviewDiff": "LUmeZW_reviewDiff",
			"file": "LUmeZW_file",
			"label": "LUmeZW_label",
			"root": "LUmeZW_root",
			"more": "LUmeZW_more"
		};
		//#endregion
		//#region src/client/ProducedFiles.tsx
		/** At most six chips compete for the one-line summary; every other path stays counted. */
		const SHOWN_LIMIT = 6;
		/**
		* Select the largest prefix whose measured chips and exact remainder fit.
		* @param available - usable width of the one-line file lane.
		* @param gap - computed flex gap between adjacent visible items.
		* @param chipWidths - measured widths for the candidate file chips.
		* @param moreWidthsByShown - exact localized remainder width for each shown count.
		* @returns Number of leading chips to render.
		*/
		function fitProducedFiles(available, gap, chipWidths, moreWidthsByShown) {
			if (available <= 0) return chipWidths.length;
			const prefix = [0];
			let prefixWidth = 0;
			for (const width of chipWidths) {
				prefixWidth += width;
				prefix.push(prefixWidth);
			}
			let largestFit = 0;
			for (const [shown, width] of prefix.entries()) {
				const more = moreWidthsByShown[shown];
				const items = shown + (more === void 0 ? 0 : 1);
				if (width + (more ?? 0) + Math.max(0, items - 1) * gap <= available) largestFit = shown;
			}
			return largestFit;
		}
		function moreLabel(t, count) {
			return count === 1 ? t("produced.moreOne") : t("produced.more", { count: String(count) });
		}
		/**
		* Render one turn's produced files as review chips.
		* @param props - selector-matched reviews, the chat view's file opener, and the locale seat.
		* @returns The produced-files row.
		*/
		function ProducedFiles({ matched: reviews, openFile, isLoopback, useHostDescription, t }) {
			const paths = (0, react.useMemo)(() => reviews.map((review) => review.path), [reviews]);
			const hostCanOpenPath = useHostDescription((description) => description?.canOpenPath === true);
			const canOpenPath = isLoopback && hostCanOpenPath;
			const limit = Math.min(paths.length, SHOWN_LIMIT);
			const [shownCount, setShownCount] = (0, react.useState)(limit);
			const [selected, setSelected] = (0, react.useState)(null);
			const rowRef = (0, react.useRef)(null);
			const chipProbes = (0, react.useRef)([]);
			const moreProbe = (0, react.useRef)(null);
			(0, react.useLayoutEffect)(() => {
				const row = rowRef.current;
				const remainderProbe = moreProbe.current;
				/* v8 ignore next -- React attaches both refs before the layout effect runs. */
				if (row === null || remainderProbe === null) return;
				const measure = () => {
					const styles = getComputedStyle(row);
					const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
					const chips = chipProbes.current.slice(0, limit).map((probe) => probe.getBoundingClientRect().width);
					const more = Array.from({ length: limit + 1 }, (_, candidate) => {
						if (paths.length === candidate) return void 0;
						remainderProbe.textContent = moreLabel(t, paths.length - candidate);
						return remainderProbe.getBoundingClientRect().width;
					});
					setShownCount(fitProducedFiles(row.clientWidth, gap, chips, more));
				};
				measure();
				if (typeof ResizeObserver === "undefined") return;
				const observer = new ResizeObserver(measure);
				observer.observe(row);
				for (const probe of [...chipProbes.current, moreProbe.current]) if (probe !== null) observer.observe(probe);
				return () => {
					observer.disconnect();
				};
			}, [
				limit,
				paths,
				t
			]);
			const visibleCount = Math.min(shownCount, limit);
			const shown = reviews.slice(0, visibleCount);
			const hidden = reviews.length - shown.length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProducedFiles_module_css_default.root,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ProducedFiles_module_css_default.label,
						children: t("produced.label")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: rowRef,
						className: ProducedFiles_module_css_default.row,
						"data-produced-files-row": true,
						children: [shown.map((review) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ProducedFiles_module_css_default.file,
							title: review.path,
							"aria-label": t("produced.review", { name: review.path }),
							onClick: () => {
								setSelected(review);
							},
							children: basename(review.path)
						}, review.path)), hidden > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProducedFiles_module_css_default.more,
							children: moreLabel(t, hidden)
						})]
					}),
					hidden > 0 && canOpenPath && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ProducedFiles_module_css_default.showFolder,
						onClick: () => {
							openFile(".");
						},
						children: t("produced.showInFolder")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProducedFiles_module_css_default.measure,
						"aria-hidden": "true",
						children: [paths.slice(0, limit).map((path, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							ref: (node) => {
								chipProbes.current[index] = node;
							},
							type: "button",
							tabIndex: -1,
							className: `${ProducedFiles_module_css_default.file} ${ProducedFiles_module_css_default.probe}`,
							children: basename(path)
						}, path)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							ref: moreProbe,
							className: `${ProducedFiles_module_css_default.more} ${ProducedFiles_module_css_default.probe}`
						})]
					}),
					selected !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: true,
						onClose: () => {
							setSelected(null);
						},
						title: t("review.title", { name: selected.path }),
						closeLabel: t("review.close"),
						className: ProducedFiles_module_css_default.reviewDialog ?? "",
						contentClassName: ProducedFiles_module_css_default.reviewContent ?? "",
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: () => {
								setSelected(null);
							},
							children: t("review.close")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							onClick: () => {
								openFile(selected.path);
								setSelected(null);
							},
							children: t("review.openInEditor")
						})] }),
						children: selected.diffs.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: ProducedFiles_module_css_default.reviewUnavailable,
							children: t("review.unavailable")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnifiedDiff, {
							diffs: selected.diffs.map((diff) => ({ ...diff })),
							contextLines: 3,
							labels: {
								copy: t("review.copy"),
								copied: t("review.copied"),
								showUnchanged: (count) => t("review.showUnchanged", { count: String(count) }),
								hideUnchanged: (count) => t("review.hideUnchanged", { count: String(count) })
							},
							className: ProducedFiles_module_css_default.reviewDiff
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** `file-review` namespace dictionaries. */
		/** Dictionary namespace owned by this plugin. */
		const NS = "file-review";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"produced.label": "产物",
			"produced.moreOne": "+ 1 个文件",
			"produced.more": "+ {count} 个文件",
			"produced.open": "打开 {name}",
			"produced.review": "审查 {name}",
			"produced.showInFolder": "在文件夹中显示",
			"review.title": "审查 {name}",
			"review.close": "关闭",
			"review.openInEditor": "在编辑器中打开",
			"review.copy": "复制",
			"review.copied": "复制成功",
			"review.showUnchanged": "{count} 行未修改",
			"review.hideUnchanged": "收起 {count} 行未修改内容",
			"review.unavailable": "此修改没有可重建的差异。你仍然可以打开当前文件。"
		};
		/** English dictionary (same key set). */
		const en = {
			"produced.label": "Produced",
			"produced.moreOne": "+ 1 file",
			"produced.more": "+ {count} files",
			"produced.open": "Open {name}",
			"produced.review": "Review {name}",
			"produced.showInFolder": "Show in folder",
			"review.title": "Review {name}",
			"review.close": "Close",
			"review.openInEditor": "Open in editor",
			"review.copy": "Copy",
			"review.copied": "Copied",
			"review.showUnchanged": "{count} unchanged lines",
			"review.hideUnchanged": "Hide {count} unchanged lines",
			"review.unavailable": "No reconstructable diff is available for this change. You can still open the current file."
		};
		//#endregion
		//#region src/client/index.ts
		/** Required services for the tail-slot registration and its dictionaries. */
		const inject = [
			"slots",
			"locale",
			"conversationEvents",
			"connection"
		];
		/**
		* Client plugin body: register the dictionaries and the turn-tail entry.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			const connection = ctx.get("connection");
			ctx.conversationEvents.register(deliverablesDefinition);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "file-review: dictionaries");
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				select: selectProducedFiles,
				locale: NS,
				inject: () => ({
					isLoopback: connection.isLoopback,
					hooks: { hostDescription: connection.hostDescription }
				})
			}, ProducedFiles));
			const t = ctx.locale.bind(NS);
			ctx.provide("chatFileMentions", { forClosing(owner) {
				const reviews = selectProducedFiles(owner);
				if (reviews === null) return void 0;
				return producedFileMentions(reviews.map((review) => review.path), owner.openFile, (path) => t("produced.open", { name: path }));
			} });
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map