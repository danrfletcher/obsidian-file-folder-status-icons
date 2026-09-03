import { DataStore } from "./dataStore";
import { openStatusPopup } from "./statusPopup";
import { StatusDefinition, StatusSet } from "./types";

/**
 * Public surface for other plugins to read Status Sets' data and reuse its
 * status-change popup, without depending on internal classes (DataStore,
 * ExplorerPatch, etc) that may change shape between releases.
 *
 * Reached via `app.plugins.plugins["file-folder-status-icons"]?.api`. Always
 * optional-chain and check for `undefined` — the host plugin may not be
 * installed, may not be enabled yet, or may predate this API.
 *
 * UNSTABLE: this is a young, hand-rolled contract (no semver package, no
 * deprecation window) built specifically to support the companion
 * "Checklist Status Icons" plugin. Check `apiVersion` if you need to guard
 * against future breaking changes.
 */
export interface PublicApi {
	/** Bumped only on breaking changes to this interface. */
	readonly apiVersion: 1;

	/** Every status set currently defined. Returns a snapshot copy — mutating it has no effect on Status Sets' data. */
	getStatusSets(): StatusSet[];

	/** A single status set by id, or undefined if it doesn't exist. Returns a snapshot copy, same caveat as getStatusSets. */
	getStatusSet(id: string): StatusSet | undefined;

	/** Whether the Glow design setting is currently on. */
	isGlowEnabled(): boolean;

	/**
	 * Subscribe to "something changed" (a status was edited, a set was
	 * renamed, Glow was toggled, ...). Fires with no payload — re-read
	 * whatever you need via the getters above. Returns an unsubscribe
	 * function; call it in your plugin's onunload.
	 */
	onChange(callback: () => void): () => void;

	/**
	 * Opens Status Sets' own status-change popup, anchored to `anchor`,
	 * listing `statusSet`'s statuses with `currentStatusId` highlighted.
	 * Identical component/styling used internally, so it stays in sync with
	 * any future visual changes to it here.
	 */
	openStatusPopup(opts: {
		anchor: HTMLElement;
		statusSet: StatusSet;
		currentStatusId: string;
		onSelect: (status: StatusDefinition) => void;
	}): void;
}

/** Deep-enough clone so callers can't mutate our internal data through the returned objects. */
function cloneStatusSet(set: StatusSet): StatusSet {
	return {
		id: set.id,
		name: set.name,
		defaultStatusId: set.defaultStatusId,
		statuses: set.statuses.map((s) => ({ ...s })),
	};
}

export function createPublicApi(store: DataStore): PublicApi {
	return {
		apiVersion: 1,
		getStatusSets: () => store.getStatusSets().map(cloneStatusSet),
		getStatusSet: (id) => {
			const set = store.getStatusSet(id);
			return set ? cloneStatusSet(set) : undefined;
		},
		isGlowEnabled: () => store.isGlowEnabled(),
		onChange: (callback) => store.onChange(callback),
		openStatusPopup,
	};
}
