import { Plugin, TAbstractFile } from "obsidian";
import { DataStore } from "./dataStore";
import { ExplorerPatch } from "./explorerPatch";
import { FFSISettingTab } from "./settingsTab";

export default class FileFolderStatusIconsPlugin extends Plugin {
	store!: DataStore;
	explorerPatch!: ExplorerPatch;

	async onload(): Promise<void> {
		this.store = new DataStore(this);
		await this.store.load();

		this.explorerPatch = new ExplorerPatch(this.app, this.store);
		this.addSettingTab(new FFSISettingTab(this.app, this, this.store));

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				this.explorerPatch.registerFolderContextMenu(menu, file);
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				this.store.handleRename(oldPath, file.path);
				this.explorerPatch.refreshAll();
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				this.store.handleDelete(file.path);
			}),
		);
		this.registerEvent(this.app.vault.on("create", () => this.explorerPatch.refreshAll()));

		// The file explorer leaf may not exist yet on first install; wait for the
		// workspace to finish its initial layout before attaching the observer.
		this.app.workspace.onLayoutReady(() => this.explorerPatch.enable());
	}

	onunload(): void {
		this.explorerPatch?.disable();
	}
}
