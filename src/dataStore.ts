import type { Plugin } from "obsidian";
import { DEFAULT_COLOR_PALETTE, FolderConfig, PluginData, ResolvedDisplay, StatusDefinition, StatusSet, TruncationRule, createEmptyPluginData } from "./types";
import { ROOT_PATH, parentPath, rewritePathOnRename } from "./pathUtils";
import { generateId } from "./colorUtils";

/**
 * How long a "delete" is held back waiting for the rest of its batch (see
 * DataStore#handleDelete) before it's treated as a real deletion.
 */
const DELETE_BATCH_WINDOW_MS = 500;
/**
 * How long a "create" stays eligible to be matched against a later delete
 * batch as the other half of a rename (see DataStore#flushPendingDeletes).
 * Wider than the delete window since creates for a rename's new subtree are
 * observed to land *before* the matching deletes for the old one.
 */
const RECENT_CREATE_WINDOW_MS = 2000;

/**
 * Owns all persisted plugin state (data.json) and the query logic that maps
 * a file/folder path to the status it should display. Nothing here ever
 * touches note content or frontmatter.
 */
export class DataStore {
	private data: PluginData = createEmptyPluginData();
	private saveQueued = false;
	private changeListeners = new Set<() => void>();

	/** Paths deleted since the last flush, with the time each delete was seen. */
	private pendingDeletes: Map<string, number> = new Map();
	/** Subset of pendingDeletes' keys that are folders — see handleDelete. */
	private pendingDeletedFolders: Set<string> = new Set();
	private deleteFlushHandle: ReturnType<typeof setTimeout> | null = null;
	/** Paths created recently — see recordCreate. */
	private recentCreates: Map<string, { time: number; isFolder: boolean }> = new Map();

	constructor(private plugin: Plugin) {}

	/**
	 * Notified after every mutation (see requestSave). Exists mainly so the
	 * public API (see publicApi.ts) can let other plugins react live — e.g.
	 * re-render an already-open note when Glow is toggled — without polling.
	 * Returns an unsubscribe function.
	 */
	onChange(callback: () => void): () => void {
		this.changeListeners.add(callback);
		return () => this.changeListeners.delete(callback);
	}

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
		for (const cb of this.changeListeners) cb();
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
		const status: StatusDefinition = { id: generateId("status"), label, color, isCompleted: false, isCancelled: false };
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

	/** Marking a status completed unmarks it cancelled — a status is conceptually one or the other, not both. */
	setStatusCompleted(setId: string, statusId: string, isCompleted: boolean): void {
		const set = this.data.statusSets[setId];
		const status = set?.statuses.find((s) => s.id === statusId);
		if (!status) return;
		status.isCompleted = isCompleted;
		if (isCompleted) status.isCancelled = false;
		this.requestSave();
	}

	/** Marking a status cancelled unmarks it completed — see setStatusCompleted. */
	setStatusCancelled(setId: string, statusId: string, isCancelled: boolean): void {
		const set = this.data.statusSets[setId];
		const status = set?.statuses.find((s) => s.id === statusId);
		if (!status) return;
		status.isCancelled = isCancelled;
		if (isCancelled) status.isCompleted = false;
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
			// A truncation rule for a status that no longer exists would just dangle.
			if (cfg.statusSetId === setId && cfg.truncatedStatuses?.[statusId]) {
				delete cfg.truncatedStatuses[statusId];
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
			applyToFiles: true,
			applyToFolders: true,
			truncatedStatuses: {},
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
		// Truncation rules are keyed by status id from the *old* set — meaningless against a different one.
		cfg.truncatedStatuses = {};
		this.requestSave();
	}

	/** Enables/disables truncation (and/or updates the custom label) for one status under a folder assignment. */
	setTruncationRule(folderPath: string, statusId: string, patch: Partial<TruncationRule>): void {
		const cfg = this.data.folderConfigs[folderPath];
		if (!cfg) return;
		if (!cfg.truncatedStatuses) cfg.truncatedStatuses = {};
		const existing = cfg.truncatedStatuses[statusId] ?? { enabled: false, label: "" };
		cfg.truncatedStatuses[statusId] = { ...existing, ...patch };
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
	 * enabled folder, or if the folder assignment has turned statuses off for
	 * this item's type (see FolderConfig#applyToFiles / #applyToFolders).
	 */
	resolveDisplay(path: string, parentFolderPath: string, isFolder: boolean): ResolvedDisplay | null {
		const cfg = this.resolveGoverningConfig(parentFolderPath);
		if (!cfg) return null;
		if (isFolder ? cfg.applyToFolders === false : cfg.applyToFiles === false) return null;
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

	/**
	 * Records a "create" so a delete batch arriving shortly after (see
	 * handleDelete) can recognize it as the other half of a rename rather than
	 * an unrelated new file. Cheap to call unconditionally — most creates are
	 * never looked at again and just age out of the window.
	 */
	recordCreate(path: string, isFolder: boolean): void {
		this.recentCreates.set(path, { time: Date.now(), isFolder });
		this.pruneRecentCreates();
	}

	private pruneRecentCreates(): void {
		const cutoff = Date.now() - RECENT_CREATE_WINDOW_MS;
		for (const [path, entry] of this.recentCreates) {
			if (entry.time < cutoff) this.recentCreates.delete(path);
		}
	}

	/**
	 * A folder rename/move that didn't originate from Obsidian's own file
	 * explorer — an external tool, a sync client, the OS file manager, and
	 * occasionally an in-app move too — doesn't always reach the vault's
	 * "rename" event. What arrives instead is the old subtree deleted (one
	 * event per file/folder in it) and the new subtree created, with nothing
	 * tying the two together. Applied at face value, that reads as the folder
	 * being deleted — permanently discarding its status-set assignment, its
	 * children's statuses, everything — the moment the rename lands.
	 *
	 * So deletes are batched for a short window instead of applied immediately.
	 * Once the batch settles, a deleted *folder* this plugin actually has data
	 * for is checked against recent creates for one whose subtree exactly
	 * matches (same relative layout, just a different path prefix, and itself
	 * a folder too) and reattached via the same handleRename path a clean
	 * rename event would have taken; everything left over is a real deletion.
	 *
	 * Reconciliation is deliberately scoped to folders with tracked data
	 * rather than every deleted path: a lone deleted file only ever produces
	 * a single-element suffix set (just itself), which would trivially
	 * "match" against *any* unrelated file created in the same window — there's
	 * no layout left to actually confirm the two are related.
	 */
	handleDelete(path: string, isFolder: boolean): void {
		this.pendingDeletes.set(path, Date.now());
		if (isFolder) this.pendingDeletedFolders.add(path);
		if (this.deleteFlushHandle !== null) return;
		this.deleteFlushHandle = setTimeout(() => this.flushPendingDeletes(), DELETE_BATCH_WINDOW_MS);
	}

	private flushPendingDeletes(): void {
		this.deleteFlushHandle = null;
		const deletedPaths = Array.from(this.pendingDeletes.keys());
		const deletedFolders = this.pendingDeletedFolders;
		this.pendingDeletes.clear();
		this.pendingDeletedFolders = new Set();
		this.pruneRecentCreates();

		const deletedSet = new Set(deletedPaths);
		const reattached = new Set<string>();

		// Only a path whose parent *wasn't itself deleted in this batch* can be
		// the root of a rename — everything below it is just along for the ride
		// and gets swept up via the same rewritePathOnRename pass handleRename
		// already does for a clean rename event.
		for (const oldTop of deletedPaths) {
			if (!deletedFolders.has(oldTop)) continue;
			if (deletedSet.has(parentPath(oldTop))) continue;
			if (!this.hasTrackedData(oldTop)) continue;

			const suffixes = deletedPaths
				.filter((p) => p === oldTop || p.startsWith(oldTop + "/"))
				.map((p) => p.slice(oldTop.length));
			const newTop = this.findRenameTarget(suffixes);
			if (!newTop) continue;

			this.handleRename(oldTop, newTop);
			for (const suffix of suffixes) {
				reattached.add(oldTop + suffix);
				this.recentCreates.delete(newTop + suffix);
			}
		}

		for (const path of deletedPaths) {
			if (!reattached.has(path)) this.applyDelete(path);
		}
	}

	/** Flushes any batched deletes immediately and drops the timer — call on unload so a stray callback doesn't fire against a plugin that's gone. */
	dispose(): void {
		if (this.deleteFlushHandle === null) return;
		clearTimeout(this.deleteFlushHandle);
		this.flushPendingDeletes();
	}

	/** Whether `folderPath` itself, or anything nested under it, has a stored config or status. */
	private hasTrackedData(folderPath: string): boolean {
		if (this.data.folderConfigs[folderPath]) return true;
		const prefix = folderPath + "/";
		for (const path of Object.keys(this.data.folderConfigs)) {
			if (path.startsWith(prefix)) return true;
		}
		for (const path of Object.keys(this.data.itemStatuses)) {
			if (path === folderPath || path.startsWith(prefix)) return true;
		}
		return false;
	}

	/**
	 * Finds a recently-created *folder* whose subtree layout exactly matches
	 * `suffixes` (the relative paths — "" for the root itself, "/child", … —
	 * collected from a deleted subtree), i.e. every one of those suffixes was
	 * also just created under some other common path. That path is the likely
	 * rename target; null if nothing recent matches the whole set.
	 */
	private findRenameTarget(suffixes: string[]): string | null {
		for (const [candidateTop, entry] of this.recentCreates) {
			if (!entry.isFolder) continue;
			if (suffixes.every((suffix) => this.recentCreates.has(candidateTop + suffix))) {
				return candidateTop;
			}
		}
		return null;
	}

	private applyDelete(path: string): void {
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
