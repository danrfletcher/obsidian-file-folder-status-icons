import type { Plugin } from "obsidian";
import { FolderConfig, PluginData, ResolvedDisplay, StatusDefinition, StatusSet, createEmptyPluginData } from "./types";
import { ROOT_PATH, parentPath, rewritePathOnRename } from "./pathUtils";
import { generateId } from "./colorUtils";

/**
 * Owns all persisted plugin state (data.json) and the query logic that maps
 * a file/folder path to the status it should display. Nothing here ever
 * touches note content or frontmatter.
 */
export class DataStore {
	private data: PluginData = createEmptyPluginData();
	private saveQueued = false;

	constructor(private plugin: Plugin) {}

	async load(): Promise<void> {
		const loaded = (await this.plugin.loadData()) as Partial<PluginData> | null;
		if (loaded && loaded.dataVersion === 1) {
			this.data = {
				dataVersion: 1,
				statusSets: loaded.statusSets ?? {},
				folderConfigs: loaded.folderConfigs ?? {},
				itemStatuses: loaded.itemStatuses ?? {},
			};
		} else {
			this.data = createEmptyPluginData();
		}
	}

	/** Debounced to a microtask so a burst of changes (e.g. rename of many descendants) writes once. */
	requestSave(): void {
		if (this.saveQueued) return;
		this.saveQueued = true;
		void this.flushSave();
	}

	private async flushSave(): Promise<void> {
		await Promise.resolve(); // yield one microtask so synchronous callers coalesce into a single write
		this.saveQueued = false;
		await this.plugin.saveData(this.data);
	}

	// ---------- Status sets ----------

	getStatusSets(): StatusSet[] {
		return Object.values(this.data.statusSets);
	}

	getStatusSet(id: string): StatusSet | undefined {
		return this.data.statusSets[id];
	}

	createStatusSet(name: string): StatusSet {
		const set: StatusSet = { id: generateId("set"), name, statuses: [] };
		this.data.statusSets[set.id] = set;
		this.requestSave();
		return set;
	}

	renameStatusSet(id: string, name: string): void {
		const set = this.data.statusSets[id];
		if (!set) return;
		set.name = name;
		this.requestSave();
	}

	deleteStatusSet(id: string): void {
		delete this.data.statusSets[id];
		// Any folder configs pointing at this set are now dangling; drop them
		// so the file explorer stops trying to render a status that no longer exists.
		for (const path of Object.keys(this.data.folderConfigs)) {
			if (this.data.folderConfigs[path].statusSetId === id) {
				delete this.data.folderConfigs[path];
			}
		}
		this.requestSave();
	}

	addStatus(setId: string, label: string, color: string): StatusDefinition | undefined {
		const set = this.data.statusSets[setId];
		if (!set) return undefined;
		const status: StatusDefinition = { id: generateId("status"), label, color };
		set.statuses.push(status);
		this.requestSave();
		return status;
	}

	updateStatus(setId: string, statusId: string, patch: Partial<Pick<StatusDefinition, "label" | "color">>): void {
		const set = this.data.statusSets[setId];
		const status = set?.statuses.find((s) => s.id === statusId);
		if (!status) return;
		Object.assign(status, patch);
		this.requestSave();
	}

	removeStatus(setId: string, statusId: string): void {
		const set = this.data.statusSets[setId];
		if (!set) return;
		set.statuses = set.statuses.filter((s) => s.id !== statusId);
		// Folder configs defaulting to the removed status fall back to whatever is now first.
		for (const cfg of Object.values(this.data.folderConfigs)) {
			if (cfg.statusSetId === setId && cfg.defaultStatusId === statusId) {
				cfg.defaultStatusId = set.statuses[0]?.id ?? "";
			}
		}
		this.requestSave();
	}

	reorderStatuses(setId: string, orderedIds: string[]): void {
		const set = this.data.statusSets[setId];
		if (!set) return;
		const byId = new Map(set.statuses.map((s) => [s.id, s]));
		const reordered = orderedIds.map((id) => byId.get(id)).filter((s): s is StatusDefinition => !!s);
		if (reordered.length === set.statuses.length) {
			set.statuses = reordered;
			this.requestSave();
		}
	}

	// ---------- Folder configs ----------

	getFolderConfig(path: string): FolderConfig | undefined {
		return this.data.folderConfigs[path];
	}

	getAllFolderConfigs(): FolderConfig[] {
		return Object.values(this.data.folderConfigs);
	}

	/**
	 * Enable statuses for `folderPath` using `statusSetId`, with `defaultStatusId`
	 * assigned to any direct child that doesn't already have a status of its own.
	 */
	enableFolder(
		folderPath: string,
		statusSetId: string,
		defaultStatusId: string,
		inheritToChildren: boolean,
		childPaths: string[],
	): void {
		this.data.folderConfigs[folderPath] = {
			path: folderPath,
			statusSetId,
			defaultStatusId,
			sortMode: "status",
			inheritToChildren,
		};
		for (const child of childPaths) {
			if (!this.data.itemStatuses[child]) {
				this.data.itemStatuses[child] = defaultStatusId;
			}
		}
		this.requestSave();
	}

	/** Turns statuses off for a folder. Item status assignments are preserved so re-enabling restores them. */
	disableFolder(folderPath: string): void {
		delete this.data.folderConfigs[folderPath];
		this.requestSave();
	}

	updateFolderConfig(folderPath: string, patch: Partial<Omit<FolderConfig, "path">>): void {
		const cfg = this.data.folderConfigs[folderPath];
		if (!cfg) return;
		Object.assign(cfg, patch);
		this.requestSave();
	}

	/**
	 * Nearest enabled ancestor (or self) whose config governs `folderPath`'s
	 * direct children. Returns null if nothing in the chain applies.
	 */
	resolveGoverningConfig(folderPath: string): FolderConfig | null {
		const own = this.data.folderConfigs[folderPath];
		if (own) return own;
		if (folderPath === ROOT_PATH) return null;
		let current = folderPath;
		while (current !== ROOT_PATH) {
			const parent = parentPath(current);
			const cfg = this.data.folderConfigs[parent];
			if (cfg) {
				return cfg.inheritToChildren ? cfg : null;
			}
			current = parent;
		}
		return null;
	}

	// ---------- Item statuses ----------

	getItemStatusId(path: string): string | undefined {
		return this.data.itemStatuses[path];
	}

	setItemStatus(path: string, statusId: string): void {
		this.data.itemStatuses[path] = statusId;
		this.requestSave();
	}

	clearItemStatus(path: string): void {
		delete this.data.itemStatuses[path];
		this.requestSave();
	}

	/**
	 * Resolves what a path should actually display: the governing config for
	 * its parent folder, plus the effective status (explicit assignment, or
	 * the folder's default). Returns null if the item isn't governed by any
	 * enabled folder.
	 */
	resolveDisplay(path: string, parentFolderPath: string): ResolvedDisplay | null {
		const cfg = this.resolveGoverningConfig(parentFolderPath);
		if (!cfg) return null;
		const set = this.data.statusSets[cfg.statusSetId];
		if (!set) return null;
		const explicitId = this.data.itemStatuses[path];
		const statusId = (explicitId && set.statuses.some((s) => s.id === explicitId))
			? explicitId
			: cfg.defaultStatusId;
		const status = set.statuses.find((s) => s.id === statusId);
		if (!status) return null;
		return { statusSet: set, status };
	}

	// ---------- Rename / delete housekeeping ----------

	handleRename(oldPath: string, newPath: string): void {
		let changed = false;

		const nextFolderConfigs: Record<string, FolderConfig> = {};
		for (const [path, cfg] of Object.entries(this.data.folderConfigs)) {
			const rewritten = rewritePathOnRename(path, oldPath, newPath);
			if (rewritten !== null) {
				nextFolderConfigs[rewritten] = { ...cfg, path: rewritten };
				changed = true;
			} else {
				nextFolderConfigs[path] = cfg;
			}
		}
		this.data.folderConfigs = nextFolderConfigs;

		const nextItemStatuses: Record<string, string> = {};
		for (const [path, statusId] of Object.entries(this.data.itemStatuses)) {
			const rewritten = rewritePathOnRename(path, oldPath, newPath);
			if (rewritten !== null) {
				nextItemStatuses[rewritten] = statusId;
				changed = true;
			} else {
				nextItemStatuses[path] = statusId;
			}
		}
		this.data.itemStatuses = nextItemStatuses;

		if (changed) this.requestSave();
	}

	handleDelete(path: string): void {
		let changed = false;
		if (this.data.folderConfigs[path]) {
			delete this.data.folderConfigs[path];
			changed = true;
		}
		if (this.data.itemStatuses[path]) {
			delete this.data.itemStatuses[path];
			changed = true;
		}
		if (changed) this.requestSave();
	}
}
