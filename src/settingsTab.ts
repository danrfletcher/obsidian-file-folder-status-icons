import { App, Notice, PluginSettingTab, Setting, TFolder, normalizePath } from "obsidian";
import type FileFolderStatusIconsPlugin from "./main";
import { DataStore } from "./dataStore";
import { ROOT_PATH } from "./pathUtils";
import { normalizeHexColor } from "./colorUtils";

export class FFSISettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: FileFolderStatusIconsPlugin, private store: DataStore) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("p", {
			text: "Define statuses and colors below, then right-click any folder in the file tree and choose "
				+ "“Enable statuses for this folder” — or assign a folder directly here.",
			cls: "setting-item-description",
		});

		this.renderStatusSets(containerEl);
		this.renderFolderAssignments(containerEl);
	}

	// ---------- Status sets ----------

	private renderStatusSets(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Status sets").setHeading();

		for (const set of this.store.getStatusSets()) {
			const wrapper = containerEl.createDiv({ cls: "ffsi-set-card" });

			new Setting(wrapper)
				.setName(set.name)
				.addExtraButton((btn) =>
					btn.setIcon("trash").setTooltip("Delete status set").onClick(() => {
						this.store.deleteStatusSet(set.id);
						this.plugin.explorerPatch.refreshAll();
						this.display();
					}),
				)
				.addText((text) =>
					text.setValue(set.name).onChange((value) => {
						this.store.renameStatusSet(set.id, value || set.name);
					}),
				);

			const list = wrapper.createDiv({ cls: "ffsi-status-list" });
			set.statuses.forEach((status, idx) => {
				const row = new Setting(list).setClass("ffsi-status-row");
				row.addColorPicker((cp) =>
					cp.setValue(normalizeHexColor(status.color)).onChange((value) => {
						this.store.updateStatus(set.id, status.id, { color: value });
						this.plugin.explorerPatch.refreshAll();
					}),
				);
				row.addText((text) =>
					text.setValue(status.label).onChange((value) => {
						this.store.updateStatus(set.id, status.id, { label: value || status.label });
						this.plugin.explorerPatch.refreshAll();
					}),
				);
				row.addExtraButton((btn) =>
					btn
						.setIcon("arrow-up")
						.setTooltip("Move up")
						.setDisabled(idx === 0)
						.onClick(() => {
							const order = set.statuses.map((s) => s.id);
							[order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
							this.store.reorderStatuses(set.id, order);
							this.plugin.explorerPatch.refreshAll();
							this.display();
						}),
				);
				row.addExtraButton((btn) =>
					btn
						.setIcon("arrow-down")
						.setTooltip("Move down")
						.setDisabled(idx === set.statuses.length - 1)
						.onClick(() => {
							const order = set.statuses.map((s) => s.id);
							[order[idx + 1], order[idx]] = [order[idx], order[idx + 1]];
							this.store.reorderStatuses(set.id, order);
							this.plugin.explorerPatch.refreshAll();
							this.display();
						}),
				);
				row.addExtraButton((btn) =>
					btn.setIcon("trash").setTooltip("Remove status").onClick(() => {
						this.store.removeStatus(set.id, status.id);
						this.plugin.explorerPatch.refreshAll();
						this.display();
					}),
				);
			});

			new Setting(wrapper).addButton((btn) =>
				btn.setButtonText("Add status").onClick(() => {
					this.store.addStatus(set.id, "New status", "#888888");
					this.display();
				}),
			);
		}

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("New status set")
				.setCta()
				.onClick(() => {
					this.store.createStatusSet("New status set");
					this.display();
				}),
		);
	}

	// ---------- Folder assignments ----------

	private renderFolderAssignments(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Folder assignments").setHeading();
		containerEl.createEl("p", {
			text: "Folders where statuses are currently turned on, and which status set governs their contents.",
			cls: "setting-item-description",
		});

		const configs = this.store.getAllFolderConfigs();
		if (configs.length === 0) {
			containerEl.createEl("p", { text: "No folders have statuses enabled yet.", cls: "setting-item-description" });
		}

		for (const cfg of configs) {
			const set = this.store.getStatusSet(cfg.statusSetId);
			const setting = new Setting(containerEl)
				.setName(cfg.path === ROOT_PATH ? "/ (vault root)" : cfg.path)
				.setDesc(set ? `Status set: ${set.name}` : "Status set no longer exists");

			if (set) {
				setting.addDropdown((dd) => {
					for (const status of set.statuses) dd.addOption(status.id, status.label);
					dd.setValue(cfg.defaultStatusId).onChange((value) => {
						this.store.updateFolderConfig(cfg.path, { defaultStatusId: value });
						this.plugin.explorerPatch.refreshAll();
					});
				});
			}

			setting.addToggle((toggle) =>
				toggle
					.setTooltip("Inherit to subfolders without their own assignment")
					.setValue(cfg.inheritToChildren)
					.onChange((value) => {
						this.store.updateFolderConfig(cfg.path, { inheritToChildren: value });
						this.plugin.explorerPatch.refreshAll();
					}),
			);

			setting.addExtraButton((btn) =>
				btn.setIcon("trash").setTooltip("Disable statuses for this folder").onClick(() => {
					this.store.disableFolder(cfg.path);
					this.plugin.explorerPatch.refreshAll();
					this.display();
				}),
			);
		}

		this.renderAddFolderAssignment(containerEl);
	}

	private renderAddFolderAssignment(containerEl: HTMLElement): void {
		const sets = this.store.getStatusSets();
		let selectedPath = "";
		let selectedSetId = sets[0]?.id ?? "";

		const setting = new Setting(containerEl).setName("Assign a folder");
		setting.addText((text) => {
			text.setPlaceholder("path/to/folder (blank = vault root)");
			text.onChange((value) => (selectedPath = value));
		});
		setting.addDropdown((dd) => {
			if (sets.length === 0) {
				dd.addOption("", "Create a status set first");
				dd.setDisabled(true);
				return;
			}
			for (const set of sets) dd.addOption(set.id, set.name);
			selectedSetId = sets[0].id;
			dd.onChange((value) => (selectedSetId = value));
		});
		setting.addButton((btn) =>
			btn
				.setButtonText("Enable")
				.setCta()
				.setDisabled(sets.length === 0)
				.onClick(() => {
					const set = this.store.getStatusSet(selectedSetId);
					if (!set || set.statuses.length === 0) return;
					const path = normalizePath(selectedPath.trim());
					const folderPath = path === "." || path === "/" ? ROOT_PATH : path;
					const folder = folderPath === ROOT_PATH
						? this.app.vault.getRoot()
						: this.app.vault.getAbstractFileByPath(folderPath);
					if (!(folder instanceof TFolder)) {
						new Notice(`"${folderPath}" is not a folder in this vault.`);
						return;
					}
					const children = folder.children.map((c) => c.path);
					this.store.enableFolder(folderPath, set.id, set.statuses[0].id, true, children);
					this.plugin.explorerPatch.refreshAll();
					this.display();
				}),
		);
	}
}
