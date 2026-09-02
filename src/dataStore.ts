import type { Plugin } from "obsidian";
import { DEFAULT_COLOR_PALETTE, FolderConfig, PluginData, ResolvedDisplay, StatusDefinition, StatusSet, createEmptyPluginData } from "./types";
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
				colorPalette: loaded.colorPalette ?? [...DEFAULT_COLOR_PALETTE],
				glowEnabled: loaded.glowEnabled ?? false,
			};
			// Backfill fields added in later versions so data saved by an older
			// build of the plugin doesn't leave sets without a default status.
			let backfilled = false;
			for (const set of Object.values(this.data.statusSets)) {
				if (!set.defaultStatusId || !set.statuses.some((s) => s.id === set.defaultStatusId)) {
					set.defaultStatusId = set.statuses[0]?.id ?? "";
					backfilled = true;
				}
			}
			if (backfilled) this.requestSave();
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
		const set: StatusSet = { id: generateId("set"), name, statuses: [], defaultStatusId: "" };
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
		const status: StatusDefinition = { id: generateId("status"), label, color, isCompleted: false };
		const wasEmpty = set.statuses.length === 0;
		set.statuses.push(status);
		if (wasEmpty) set.defaultStatusId = status.id;
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

	/** The status a status set's own display treats as "Default Status" until reassigned via setDefaultStatus. */
	setDefaultStatus(setId: string, statusId: string): void {
		const set = this.data.statusSets[setId];
		if (!set || !set.statuses.some((s) => s.id === statusId)) return;
		set.defaultStatusId = statusId;
		this.requestSave();
	}

	setStatusCompleted(setId: string, statusId: string, isCompleted: boolean): void {
		const set = this.data.statusSets[setId];
		const status = set?.statuses.find((s) => s.id === statusId);
		if (!status) return;
		status.isCompleted = isCompleted;
		this.requestSave();
	}

	removeStatus(setId: string, statusId: string): void {
		const set = this.data.statusSets[setId];
		if (!set) return;
		set.statuses = set.statuses.filter((s) => s.id !== statusId);
		if (set.defaultStatusId === statusId) {
			set.defaultStatusId = set.statuses[0]?.id ?? "";
		}
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

	// ---------- Color palette ----------

	getColorPalette(): string[] {
		return [...this.data.colorPalette];
	}

	addPaletteColor(hex: string): void {
		if (this.data.colorPalette.includes(hex)) return;
		this.data.colorPalette.push(hex);
		this.requestSave();
	}

	removePaletteColor(hex: string): void {
		this.data.colorPalette = this.data.colorPalette.filter((c) => c !== hex);
		this.requestSave();
	}

	// ---------- Design ----------

	isGlowEnabled(): boolean {
		return !!this.data.glowEnabled;
	}

	setGlowEnabled(enabled: boolean): void {
		this.data.glowEnabled = enabled;
		this.requestSave();
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
	 * Re-points a folder at a different status set entirely (the "Folder
	 * assignments" dropdown in Settings). The folder's default status is reset
	 * to the new set's own default — a per-folder default from the old set has
	 * no meaning against a different set's statuses. Existing item statuses are
	 * left untouched; `resolveDisplay` already falls back to the new default
	 * for any item whose explicit status id doesn't exist in the new set.
	 */
	switchFolderStatusSet(folderPath: string, statusSetId: string): void {
		const cfg = this.data.folderConfigs[folderPath];
		const set = this.data.statusSets[statusSetId];
		if (!cfg || !set || set.statuses.length === 0) return;
		cfg.statusSetId = statusSetId;
		cfg.defaultStatusId = set.statuses.some((s) => s.id === set.defaultStatusId)
			? set.defaultStatusId
			: set.statuses[0].id;
		this.requestSave();
	}

	/**
	 * Copies a governing config (typically one resolved via inheritance) into an
	 * explicit entry for `path`. Used when a folder that had no config of its own
	 * moves, so whatever it was inheriting survives the move as its own record
	 * instead of depending on still resolving to the same ancestor afterwards.
	 */
	materializeInheritedConfig(path: string, source: FolderConfig): void {
		if (this.data.folderConfigs[path]) return; // already has its own config, nothing to do
		this.data.folderConfigs[path] = { ...source, path };
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

	/**
	 * If `folderPath` is a folder that has no explicit config of its own but
	 * currently resolves one through inheritance, returns that config — the
	 * caller uses this to snapshot it *before* a rename/move, then calls
	 * materializeInheritedConfig with the new path afterwards.
	 */
	getInheritedConfigForOwnlessFolder(folderPath: string): FolderConfig | null {
		if (this.data.folderConfigs[folderPath]) return null; // has its own already, nothing to preserve
		return this.resolveGoverningConfig(folderPath);
	}

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
