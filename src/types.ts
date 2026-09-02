/**
 * Data model for File and Folder Status Icons.
 *
 * Everything here is persisted in the plugin's own data.json (via
 * Plugin#loadData / Plugin#saveData) — nothing is ever written into note
 * frontmatter. All records are keyed by vault-relative path so they can be
 * rekeyed on rename/move (see DataStore).
 */

export interface StatusDefinition {
	/** Stable id, independent of label so renaming a status doesn't orphan assignments. */
	id: string;
	label: string;
	/** Hex color, e.g. "#e03131". */
	color: string;
}

export interface StatusSet {
	id: string;
	name: string;
	/** Order here defines both display order and sort precedence (index 0 = highest rank). */
	statuses: StatusDefinition[];
}

export interface FolderConfig {
	/** Vault-relative folder path. "" means the vault root. */
	path: string;
	statusSetId: string;
	/** Must be an id present in the referenced StatusSet. Assigned to children that have no status yet. */
	defaultStatusId: string;
	sortMode: "none" | "status";
	/** If true, folders/files below this one inherit this config when they have no config of their own. */
	inheritToChildren: boolean;
}

export interface PluginData {
	dataVersion: 1;
	statusSets: Record<string, StatusSet>;
	/** Keyed by folder path. Only present for folders where statuses were explicitly enabled. */
	folderConfigs: Record<string, FolderConfig>;
	/** Keyed by file/folder path -> status id (interpreted against the governing folder's status set). */
	itemStatuses: Record<string, string>;
}

export interface ResolvedDisplay {
	statusSet: StatusSet;
	status: StatusDefinition;
}

export function createEmptyPluginData(): PluginData {
	return {
		dataVersion: 1,
		statusSets: {},
		folderConfigs: {},
		itemStatuses: {},
	};
}
