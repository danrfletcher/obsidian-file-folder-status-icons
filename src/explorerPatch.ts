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

	constructor(private app: App, private store: DataStore) {}

	enable(): void {
		this.forEachExplorerView((view) => this.attachObserver(view.containerEl));
		this.refreshAll();
	}

	disable(): void {
		this.observer?.disconnect();
		this.observer = null;
		if (this.rafHandle !== null) {
			cancelAnimationFrame(this.rafHandle);
			this.rafHandle = null;
		}
		document.querySelectorAll(`.${DOT_CLASS}`).forEach((el) => el.remove());
		// Belt-and-suspenders: a popup or menu-anchor left open at unload time
		// would otherwise leak its own document-level listeners (see statusPopup.ts).
		document.querySelectorAll(".ffsi-popup, .ffsi-menu-anchor").forEach((el) => el.remove());
	}

	/** Call after any data change (status edited, folder enabled/disabled, etc). */
	refreshAll(): void {
		this.forEachExplorerView((view) => {
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
			new Notice("Create a status set in Settings → File & Folder Status Icons first.");
			return;
		}
		const anchor = anchorFromEvent(evt);
		const proceed = (setId: string) => {
			const set = this.store.getStatusSet(setId);
			if (!set || set.statuses.length === 0) {
				new Notice("That status set has no statuses yet — add some in settings first.");
				return;
			}
			openStatusPopup({
				anchor,
				statusSet: set,
				currentStatusId: set.statuses[0].id,
				onSelect: (status) => {
					const children = this.getDirectChildPaths(folderPath);
					this.store.enableFolder(folderPath, set.id, status.id, true, children);
					this.refreshAll();
				},
			});
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
		this.rafHandle = requestAnimationFrame(() => {
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

		const rows = Array.from(container.children).filter(
			(el): el is HTMLElement => el instanceof HTMLElement && (el.hasClass("nav-file") || el.hasClass("nav-folder")),
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
			const rank = display
				? display.statusSet.statuses.findIndex((s) => s.id === display.status.id)
				: Number.POSITIVE_INFINITY;
			ranked.push({ el: row, path, rank: rank < 0 ? Number.POSITIVE_INFINITY : rank, name: basename(path) });
		}

		const cfg = this.store.resolveGoverningConfig(folderPath);
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
			// Read data-path fresh at click time rather than closing over the
			// `path` this row happened to resolve to on first decoration — Obsidian
			// can finish setting data-path slightly after the row is first mounted,
			// and this listener is only ever attached once per dot element.
			dot.addEventListener("click", (evt) => {
				evt.stopPropagation();
				evt.preventDefault();
				const raw = titleEl.getAttribute("data-path") ?? "";
				this.onDotClick(dot!, raw === "/" ? ROOT_PATH : raw);
			});
		}
		dot.style.backgroundColor = display.status.color;
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
	// A keyboard-activated menu item has no pointer coordinates, so fall
	// back to the viewport center rather than reading MouseEvent-only fields.
	const point = evt instanceof MouseEvent ? { x: evt.clientX, y: evt.clientY } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
	const anchor = document.body.createDiv({ cls: "ffsi-menu-anchor" });
	anchor.style.position = "fixed";
	anchor.style.left = `${point.x}px`;
	anchor.style.top = `${point.y}px`;
	setTimeout(() => anchor.remove(), 10000);
	return anchor;
}
