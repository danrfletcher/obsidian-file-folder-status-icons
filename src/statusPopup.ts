import { StatusDefinition, StatusSet } from "./types";

export interface ChoiceItem {
	id: string;
	label: string;
	/** Hex color for the swatch. Omit to render a plain text row (e.g. picking a status set, or a menu action). */
	color?: string;
}

/** Positions `popup` under `anchor` (flipping above/left if it would overflow) and wires outside-click/Escape dismissal. */
function attachFloatingPopup(popup: HTMLElement, anchor: HTMLElement): void {
	const doc = anchor.doc;
	const win = anchor.win;
	const rect = anchor.getBoundingClientRect();
	popup.setCssStyles({ left: `${Math.round(rect.left)}px`, top: `${Math.round(rect.bottom + 4)}px` });

	win.requestAnimationFrame(() => {
		const popupRect = popup.getBoundingClientRect();
		if (popupRect.bottom > win.innerHeight) {
			popup.setCssStyles({ top: `${Math.max(4, Math.round(rect.top - popupRect.height - 4))}px` });
		}
		if (popupRect.right > win.innerWidth) {
			popup.setCssStyles({ left: `${Math.max(4, Math.round(win.innerWidth - popupRect.width - 4))}px` });
		}
	});

	function close() {
		popup.remove();
		doc.removeEventListener("mousedown", onOutsideClick, true);
		doc.removeEventListener("keydown", onKeydown, true);
	}
	function onOutsideClick(evt: MouseEvent) {
		if (!popup.contains(evt.target as Node)) close();
	}
	function onKeydown(evt: KeyboardEvent) {
		if (evt.key === "Escape") close();
	}
	// Deferred so the click that opened the popup doesn't immediately close it.
	win.setTimeout(() => {
		doc.addEventListener("mousedown", onOutsideClick, true);
		doc.addEventListener("keydown", onKeydown, true);
	}, 0);
}

/**
 * Small floating popup listing choices as an optional color swatch + label.
 * Backs the tree's click-to-change-status icon, the folder-enable flow's
 * "pick a status set" step, and any plain text action menu (e.g. a status
 * row's "..." menu).
 *
 * Uses the anchor's own `.doc`/`.win` throughout (rather than the global
 * `document`/`window`) so this still opens in the right window if the
 * triggering file explorer is in a popped-out window.
 */
export function openChoicePopup(opts: {
	anchor: HTMLElement;
	items: ChoiceItem[];
	currentId?: string;
	emptyMessage?: string;
	onSelect: (item: ChoiceItem) => void;
}): void {
	const doc = opts.anchor.doc;
	doc.querySelectorAll(".ffsi-popup").forEach((el) => el.remove());

	const popup = doc.body.createDiv({ cls: "ffsi-popup" });

	if (opts.items.length === 0) {
		popup.createDiv({ cls: "ffsi-popup-empty", text: opts.emptyMessage ?? "Nothing to choose from yet." });
	}

	for (const item of opts.items) {
		const row = popup.createDiv({ cls: "ffsi-popup-item" });
		if (item.id === opts.currentId) row.addClass("is-active");
		if (item.color) {
			const swatch = row.createSpan({ cls: "ffsi-swatch" });
			swatch.setCssStyles({ backgroundColor: item.color });
		}
		row.createSpan({ cls: "ffsi-popup-label", text: item.label });
		row.addEventListener("click", (evt) => {
			evt.stopPropagation();
			opts.onSelect(item);
			popup.remove();
		});
	}

	attachFloatingPopup(popup, opts.anchor);
}

export function openStatusPopup(opts: {
	anchor: HTMLElement;
	statusSet: StatusSet;
	currentStatusId: string;
	onSelect: (status: StatusDefinition) => void;
}): void {
	openChoicePopup({
		anchor: opts.anchor,
		items: opts.statusSet.statuses.map((s) => ({ id: s.id, label: s.label, color: s.color })),
		currentId: opts.currentStatusId,
		emptyMessage: "No statuses defined yet — add some in settings.",
		onSelect: (item) => {
			const status = opts.statusSet.statuses.find((s) => s.id === item.id);
			if (status) opts.onSelect(status);
		},
	});
}

export function openStatusSetPopup(opts: {
	anchor: HTMLElement;
	statusSets: StatusSet[];
	onSelect: (set: StatusSet) => void;
}): void {
	openChoicePopup({
		anchor: opts.anchor,
		items: opts.statusSets.map((s) => ({ id: s.id, label: s.name })),
		emptyMessage: "No status sets yet — create one in settings first.",
		onSelect: (item) => {
			const set = opts.statusSets.find((s) => s.id === item.id);
			if (set) opts.onSelect(set);
		},
	});
}

/**
 * Color picker popup: a grid of palette swatches, plus a native color input
 * for anything custom, plus a way to save that custom color back into the
 * palette for reuse.
 */
export function openColorPickerPopup(opts: {
	anchor: HTMLElement;
	palette: string[];
	currentColor: string;
	onPick: (hex: string) => void;
	onSaveToPalette: (hex: string) => void;
}): void {
	const doc = opts.anchor.doc;
	doc.querySelectorAll(".ffsi-popup").forEach((el) => el.remove());

	const popup = doc.body.createDiv({ cls: "ffsi-popup ffsi-color-popup" });

	const grid = popup.createDiv({ cls: "ffsi-color-grid" });
	for (const hex of opts.palette) {
		const swatch = grid.createDiv({ cls: "ffsi-swatch ffsi-color-grid-swatch" });
		swatch.setCssStyles({ backgroundColor: hex });
		if (hex.toLowerCase() === opts.currentColor.toLowerCase()) swatch.addClass("is-active");
		swatch.setAttribute("aria-label", hex);
		swatch.setAttribute("title", hex);
		swatch.addEventListener("click", (evt) => {
			evt.stopPropagation();
			opts.onPick(hex);
			popup.remove();
		});
	}

	const customRow = popup.createDiv({ cls: "ffsi-color-custom-row" });
	const customInput = customRow.createEl("input", { type: "color" });
	customInput.value = opts.currentColor;
	customInput.addEventListener("input", () => opts.onPick(customInput.value));

	const saveBtn = customRow.createEl("button", { text: "Save to palette", cls: "ffsi-color-save-btn" });
	saveBtn.addEventListener("click", (evt) => {
		evt.stopPropagation();
		opts.onSaveToPalette(customInput.value);
	});

	attachFloatingPopup(popup, opts.anchor);
}
