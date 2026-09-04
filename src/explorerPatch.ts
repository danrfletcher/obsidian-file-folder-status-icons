import { App, Menu, Notice, TAbstractFile, TFolder, View, WorkspaceLeaf } from "obsidian";
import { DataStore } from "./dataStore";
import { ROOT_PATH, basename, parentPath } from "./pathUtils";
import { openStatusPopup, openStatusSetPopup } from "./statusPopup";
import { ResolvedDisplay, StatusDefinition, TruncationRule } from "./types";

const FILE_EXPLORER_TYPE = "file-explorer";
const DOT_CLASS = "ffsi-dot";
/** Synthetic "N Status" summary row standing in for a collapsed truncation group. */
const GROUP_ROW_CLASS = "ffsi-trunc-row";
/**
 * Set on a real item's `.ffsi-dot` while its truncation group is expanded —
 * marks it as double-click-to-collapse and (see attachDotInterceptor) delays
 * its normal single-click behaviour just long enough for a following
 * dblclick to cancel it instead of both firing.
 */
const GROUP_MEMBER_ATTR = "data-ffsi-group";
/**
 * Set on a collapsed truncation group's summary row (the whole title
 * element, not just the dot) — clicking anywhere on it, dot or text, expands
 * the group. See attachDotInterceptor() for why this has to be read by the
 * same window-level capturing listener rather than a plain listener on the
 * row itself.
 */
const GROUP_SUMMARY_ATTR = "data-ffsi-trunc-summary";
/** Fingerprint of a summary row's rendered content — see buildGroupRow() and its reuse check in processContainer(). */
const GROUP_ROW_SIG_ATTR = "data-ffsi-group-sig";
/**
 * Window within which two `mousedown`s on the same dot count as a
 * double-click, and how long a single one waits before acting (in case a
 * second follows) — see attachDotInterceptor() for why this is driven off
 * mousedown/manual timing rather than the native `click`/`dblclick` events.
 * Also used to detect double-click when that's the configured status-menu
 * trigger (see DataStore#getStatusMenuTrigger) on an *ungrouped* dot.
 */
const DOUBLE_CLICK_MS = 400;
/** How long a left mousedown on a dot must be held for "Long click" mode to open the status popup. */
const LONG_PRESS_MS = 500;

/**
 * `MenuItem.setSubmenu(): Menu` exists at runtime but isn't declared in
 * Obsidian's public .d.ts — every plugin that builds a submenu (this
 * includes several first-party-adjacent ones) casts through something like
 * this rather than `any` everywhere it's used.
 */
interface WithSubmenu {
	setSubmenu(): Menu;
}

/**
 * Decorates Obsidian's native file explorer with status dots, wires up the
 * click-to-change-status popup, the right-click enable/disable folder menu,
 * and keeps direct children of "group by status" folders sorted.
 *
 * Deliberately DOM/observer based rather than monkey-patching FileExplorer
 * internals: `data-path` attributes and the .nav-file/.nav-folder structure
 * are far more stable across Obsidian releases than private view methods.
 */
export class ExplorerPatch {
	/**
	 * One observer per file-explorer root (keyed by that view's containerEl),
	 * not a single shared one — a popped-out file explorer window is a
	 * second, independent root, and the previous single-observer field meant
	 * enable()'ing a second view silently stopped watching the first.
	 */
	private observers = new Map<HTMLElement, MutationObserver>();
	private dirtyContainers = new Set<HTMLElement>();
	private flushScheduled = false;
	// One delegated, capturing listener per window per event type rather than
	// a listener per dot — see attachDotInterceptor() for why this has to be
	// window-level (capture) rather than an ordinary listener on each dot.
	private dotWindowListeners = new Map<Window, { type: string; fn: (evt: Event) => void }[]>();
	/** Pending (delayed) single-click handlers for truncation-group members, keyed by dot element — see attachDotInterceptor(). */
	private pendingDotActions = new Map<HTMLElement, number>();
	/** Timestamp of the last mousedown on each dot, for manual double-click detection — see attachDotInterceptor(). */
	private lastDotMouseDown = new Map<HTMLElement, number>();
	/** Cleanup functions for an in-progress "Long click" hold on a dot, keyed by dot element — see beginLongPress(). */
	private pendingLongPress = new Map<HTMLElement, () => void>();
	/** Truncation groups the user has expanded, keyed by `${folderPath} ${statusId}`. Not persisted — collapsed again on reload. */
	private expandedGroups = new Set<string>();

	constructor(private app: App, private store: DataStore) {}

	enable(): void {
		this.forEachExplorerView((view) => {
			this.attachObserver(view.containerEl);
			this.attachDotInterceptor(view.containerEl);
		});
		this.refreshAll();
	}

	disable(): void {
		for (const observer of this.observers.values()) observer.disconnect();
		this.observers.clear();
		this.dirtyContainers.clear();
		this.flushScheduled = false; // a microtask flush already in flight will see observers.size === 0 and no-op
		for (const [win, listeners] of this.dotWindowListeners) {
			for (const { type, fn } of listeners) win.removeEventListener(type, fn, true);
		}
		this.dotWindowListeners.clear();
		for (const [dot, handle] of this.pendingDotActions) {
			dot.win.clearTimeout(handle);
		}
		this.pendingDotActions.clear();
		this.lastDotMouseDown.clear();
		for (const cleanup of this.pendingLongPress.values()) cleanup();
		this.pendingLongPress.clear();
		this.expandedGroups.clear();
		document.querySelectorAll(`.${DOT_CLASS}, .${GROUP_ROW_CLASS}`).forEach((el) => el.remove());
		// Belt-and-suspenders: a popup or menu-anchor left open at unload time
		// would otherwise leak its own document-level listeners (see statusPopup.ts).
		document.querySelectorAll(".ffsi-popup, .ffsi-menu-anchor").forEach((el) => el.remove());
	}

	/** Call after any data change (status edited, folder enabled/disabled, etc). */
	refreshAll(): void {
		this.forEachExplorerView((view) => {
			view.containerEl.toggleClass("ffsi-glow", this.store.isGlowEnabled());
			const root = view.containerEl.querySelector<HTMLElement>(".nav-files-container");
			if (!root) return;
			// Re-decorate the root list plus every already-expanded subfolder — a
			// folder's .nav-folder-children only fires a mutation when it's first
			// rendered, not when its governing config changes after the fact.
			this.queueContainer(root);
			root.querySelectorAll<HTMLElement>(".nav-folder-children").forEach((el) => this.queueContainer(el));
		});
	}

	/**
	 * All of this plugin's folder context-menu actions nest under a single
	 * "File and Folder Status Options" submenu item, rather than adding
	 * several top-level entries to Obsidian's already-crowded right-click
	 * menu. `MenuItem.setSubmenu()` isn't part of the public API surface
	 * (see the local `WithSubmenu` cast below) but is the standard mechanism
	 * community plugins use for this — it's been stable across Obsidian
	 * releases for years.
	 */
	registerFolderContextMenu(menu: Menu, file: TAbstractFile): void {
		if (!(file instanceof TFolder)) return;
		const folderPath = file.path === "/" ? ROOT_PATH : file.path;
		const own = this.store.getFolderConfig(folderPath);

		menu.addItem((item) => {
			item.setTitle("File and Folder Status Options").setIcon("circle-dot");
			const submenu = (item as unknown as WithSubmenu).setSubmenu();

			if (!own) {
				submenu.addItem((sub) =>
					sub
						.setTitle("Enable statuses for this folder")
						.setIcon("circle-dot")
						.onClick((evt) => this.startEnableFlow(folderPath, evt)),
				);
				return;
			}

			submenu.addItem((sub) =>
				sub
					.setTitle("Change default status for this folder")
					.setIcon("circle-dot")
					.onClick((evt) => this.startChangeDefaultFlow(folderPath, evt)),
			);
			submenu.addItem((sub) =>
				sub
					.setTitle(own.hideCompleted ? "Show completed items" : "Hide completed items")
					.setIcon(own.hideCompleted ? "eye" : "eye-off")
					.onClick(() => {
						this.store.updateFolderConfig(folderPath, { hideCompleted: !own.hideCompleted });
						this.refreshAll();
					}),
			);
			submenu.addItem((sub) =>
				sub
					.setTitle(own.hideCancelled ? "Show cancelled items" : "Hide cancelled items")
					.setIcon(own.hideCancelled ? "eye" : "eye-off")
					.onClick(() => {
						this.store.updateFolderConfig(folderPath, { hideCancelled: !own.hideCancelled });
						this.refreshAll();
					}),
			);
			submenu.addItem((sub) =>
				sub
					.setTitle("Disable statuses for this folder")
					.setIcon("circle-slash")
					.onClick(() => {
						this.store.disableFolder(folderPath);
						this.refreshAll();
					}),
			);
		});
	}

	// ---------- Enable / change-default flows (right-click menu) ----------

	private startEnableFlow(folderPath: string, evt: MouseEvent | KeyboardEvent): void {
		const sets = this.store.getStatusSets();
		if (sets.length === 0) {
			new Notice("Create a status set in Settings → Status Sets first.");
			return;
		}
		const anchor = anchorFromEvent(evt);
		const proceed = (setId: string) => {
			const set = this.store.getStatusSet(setId);
			if (!set || set.statuses.length === 0) {
				new Notice("That status set has no statuses yet — add some in settings first.");
				return;
			}
			const defaultId = set.statuses.some((s) => s.id === set.defaultStatusId)
				? set.defaultStatusId
				: set.statuses[0].id;
			const children = this.getDirectChildPaths(folderPath);
			this.store.enableFolder(folderPath, set.id, defaultId, true, children);
			this.refreshAll();
		};
		if (sets.length === 1) {
			proceed(sets[0].id);
		} else {
			openStatusSetPopup({ anchor, statusSets: sets, onSelect: (set) => proceed(set.id) });
		}
	}

	private startChangeDefaultFlow(folderPath: string, evt: MouseEvent | KeyboardEvent): void {
		const cfg = this.store.getFolderConfig(folderPath);
		const set = cfg && this.store.getStatusSet(cfg.statusSetId);
		if (!cfg || !set) return;
		openStatusPopup({
			anchor: anchorFromEvent(evt),
			statusSet: set,
			currentStatusId: cfg.defaultStatusId,
			onSelect: (status) => {
				this.store.updateFolderConfig(folderPath, { defaultStatusId: status.id });
				this.refreshAll();
			},
		});
	}

	private getDirectChildPaths(folderPath: string): string[] {
		const folder = folderPath === ROOT_PATH
			? this.app.vault.getRoot()
			: this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) return [];
		return folder.children.map((c) => c.path);
	}

	// ---------- Observation / decoration ----------

	private forEachExplorerView(fn: (view: View) => void): void {
		this.app.workspace.getLeavesOfType(FILE_EXPLORER_TYPE).forEach((leaf: WorkspaceLeaf) => {
			fn(leaf.view);
		});
	}

	/**
	 * Delegated interaction handling for `.ffsi-dot` elements (and truncation
	 * summary rows), registered once per window as a *capturing* listener on
	 * `window` itself.
	 *
	 * Driven off `mousedown`, not `click`/`dblclick`. Those depend on the
	 * browser synthesizing a higher-level event on top of the raw
	 * mousedown/mouseup pair, and at least one real-world combination of
	 * input method and Electron/Chromium build has been confirmed (via a
	 * live debugging session — see the 0.5.2 changelog entry) to deliver
	 * mousedown and mouseup perfectly while never synthesizing `click` at
	 * all, silently breaking every click-driven interaction in this file.
	 * mousedown itself was reliable in that same session, so double-click is
	 * now detected manually (two mousedowns on the same dot within
	 * DOUBLE_CLICK_MS) instead of trusting the native `dblclick` event, which
	 * has the identical dependency on `click` firing twice.
	 *
	 * Capturing on `window` also has to preempt other plugins, not just stop
	 * the event bubbling back up. Plugins like "Folder Notes" register their
	 * own handler on `document` with `capture: true` so they can intercept a
	 * click on a folder's title before Obsidian's default expand/collapse
	 * behaviour runs, and immediately call `stopImmediatePropagation()`
	 * there to open the folder note instead. A capturing listener on
	 * `document` fires during the capture phase, which happens *before* the
	 * event ever reaches our dot — so a plain bubble-phase listener on the
	 * dot itself would never even run for folders that have a folder note.
	 * The DOM's capture order is window → document → … → target, so a
	 * capturing listener on `window` always runs before one on `document`,
	 * regardless of plugin load order.
	 */
	private attachDotInterceptor(explorerRoot: HTMLElement): void {
		const win = explorerRoot.win;
		if (this.dotWindowListeners.has(win)) return;

		const mousedownListener = (evt: MouseEvent) => {
			const target = evt.target;
			if (!(target instanceof HTMLElement)) return;
			// A collapsed truncation group's summary row — mousedown on its dot
			// *or* its text (anywhere within the title) to expand. Always a
			// plain left click, independent of the status-menu trigger setting
			// handled below — this expands a group, it doesn't open the
			// change-status popup.
			if (evt.button === 0) {
				const summaryEl = target.closest<HTMLElement>(`[${GROUP_SUMMARY_ATTR}]`);
				if (summaryEl) {
					evt.preventDefault();
					evt.stopImmediatePropagation();
					const groupKey = summaryEl.getAttribute(GROUP_SUMMARY_ATTR);
					if (groupKey) {
						this.expandedGroups.add(groupKey);
						this.refreshAll();
					}
					return;
				}
			}
			const dot = target.closest<HTMLElement>(`.${DOT_CLASS}`);
			if (!dot) return;
			// Read data-path fresh at mousedown time rather than caching it —
			// Obsidian can finish setting data-path slightly after the row is
			// first mounted.
			const titleEl = dot.parentElement;
			const raw = titleEl?.getAttribute("data-path") ?? "";
			const path = raw === "/" ? ROOT_PATH : raw;
			const groupKey = dot.getAttribute(GROUP_MEMBER_ATTR);

			// This dot belongs to an expanded truncation group — a second
			// left mousedown within DOUBLE_CLICK_MS always collapses it,
			// regardless of the configured status-menu trigger below (that
			// setting only governs *opening* the popup; collapsing a group is
			// a separate, pre-existing affordance). If this isn't a repeat
			// click, fall through to the trigger handling underneath.
			if (evt.button === 0 && groupKey) {
				const now = Date.now();
				const lastDown = this.lastDotMouseDown.get(dot);
				this.lastDotMouseDown.set(dot, now);
				if (lastDown !== undefined && now - lastDown < DOUBLE_CLICK_MS) {
					evt.preventDefault();
					evt.stopImmediatePropagation();
					this.lastDotMouseDown.delete(dot);
					this.cancelPendingDotAction(dot);
					this.expandedGroups.delete(groupKey);
					this.refreshAll();
					return;
				}
			}

			this.handleDotTrigger(evt, dot, path, groupKey);
		};

		const swallowListener = (evt: MouseEvent) => {
			// Obsidian (and other plugins, e.g. Folder Notes) open a file or
			// expand/collapse a folder off a `click` event, which the browser
			// dispatches after mouseup independently of whatever
			// mousedownListener above did — preventDefault()/
			// stopImmediatePropagation() on mousedown does NOT stop a later
			// `click` from firing. Swallow it here too so clicking (or
			// double-clicking) the dot never opens/expands the row underneath
			// it, in every trigger mode — only clicking the name/text should.
			const target = evt.target;
			if (!(target instanceof HTMLElement)) return;
			if (target.closest(`.${DOT_CLASS}`) || target.closest(`[${GROUP_SUMMARY_ATTR}]`)) {
				evt.preventDefault();
				evt.stopImmediatePropagation();
			}
		};

		const contextMenuListener = (evt: MouseEvent) => {
			// Only relevant in "Right click" trigger mode — suppresses the
			// native file/folder context menu when it's the dot itself that
			// was right-clicked, since that click now opens the status popup
			// instead. Right-clicking elsewhere on the row is untouched.
			if (this.store.getStatusMenuTrigger() !== "right") return;
			const target = evt.target;
			if (!(target instanceof HTMLElement)) return;
			if (target.closest(`.${DOT_CLASS}`)) {
				evt.preventDefault();
				evt.stopImmediatePropagation();
			}
		};

		win.addEventListener("mousedown", mousedownListener, true);
		win.addEventListener("click", swallowListener, true);
		win.addEventListener("dblclick", swallowListener, true);
		win.addEventListener("contextmenu", contextMenuListener, true);
		this.dotWindowListeners.set(win, [
			{ type: "mousedown", fn: mousedownListener as (evt: Event) => void },
			{ type: "click", fn: swallowListener as (evt: Event) => void },
			{ type: "dblclick", fn: swallowListener as (evt: Event) => void },
			{ type: "contextmenu", fn: contextMenuListener as (evt: Event) => void },
		]);
	}

	/**
	 * Decides whether this mousedown on a dot should open the change-status
	 * popup, per the "Open change status menu" Behaviour setting (see
	 * DataStore#getStatusMenuTrigger). Only reached once the truncation-group
	 * double-click-to-collapse check above has ruled itself out (not
	 * applicable, or this wasn't a repeat click).
	 */
	private handleDotTrigger(evt: MouseEvent, dot: HTMLElement, path: string, groupKey: string | null): void {
		const mode = this.store.getStatusMenuTrigger();

		if (mode === "right") {
			if (evt.button !== 2) {
				// A left click on the dot in this mode opens nothing, but still
				// must never fall through to open/expand the row underneath it.
				if (evt.button === 0) {
					evt.preventDefault();
					evt.stopImmediatePropagation();
				}
				return;
			}
			evt.preventDefault();
			evt.stopImmediatePropagation();
			this.onDotClick(dot, path);
			return;
		}

		if (evt.button !== 0) return; // every other mode is left-button only

		evt.preventDefault();
		evt.stopImmediatePropagation();

		if (groupKey && (mode === "long" || mode === "double")) {
			// A grouped dot's double-click is already claimed by the collapse
			// gesture above, so it can't also serve as this mode's own
			// open-trigger without colliding with that check — fall back to
			// the same delayed-single-click-opens behaviour "Left click" mode
			// uses instead.
			this.scheduleGroupedOpen(dot, path);
			return;
		}

		if (mode === "long") {
			this.beginLongPress(dot, path);
			return;
		}
		if (mode === "double") {
			this.beginDoubleClickOpen(dot, path);
			return;
		}
		if (groupKey) {
			this.scheduleGroupedOpen(dot, path);
			return;
		}
		this.onDotClick(dot, path); // mode === "left" (default), ungrouped
	}

	/** "Left click" mode on a truncation-group member — see handleDotTrigger(). */
	private scheduleGroupedOpen(dot: HTMLElement, path: string): void {
		this.cancelPendingDotAction(dot);
		const handle = dot.win.setTimeout(() => {
			this.pendingDotActions.delete(dot);
			this.lastDotMouseDown.delete(dot);
			this.onDotClick(dot, path);
		}, DOUBLE_CLICK_MS);
		this.pendingDotActions.set(dot, handle);
	}

	/** "Double click" mode on an ungrouped dot — see handleDotTrigger(). */
	private beginDoubleClickOpen(dot: HTMLElement, path: string): void {
		const now = Date.now();
		const lastDown = this.lastDotMouseDown.get(dot);
		this.lastDotMouseDown.set(dot, now);
		this.cancelPendingDotAction(dot);
		if (lastDown !== undefined && now - lastDown < DOUBLE_CLICK_MS) {
			this.lastDotMouseDown.delete(dot);
			this.onDotClick(dot, path);
			return;
		}
		// Wait for a possible second click; if none arrives in time, do
		// nothing — a single click shouldn't open the popup in this mode.
		const handle = dot.win.setTimeout(() => {
			this.pendingDotActions.delete(dot);
			this.lastDotMouseDown.delete(dot);
		}, DOUBLE_CLICK_MS);
		this.pendingDotActions.set(dot, handle);
	}

	/** "Long click" mode — opens the popup once the dot has been held for LONG_PRESS_MS; a quick tap does nothing. */
	private beginLongPress(dot: HTMLElement, path: string): void {
		this.pendingLongPress.get(dot)?.();
		const win = dot.win;
		const handle = win.setTimeout(() => {
			cleanup();
			this.onDotClick(dot, path);
		}, LONG_PRESS_MS);
		const onRelease = () => cleanup();
		const cleanup = () => {
			win.clearTimeout(handle);
			win.removeEventListener("mouseup", onRelease, true);
			this.pendingLongPress.delete(dot);
		};
		win.addEventListener("mouseup", onRelease, true);
		this.pendingLongPress.set(dot, cleanup);
	}

	private cancelPendingDotAction(dot: HTMLElement): void {
		const pending = this.pendingDotActions.get(dot);
		if (pending !== undefined) {
			dot.win.clearTimeout(pending);
			this.pendingDotActions.delete(dot);
		}
	}

	private attachObserver(explorerRoot: HTMLElement): void {
		if (this.observers.has(explorerRoot)) return;
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				const target = record.target as HTMLElement;
				const container = target.closest<HTMLElement>(".nav-folder-children, .nav-files-container");
				if (container) this.queueContainer(container);
			}
		});
		observer.observe(explorerRoot, { childList: true, subtree: true });
		this.observers.set(explorerRoot, observer);
	}

	/**
	 * Coalesces same-turn mutations into one processContainer() pass per
	 * container, same as before — the difference is *when* that pass runs.
	 * A MutationObserver callback fires as a microtask, i.e. before the next
	 * paint; queueing our own flush as a microtask too means it runs in that
	 * same turn, right alongside whatever else is reacting to the same DOM
	 * change. The previous rAF-deferred version pushed it out to the next
	 * animation frame instead — a full frame later than Obsidian's own
	 * post-toggle work. That gap meant our dot insertions and any reorder
	 * landed as a *second*, separate wave of childList mutations arriving
	 * just after Obsidian's file-explorer had already reconciled and
	 * settled once — which was enough to trigger a second, redundant
	 * reconciliation of its own. Folding our reaction into the same turn
	 * lets Obsidian see one complete, already-decorated DOM state instead
	 * of two.
	 */
	private queueContainer(container: HTMLElement): void {
		this.dirtyContainers.add(container);
		if (this.flushScheduled) return;
		this.flushScheduled = true;
		queueMicrotask(() => {
			this.flushScheduled = false;
			if (this.observers.size === 0) return; // disable() ran before this flush — nothing left to process
			const containers = Array.from(this.dirtyContainers);
			this.dirtyContainers.clear();
			for (const c of containers) this.processContainer(c);
		});
	}

	/** Decorates every direct-child row of `container`, collapses/expands truncation groups, and reorders if the owning folder groups by status. */
	private processContainer(container: HTMLElement): void {
		const folderPath = this.containerFolderPath(container);
		if (folderPath === null) return;

		// Obsidian swaps a row's title into an editable input while the user is
		// renaming it. Touching that row's DOM mid-edit (recreating the dot,
		// moving the row via appendChild for sort order) can steal focus or move
		// the input out from under the caret, which silently cancels the rename.
		// Defer this whole pass until it's done — the "rename" vault event fires
		// its own refreshAll() once the rename completes, so nothing is missed.
		if (container.querySelector(".is-being-renamed")) return;

		// Existing summary rows, keyed by the group they represent — reused
		// in place below rather than unconditionally destroyed and rebuilt
		// every pass (a stale one left in this map after the loop means its
		// group is no longer active, and gets removed then). A remove +
		// rebuild is a childList mutation pair even when nothing about the
		// group actually changed, which is exactly the kind of no-op DOM
		// churn applySortOrder() moved away from for the same reason — see
		// its docblock.
		const existingGroupRows = new Map<string, HTMLElement>();
		container.querySelectorAll<HTMLElement>(`:scope > .${GROUP_ROW_CLASS}`).forEach((el) => {
			const key = el.getAttribute(GROUP_SUMMARY_ATTR);
			if (key) existingGroupRows.set(key, el);
			else el.remove(); // malformed/orphaned — no group key to reuse against
		});

		const cfg = this.store.resolveGoverningConfig(folderPath);

		const rows = Array.from(container.children).filter(
			(el): el is HTMLElement => el.instanceOf(HTMLElement) && (el.hasClass("nav-file") || el.hasClass("nav-folder")),
		);

		interface RowInfo {
			el: HTMLElement;
			titleEl: HTMLElement;
			path: string;
			rank: number;
			name: string;
			display: ResolvedDisplay | null;
			hidden: boolean;
		}
		const infos: RowInfo[] = [];
		for (const row of rows) {
			const titleEl = row.querySelector<HTMLElement>(":scope > .nav-file-title, :scope > .nav-folder-title");
			if (!titleEl) continue;
			const rawPath = titleEl.getAttribute("data-path") ?? "";
			const path = rawPath === "/" ? ROOT_PATH : rawPath;
			const isFolder = row.hasClass("nav-folder");
			const display = this.store.resolveDisplay(path, folderPath, isFolder);
			const hidden = !!(
				(cfg?.hideCompleted && display?.status.isCompleted) ||
				(cfg?.hideCancelled && display?.status.isCancelled)
			);
			row.toggleClass("ffsi-hidden-status", hidden);
			const rank = display
				? display.statusSet.statuses.findIndex((s) => s.id === display.status.id)
				: Number.POSITIVE_INFINITY;
			infos.push({ el: row, titleEl, path, rank: rank < 0 ? Number.POSITIVE_INFINITY : rank, name: basename(path), display, hidden });
		}

		// Tally how many (non-hidden) direct children share each truncation-enabled status.
		const countByStatus = new Map<string, number>();
		for (const info of infos) {
			const statusId = info.display?.status.id;
			if (!statusId || info.hidden) continue;
			if (!cfg?.truncatedStatuses?.[statusId]?.enabled) continue;
			countByStatus.set(statusId, (countByStatus.get(statusId) ?? 0) + 1);
		}

		const ranked: { el: HTMLElement; path: string; rank: number; name: string }[] = [];
		const groupEmitted = new Set<string>();
		for (const info of infos) {
			const statusId = info.display?.status.id;
			const groupable = !info.hidden && !!statusId && (countByStatus.get(statusId) ?? 0) >= 2;
			const groupKey = groupable ? `${folderPath} ${statusId}` : null;
			const expanded = groupKey ? this.expandedGroups.has(groupKey) : false;

			if (groupKey && !expanded) {
				this.decorateRow(info.titleEl, info.display);
				info.el.toggleClass("ffsi-trunc-hidden", true);
				if (!groupEmitted.has(groupKey)) {
					groupEmitted.add(groupKey);
					const set = cfg ? this.store.getStatusSet(cfg.statusSetId) : undefined;
					const status = set?.statuses.find((s) => s.id === statusId);
					const rule = cfg?.truncatedStatuses?.[statusId as string];
					if (status && rule) {
						const count = countByStatus.get(statusId as string) ?? 0;
						const existing = existingGroupRows.get(groupKey);
						existingGroupRows.delete(groupKey); // handled either way below — nothing left over to remove for this key
						const sig = `${status.id} ${count} ${rule.label}`;
						// Nothing about this group's rendered content changed since
						// last pass — reuse the existing row untouched rather than
						// destroy and rebuild it (see buildGroupRow()'s docblock).
						let groupEl = existing;
						if (!groupEl || groupEl.getAttribute(GROUP_ROW_SIG_ATTR) !== sig) {
							existing?.remove();
							groupEl = this.buildGroupRow(info.el, status, rule, count, groupKey);
							container.appendChild(groupEl); // position is irrelevant — applySortOrder's CSS `order` places it
						}
						ranked.push({ el: groupEl, path: groupKey, rank: info.rank, name: "" });
					}
				}
				continue;
			}

			info.el.toggleClass("ffsi-trunc-hidden", false);
			this.decorateRow(info.titleEl, info.display, groupKey ?? undefined);
			ranked.push({ el: info.el, path: info.path, rank: info.rank, name: info.name });
		}

		// Anything left in existingGroupRows belongs to a group that's no
		// longer active this pass (expanded, membership dropped below 2, its
		// status un-enabled for truncation, …) — safe to drop.
		for (const stale of existingGroupRows.values()) stale.remove();

		if (cfg && cfg.sortMode === "status") {
			this.applySortOrder(container, ranked);
		} else {
			this.clearSortOrder(container, ranked);
		}
	}

	/**
	 * Classes that mark transient/interactive state on a real row — stripped
	 * from a clone (see buildGroupRow()) so a summary row never inherits e.g.
	 * another row's selection highlight. Everything else about the clone's
	 * class list is left alone: font, size, and spacing all come from
	 * classes we don't know the name of (theme-dependent), so the only safe
	 * way to reproduce them exactly is to not touch them.
	 */
	private static readonly CLONE_STATE_CLASSES = [
		"is-selected",
		"is-active",
		"has-focus",
		"is-being-renamed",
		// The template row already has these two toggled on by the time it's
		// cloned (see the call site in processContainer()) — both set
		// `display: none`, which would otherwise make the clone invisible too.
		"ffsi-trunc-hidden",
		"ffsi-hidden-status",
	];

	/**
	 * Builds the collapsed "N Label" summary row standing in for a truncated
	 * status group; click the dot or the text — anywhere in the row — to
	 * expand it (handled centrally in attachDotInterceptor(), keyed off
	 * GROUP_SUMMARY_ATTR).
	 *
	 * Cloned from `templateEl` — a real row Obsidian rendered for one of the
	 * group's members — rather than built from scratch, and left with all of
	 * its original classes intact (see CLONE_STATE_CLASSES). A from-scratch
	 * `.nav-file-title` div doesn't inherit every ancestor- or theme-scoped
	 * rule (indentation, font, dot sizing, …) a genuine row picks up from its
	 * real place in Obsidian's DOM, and there's no reliable way to know in
	 * advance which classes those rules are keyed off — so the only robust
	 * fix is to keep the clone's classes as-is rather than guessing which of
	 * them are load-bearing.
	 */
	private buildGroupRow(templateEl: HTMLElement, status: StatusDefinition, rule: TruncationRule, count: number, groupKey: string): HTMLElement {
		const row = templateEl.cloneNode(true) as HTMLElement;
		for (const cls of ExplorerPatch.CLONE_STATE_CLASSES) row.removeClass(cls);
		row.addClass(GROUP_ROW_CLASS);
		row.removeAttribute("draggable");
		// Mirrors the title element's own GROUP_SUMMARY_ATTR (set below) so
		// processContainer() can look up and reuse this row by group key
		// without having to reach into its title child first.
		row.setAttribute(GROUP_SUMMARY_ATTR, groupKey);
		// A cheap fingerprint of everything that'd change this row's
		// rendered content — lets processContainer() tell "still current"
		// apart from "stale" without re-deriving status/rule/count itself.
		row.setAttribute(GROUP_ROW_SIG_ATTR, `${status.id} ${count} ${rule.label}`);
		// A cloned folder row would otherwise drag along its entire rendered
		// subtree (if it happened to be expanded) as an inert, orphaned copy.
		row.querySelectorAll(".nav-folder-children").forEach((el) => el.remove());

		const titleEl = row.querySelector<HTMLElement>(":scope > .nav-file-title, :scope > .nav-folder-title");
		if (titleEl) {
			for (const cls of ExplorerPatch.CLONE_STATE_CLASSES) titleEl.removeClass(cls);
			// Purely a hover-highlight hook (see styles.css) — added, not
			// substituted, so it can't affect font/size the way overwriting
			// the class list entirely did before.
			titleEl.addClass("ffsi-trunc-title");
			titleEl.removeAttribute("data-path");
			titleEl.removeAttribute("draggable");
			titleEl.empty();
			// Same DOT_CLASS a real item's dot uses (not a separate class) so
			// sizing/glow can never drift out of sync with regular dots — one
			// shared CSS rule, not two that happen to repeat the same numbers.
			const dot = titleEl.createSpan({ cls: DOT_CLASS });
			dot.setCssStyles({ backgroundColor: status.color, color: status.color });
			// Plain `.nav-file-title-content`, no extra class of our own — the
			// label should render pixel-identical to a real item's title, not
			// just similar, so there's nothing here left to layer on top.
			const labelText = rule.label.trim() || pluralizeStatusLabel(status.label);
			titleEl.createSpan({ cls: "nav-file-title-content", text: `${count} ${labelText}` });
			titleEl.setAttribute("aria-label", `Show ${count} ${labelText}`);
			titleEl.setAttribute("role", "button");
			titleEl.setAttribute(GROUP_SUMMARY_ATTR, groupKey);
		}
		return row;
	}

	/**
	 * Class toggled onto a "group by status" folder's row container so its
	 * children lay out via flexbox — needed for the `order` property below
	 * to do anything (it's a no-op on normal block-flow children). Declared
	 * in styles.css as `display: flex; flex-direction: column`, which is
	 * layout-equivalent to the block flow it replaces (same single-column
	 * stack), so this changes nothing visually by itself.
	 */
	private static readonly SORTED_CONTAINER_CLASS = "ffsi-sorted-container";

	/**
	 * Applies status-based sort order purely via CSS `order`, never by
	 * physically moving a row's DOM node — a deliberate departure from the
	 * insertBefore-based approach 0.7.1 shipped (which only moved rows
	 * already out of place). That minimal-diff version was still real
	 * enough DOM churn — an insertBefore call is a childList mutation, and
	 * Obsidian's file-explorer is internally virtualized — that it was
	 * still enough to occasionally trigger Obsidian's own internal
	 * reconciliation of the *entire* rendered tree (moving dozens of
	 * unrelated rows and desyncing the scroll position), independent of and
	 * in addition to anything this plugin did. See the 0.7.2 changelog
	 * entry for how this was diagnosed. Setting `style.order` is a style
	 * mutation, not a childList one: it never touches sibling relationships
	 * in the DOM at all, so there is nothing here for Obsidian's own
	 * renderer to react to — this container's real DOM order is left
	 * exactly as Obsidian last rendered it, permanently.
	 */
	private applySortOrder(
		container: HTMLElement,
		rows: { el: HTMLElement; path: string; rank: number; name: string }[],
	): void {
		container.addClass(ExplorerPatch.SORTED_CONTAINER_CLASS);
		const desired = [...rows].sort((a, b) => {
			if (a.rank !== b.rank) return a.rank - b.rank;
			return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
		});
		desired.forEach((row, index) => {
			// Only touch style.order when it's actually changing — an
			// unconditional write would still cost every row a style
			// recalc on every pass, for no visual difference.
			const value = String(index);
			if (row.el.style.order !== value) row.el.style.order = value;
		});
	}

	/** Undoes applySortOrder() — restores plain source-order layout for a folder that isn't (or no longer is) sorting by status. */
	private clearSortOrder(container: HTMLElement, rows: { el: HTMLElement }[]): void {
		if (!container.hasClass(ExplorerPatch.SORTED_CONTAINER_CLASS)) return; // never sorted, nothing to undo
		container.removeClass(ExplorerPatch.SORTED_CONTAINER_CLASS);
		for (const row of rows) {
			if (row.el.style.order) row.el.style.removeProperty("order");
		}
	}

	/**
	 * `groupKey`, when set, marks this row's dot as belonging to a currently
	 * *expanded* truncation group — double-clicking it re-collapses the group
	 * (see attachDotInterceptor()). Omit it for a normal, ungrouped row.
	 */
	private decorateRow(titleEl: HTMLElement, display: ResolvedDisplay | null, groupKey?: string): void {
		let dot = titleEl.querySelector<HTMLElement>(`:scope > .${DOT_CLASS}`);
		if (!display) {
			dot?.remove();
			return;
		}
		if (!dot) {
			dot = titleEl.createSpan({ cls: DOT_CLASS });
			const contentEl = titleEl.querySelector(".nav-file-title-content, .nav-folder-title-content");
			if (contentEl) titleEl.insertBefore(dot, contentEl);
			else titleEl.prepend(dot);
			// Interaction handling is delegated to a single window-level capturing
			// mousedown listener — see attachDotInterceptor() — rather than
			// attached here, so it can preempt other plugins' own document-level
			// capture listeners (e.g. Folder Notes intercepting folder-title clicks).
		}
		// `color` (not just `backgroundColor`) is set so the glow effect — which
		// paints via `currentColor` in CSS — always matches this dot's status color.
		dot.setCssStyles({ backgroundColor: display.status.color, color: display.status.color });
		dot.setAttribute("aria-label", display.status.label);
		dot.setAttribute("title", display.status.label);
		if (groupKey) dot.setAttribute(GROUP_MEMBER_ATTR, groupKey);
		else dot.removeAttribute(GROUP_MEMBER_ATTR);
	}

	private onDotClick(dot: HTMLElement, path: string): void {
		const parent = parentPath(path);
		const cfg = this.store.resolveGoverningConfig(parent);
		const set = cfg && this.store.getStatusSet(cfg.statusSetId);
		if (!cfg || !set) return;
		const isFolder = !!dot.closest(".nav-folder");
		const display = this.store.resolveDisplay(path, parent, isFolder);
		openStatusPopup({
			anchor: dot,
			statusSet: set,
			currentStatusId: display?.status.id ?? cfg.defaultStatusId,
			onSelect: (status) => {
				this.store.setItemStatus(path, status.id);
				this.refreshAll();
			},
		});
	}

	/** Maps a rendered children container back to the folder path that owns it, or null if not one we track. */
	private containerFolderPath(container: HTMLElement): string | null {
		if (container.hasClass("nav-files-container")) return ROOT_PATH;
		if (container.hasClass("nav-folder-children")) {
			const folderEl = container.parentElement;
			const titleEl = folderEl?.querySelector<HTMLElement>(":scope > .nav-folder-title");
			const raw = titleEl?.getAttribute("data-path");
			if (raw === undefined || raw === null) return null;
			return raw === "/" ? ROOT_PATH : raw;
		}
		return null;
	}
}

function anchorFromEvent(evt: MouseEvent | KeyboardEvent): HTMLElement {
	// Menu callbacks don't give us a stable DOM node to anchor a popup to,
	// so drop an invisible 0x0 element at the click point and clean it up
	// once the popup's own outside-click handler removes it from view.
	// evt.win/evt.doc (not the global window/document) so this still lands in
	// the right window if the menu was opened from a popped-out file explorer.
	// A keyboard-activated menu item has no pointer coordinates, so fall
	// back to the viewport center rather than reading MouseEvent-only fields.
	const point = evt.instanceOf(MouseEvent)
		? { x: evt.clientX, y: evt.clientY }
		: { x: evt.win.innerWidth / 2, y: evt.win.innerHeight / 2 };
	const anchor = evt.doc.body.createDiv({ cls: "ffsi-menu-anchor" });
	anchor.setCssStyles({ position: "fixed", left: `${point.x}px`, top: `${point.y}px` });
	evt.win.setTimeout(() => anchor.remove(), 10000);
	return anchor;
}

/** Default truncated-group label when the user hasn't set a custom one, e.g. "Idea" -> "Ideas". */
export function pluralizeStatusLabel(label: string): string {
	const trimmed = label.trim();
	if (trimmed === "") return "Items";
	return trimmed.toLowerCase().endsWith("s") ? trimmed : `${trimmed}s`;
}
