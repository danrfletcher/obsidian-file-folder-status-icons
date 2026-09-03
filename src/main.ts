import { Plugin, TAbstractFile, TFolder } from "obsidian";
import { DataStore } from "./dataStore";
import { ExplorerPatch } from "./explorerPatch";
import { FFSISettingTab } from "./settingsTab";
import { parentPath } from "./pathUtils";
import { createPublicApi, PublicApi } from "./publicApi";

export default class FileFolderStatusIconsPlugin extends Plugin {
	store!: DataStore;
	explorerPatch!: ExplorerPatch;
	/** See publicApi.ts — reached via app.plugins.plugins["file-folder-status-icons"]?.api. */
	api!: PublicApi;

	async onload(): Promise<void> {
		this.store = new DataStore(this);
		await this.store.load();

		this.explorerPatch = new ExplorerPatch(this.app, this.store);
		this.addSettingTab(new FFSISettingTab(this.app, this, this.store));
		this.api = createPublicApi(this.store);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				this.explorerPatch.registerFolderContextMenu(menu, file);
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				// A folder that was only ever inheriting its status set (no config
				// of its own) needs that inherited config snapshotted *before* the
				// rename rewrites paths, and re-attached to its new path afterwards
				// — otherwise moving it out from under its enabled ancestor would
				// silently drop its statuses instead of carrying them along.
				// Only for an actual move to a *different* parent, though — a plain
				// same-parent rename (e.g. "Ideas" -> "Ideas2") was previously
				// materializing a duplicate, frozen copy of the ancestor's config on
				// every rename of an ownerless folder, permanently disconnecting it
				// from future changes to the folder it was inheriting from (a new
				// status set, a new default status, etc) — and, more visibly, from
				// resolveGoverningConfig, since a folder with its own explicit config
				// no longer falls through to its parent's the way an ownerless one does.
				const movedToNewParent = parentPath(oldPath) !== parentPath(file.path);
				const inherited = file instanceof TFolder && movedToNewParent
					? this.store.getInheritedConfigForOwnlessFolder(oldPath)
					: null;
				this.store.handleRename(oldPath, file.path);
				if (inherited) this.store.materializeInheritedConfig(file.path, inherited);
				this.explorerPatch.refreshAll();
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				this.store.handleDelete(file.path, file instanceof TFolder);
			}),
		);
		this.registerEvent(
			this.app.vault.on("create", (file: TAbstractFile) => {
				// Some renames/moves — always for anything triggered outside Obsidian's
				// own file explorer (an external tool, a sync client, the OS file
				// manager), and occasionally even from in-app moves — don't reach us as
				// a single "rename" event at all. Instead the vault watcher reports the
				// old subtree as a burst of "delete"s and the new one as a burst of
				// "create"s with no link between them. recordCreate lets handleDelete's
				// batching recognize that pattern and reattach the config instead of
				// discarding it — see DataStore#flushPendingDeletes.
				this.store.recordCreate(file.path, file instanceof TFolder);
				this.explorerPatch.refreshAll();
			}),
		);

		// The file explorer leaf may not exist yet on first install; wait for the
		// workspace to finish its initial layout before attaching the observer.
		this.app.workspace.onLayoutReady(() => this.explorerPatch.enable());
	}

	onunload(): void {
		this.explorerPatch?.disable();
		this.store?.dispose();
	}
}
