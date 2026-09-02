import { App, Menu, Notice, TAbstractFile, TFolder, View, WorkspaceLeaf } from "obsidian";
import { DataStore } from "./dataStore";
import { ROOT_PATH, basename, parentPath } from "./pathUtils";
import { openStatusPopup, openStatusSetPopup } from "./statusPopup";
import { ResolvedDisplay } from "./types";

const FILE_EXPLORER_TYPE = "file-explorer";
const DOT_CLASS = "ffsi-dot";

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
		document.querySelectorAll(`.${DOT_CLASS}`).forEach((el) => el.remove());
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
			this.onDotClick(dot, raw === "/" ? ROOT_PATH : raw);
		};
		win.addEventListener("click", listener, true);
		this.dotClickListeners.set(win, listener);
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

	/** Decorates every direct-child row of `container` and reorders them if the owning folder groups by status. */
	private processContainer(container: HTMLElement): void {
		const folderPath = this.containerFolderPath(container);
		if (folderPath === null) return;

		const cfg = this.store.resolveGoverningConfig(folderPath);

		const rows = Array.from(container.children).filter(
			(el): el is HTMLElement => el.instanceOf(HTMLElement) && (el.hasClass("nav-file") || el.hasClass("nav-folder")),
		);

		const ranked: { el: HTMLElement; path: string; rank: number; name: string }[] = [];
		for (const row of rows) {
			const titleEl = row.hasClass("nav-file") || row.hasClass("nav-folder")
				? row.querySelector<HTMLElement>(":scope > .nav-file-title, :scope > .nav-folder-title")
				: null;
			if (!titleEl) continue;
			const rawPath = titleEl.getAttribute("data-path") ?? "";
			const path = rawPath === "/" ? ROOT_PATH : rawPath;
			const display = this.store.resolveDisplay(path, folderPath);
			this.decorateRow(titleEl, display);
			const hide = !!(cfg?.hideCompleted && display?.status.isCompleted);
			row.toggleClass("ffsi-hidden-completed", hide);
			const rank = display
				? display.statusSet.statuses.findIndex((s) => s.id === display.status.id)
				: Number.POSITIVE_INFINITY;
			ranked.push({ el: row, path, rank: rank < 0 ? Number.POSITIVE_INFINITY : rank, name: basename(path) });
		}

		if (cfg && cfg.sortMode === "status") {
			this.applySortOrder(container, ranked);
		}
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

	private decorateRow(titleEl: HTMLElement, display: ResolvedDisplay | null): void {
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
	}

	private onDotClick(dot: HTMLElement, path: string): void {
		const parent = parentPath(path);
		const cfg = this.store.resolveGoverningConfig(parent);
		const set = cfg && this.store.getStatusSet(cfg.statusSetId);
		if (!cfg || !set) return;
		const display = this.store.resolveDisplay(path, parent);
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
