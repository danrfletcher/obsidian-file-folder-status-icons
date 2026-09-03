/**
 * Data model for Status Sets.
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
	/** Statuses marked completed can be hidden per folder (see FolderConfig#hideCompleted). A set may have more than one. */
	isCompleted?: boolean;
}

export interface StatusSet {
	id: string;
	name: string;
	/** Order here defines both display order and sort precedence (index 0 = highest rank). */
	statuses: StatusDefinition[];
	/**
	 * The status new folder assignments start from by default. Not necessarily
	 * `statuses[0]` — it starts there when the set is first created, but stays
	 * put if the user reorders statuses; only "Make default" moves it.
	 */
	defaultStatusId: string;
}

export interface TruncationRule {
	/** When true, and 2+ direct children of the folder share this status, they collapse into one summary row. */
	enabled: boolean;
	/**
	 * Overrides the default pluralized status label in the summary text
	 * (e.g. "Project Ideas" instead of the default "Ideas"). Blank uses the default.
	 */
	label: string;
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
	/** If true, items whose resolved status is marked completed are hidden from the tree entirely. */
	hideCompleted?: boolean;
	/** If false, statuses aren't shown or sorted-by for files directly under this folder. Default true. */
	applyToFiles?: boolean;
	/** If false, statuses aren't shown or sorted-by for subfolders directly under this folder. Default true. */
	applyToFolders?: boolean;
	/** Per-status truncation rules for this folder's direct children, keyed by status id. */
	truncatedStatuses?: Record<string, TruncationRule>;
}

export interface PluginData {
	dataVersion: 1;
	statusSets: Record<string, StatusSet>;
	/** Keyed by folder path. Only present for folders where statuses were explicitly enabled. */
	folderConfigs: Record<string, FolderConfig>;
	/** Keyed by file/folder path -> status id (interpreted against the governing folder's status set). */
	itemStatuses: Record<string, string>;
	/** Reusable hex swatches offered when picking a status color, seeded with a default pastel set. */
	colorPalette: string[];
	/** Neon glow around status dots in the file tree. Purely cosmetic, off by default. */
	glowEnabled?: boolean;
}

export interface ResolvedDisplay {
	statusSet: StatusSet;
	status: StatusDefinition;
}

/** A pleasant default pastel palette, offered alongside the native color picker. */
export const DEFAULT_COLOR_PALETTE: string[] = [
	"#FFADAD",
	"#FFD6A5",
	"#FDFFB6",
	"#CAFFBF",
	"#9BF6FF",
	"#A0C4FF",
	"#BDB2FF",
	"#FFC6FF",
	"#E2E2E2",
];

export function createEmptyPluginData(): PluginData {
	return {
		dataVersion: 1,
		statusSets: {},
		folderConfigs: {},
		itemStatuses: {},
		colorPalette: [...DEFAULT_COLOR_PALETTE],
		glowEnabled: false,
	};
}
