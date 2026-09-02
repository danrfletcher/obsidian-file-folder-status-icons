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
/** How long a single click on a group member's dot waits before opening the status popup, in case a dblclick follows. */
const GROUP_CLICK_DELAY_MS = 300;

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
	private observer: MutationObserver | null = null;
	private dirtyContainers = new Set<HTMLElement>();
	private rafHandle: number | null = null;
	// One delegated, capturing click listener per window rather than a
	// listener per dot — see attachDotInterceptor() for why this has to be
	// window-level (capture) rather than an ordinary listener on each dot.
	private dotClickListeners = new Map<Window, (evt: MouseEvent) => void>();
	private dotDblClickListeners = new Map<Window, (evt: MouseEvent) => void>();
	/** Pending (delayed) single-click handlers for truncation-group members, keyed by dot element — see attachDotInterceptor(). */
	private pendingDotClicks = new Map<HTMLElement, number>();
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
		this.observer?.disconnect();
		this.observer = null;
		if (this.rafHandle !== null) {
			window.cancelAnimationFrame(this.rafHandle);
			this.rafHandle = null;
		}
		for (const [win, listener] of this.dotClickListeners) {
			win.removeEventListener("click", listener, true);
		}
		this.dotClickListeners.clear();
		for (const [win, listener] of this.dotDblClickListeners) {
			win.removeEventListener("dblclick", listener, true);
		}
		this.dotDblClickListeners.clear();
		for (const [dot, handle] of this.pendingDotClicks) {
			dot.win.clearTimeout(handle);
		}
		this.pendingDotClicks.clear();
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

	registerFolderContextMenu(menu: Menu, file: TAbstractFile): void {
		if (!(file instanceof TFolder)) return;
		const folderPath = file.path === "/" ? ROOT_PATH : file.path;
		const own = this.store.getFolderConfig(folderPath);

		if (!own) {
			menu.addItem((item) =>
				item
					.setTitle("Enable statuses for this folder")
					.setIcon("circle-dot")
					.onClick((evt) => this.startEnableFlow(folderPath, evt)),
			);
			return;
		}

		menu.addItem((item) =>
			item
				.setTitle("Change default status for this folder")
				.setIcon("circle-dot")
				.onClick((evt) => this.startChangeDefaultFlow(folderPath, evt)),
		);
		menu.addItem((item) =>
			item
				.setTitle(own.hideCompleted ? "Show completed items" : "Hide completed items")
				.setIcon(own.hideCompleted ? "eye" : "eye-off")
				.onClick(() => {
					this.store.updateFolderConfig(folderPath, { hideCompleted: !own.hideCompleted });
					this.refreshAll();
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle("Disable statuses for this folder")
				.setIcon("circle-slash")
				.onClick(() => {
					this.store.disableFolder(folderPath);
					this.refreshAll();
				}),
		);
	}

	// ---------- Enable / change-default flows (right-click menu) ----------

	private startEnableFlow(folderPath: string, evt: MouseEvent | KeyboardEvent): void {
		const sets = this.store.getStatusSets();
		if (sets.length === 0) {
			new Notice("Create a status set in Settings → File and Folder Status Icons first.");
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
	 * Delegated click handling for `.ffsi-dot` elements, registered once per
	 * window as a *capturing* listener on `window` itself.
	 *
	 * This has to preempt other plugins, not just stop the click bubbling
	 * back up. Plugins like "Folder Notes" register their own click handler
	 * on `document` with `capture: true` so they can intercept a click on a
	 * folder's title before Obsidian's default expand/collapse behaviour
	 * runs, and immediately call `stopImmediatePropagation()` there to open
	 * the folder note instead. A capturing listener on `document` fires
	 * during the capture phase, which happens *before* the event ever
	 * reaches our dot — so a plain bubble-phase `addEventListener('click', …)`
	 * on the dot itself (the previous approach) never even ran for folders
	 * that have a folder note.
	 *
	 * The DOM's capture order is window → document → … → target, so a
	 * capturing listener on `window` always runs before one on `document`,
	 * regardless of plugin load order. Registering here — and stopping the
	 * event ourselves — reliably wins that race instead of depending on it.
	 */
	private attachDotInterceptor(explorerRoot: HTMLElement): void {
		const win = explorerRoot.win;
		if (this.dotClickListeners.has(win)) return;
		const listener = (evt: MouseEvent) => {
			const target = evt.target;
			if (!(target instanceof HTMLElement)) return;
			const dot = target.closest<HTMLElement>(`.${DOT_CLASS}`);
			if (!dot) return;
			evt.preventDefault();
			evt.stopImmediatePropagation();
			// Read data-path fresh at click time rather than caching it — Obsidian
			// can finish setting data-path slightly after the row is first mounted.
			const titleEl = dot.parentElement;
			const raw = titleEl?.getAttribute("data-path") ?? "";
			const path = raw === "/" ? ROOT_PATH : raw;
			const groupKey = dot.getAttribute(GROUP_MEMBER_ATTR);
			if (groupKey) {
				// This dot belongs to an expanded truncation group — hold off opening
				// the status popup briefly in case a dblclick follows (which collapses
				// the group instead; see the dblclick listener below).
				const existing = this.pendingDotClicks.get(dot);
				if (existing !== undefined) win.clearTimeout(existing);
				const handle = win.setTimeout(() => {
					this.pendingDotClicks.delete(dot);
					this.onDotClick(dot, path);
				}, GROUP_CLICK_DELAY_MS);
				this.pendingDotClicks.set(dot, handle);
				return;
			}
			this.onDotClick(dot, path);
		};
		win.addEventListener("click", listener, true);
		this.dotClickListeners.set(win, listener);

		const dblListener = (evt: MouseEvent) => {
			const target = evt.target;
			if (!(target instanceof HTMLElement)) return;
			const dot = target.closest<HTMLElement>(`.${DOT_CLASS}`);
			if (!dot) return;
			const groupKey = dot.getAttribute(GROUP_MEMBER_ATTR);
			if (!groupKey) return;
			evt.preventDefault();
			evt.stopImmediatePropagation();
			const pending = this.pendingDotClicks.get(dot);
			if (pending !== undefined) {
				win.clearTimeout(pending);
				this.pendingDotClicks.delete(dot);
			}
			this.expandedGroups.delete(groupKey);
			this.refreshAll();
		};
		win.addEventListener("dblclick", dblListener, true);
		this.dotDblClickListeners.set(win, dblListener);
	}

	private attachObserver(explorerRoot: HTMLElement): void {
		this.observer?.disconnect();
		this.observer = new MutationObserver((records) => {
			for (const record of records) {
				const target = record.target as HTMLElement;
				const container = target.closest<HTMLElement>(".nav-folder-children, .nav-files-container");
				if (container) this.queueContainer(container);
			}
		});
		this.observer.observe(explorerRoot, { childList: true, subtree: true });
	}

	private queueContainer(container: HTMLElement): void {
		this.dirtyContainers.add(container);
		if (this.rafHandle !== null) return;
		this.rafHandle = window.requestAnimationFrame(() => {
			this.rafHandle = null;
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

		// Synthetic summary rows are rebuilt fresh every pass rather than diffed/reused.
		container.querySelectorAll(`:scope > .${GROUP_ROW_CLASS}`).forEach((el) => el.remove());

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
			const hidden = !!(cfg?.hideCompleted && display?.status.isCompleted);
			row.toggleClass("ffsi-hidden-completed", hidden);
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
						const groupEl = this.buildGroupRow(container, status, rule, countByStatus.get(statusId as string) ?? 0, groupKey);
						container.insertBefore(groupEl, info.el);
						ranked.push({ el: groupEl, path: groupKey, rank: info.rank, name: "" });
					}
				}
				continue;
			}

			info.el.toggleClass("ffsi-trunc-hidden", false);
			this.decorateRow(info.titleEl, info.display, groupKey ?? undefined);
			ranked.push({ el: info.el, path: info.path, rank: info.rank, name: info.name });
		}

		if (cfg && cfg.sortMode === "status") {
			this.applySortOrder(container, ranked);
		}
	}

	/** Builds the collapsed "N Label" summary row standing in for a truncated status group; click anywhere on it to expand. */
	private buildGroupRow(container: HTMLElement, status: StatusDefinition, rule: TruncationRule, count: number, groupKey: string): HTMLElement {
		// createDiv() appends to `container` immediately; the caller repositions
		// it with insertBefore right after this returns.
		const row = container.createDiv({ cls: GROUP_ROW_CLASS });
		const titleEl = row.createDiv({ cls: "nav-file-title ffsi-trunc-title" });
		const dot = titleEl.createSpan({ cls: "ffsi-trunc-dot" });
		dot.setCssStyles({ backgroundColor: status.color, color: status.color });
		const labelText = rule.label.trim() || pluralizeStatusLabel(status.label);
		titleEl.createSpan({ cls: "ffsi-trunc-text", text: `${count} ${labelText}` });
		row.setAttribute("aria-label", `Show ${count} ${labelText}`);
		row.setAttribute("role", "button");
		row.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			this.expandedGroups.add(groupKey);
			this.refreshAll();
		});
		return row;
	}

	private applySortOrder(
		container: HTMLElement,
		rows: { el: HTMLElement; path: string; rank: number; name: string }[],
	): void {
		const desired = [...rows].sort((a, b) => {
			if (a.rank !== b.rank) return a.rank - b.rank;
			return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
		});
		const currentOrder = rows.map((r) => r.path).join(" ");
		const desiredOrder = desired.map((r) => r.path).join(" ");
		if (currentOrder === desiredOrder) return; // already sorted — avoids MutationObserver feedback loops
		for (const row of desired) {
			container.appendChild(row.el);
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
			// Click handling is delegated to a single window-level capturing
			// listener — see attachDotInterceptor() — rather than attached here,
			// so it can preempt other plugins' own document-level capture
			// listeners (e.g. Folder Notes intercepting folder-title clicks).
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
