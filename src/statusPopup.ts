import { StatusDefinition, StatusSet } from "./types";

export interface ChoiceItem {
	id: string;
	label: string;
	/** Hex color for the swatch. Omit to render a plain text row (e.g. picking a status set). */
	color?: string;
}

/**
 * Small floating popup listing choices as an optional color swatch + label.
 * Backs both the tree's click-to-change-status icon and the folder-enable
 * flow's "pick a status set" / "pick a default status" steps.
 */
export function openChoicePopup(opts: {
	anchor: HTMLElement;
	items: ChoiceItem[];
	currentId?: string;
	emptyMessage?: string;
	onSelect: (item: ChoiceItem) => void;
}): void {
	document.querySelectorAll(".ffsi-popup").forEach((el) => el.remove());

	const popup = document.body.createDiv({ cls: "ffsi-popup" });
	const rect = opts.anchor.getBoundingClientRect();
	popup.style.left = `${Math.round(rect.left)}px`;
	popup.style.top = `${Math.round(rect.bottom + 4)}px`;

	if (opts.items.length === 0) {
		popup.createDiv({ cls: "ffsi-popup-empty", text: opts.emptyMessage ?? "Nothing to choose from yet." });
	}

	for (const item of opts.items) {
		const row = popup.createDiv({ cls: "ffsi-popup-item" });
		if (item.id === opts.currentId) row.addClass("is-active");
		if (item.color) {
			const swatch = row.createSpan({ cls: "ffsi-swatch" });
			swatch.style.backgroundColor = item.color;
		}
		row.createSpan({ cls: "ffsi-popup-label", text: item.label });
		row.addEventListener("click", (evt) => {
			evt.stopPropagation();
			opts.onSelect(item);
			close();
		});
	}

	// Keep the popup on screen if it would overflow the viewport bottom/right.
	requestAnimationFrame(() => {
		const popupRect = popup.getBoundingClientRect();
		if (popupRect.bottom > window.innerHeight) {
			popup.style.top = `${Math.max(4, Math.round(rect.top - popupRect.height - 4))}px`;
		}
		if (popupRect.right > window.innerWidth) {
			popup.style.left = `${Math.max(4, Math.round(window.innerWidth - popupRect.width - 4))}px`;
		}
	});

	function close() {
		popup.remove();
		document.removeEventListener("mousedown", onOutsideClick, true);
		document.removeEventListener("keydown", onKeydown, true);
	}
	function onOutsideClick(evt: MouseEvent) {
		if (!popup.contains(evt.target as Node)) close();
	}
	function onKeydown(evt: KeyboardEvent) {
		if (evt.key === "Escape") close();
	}
	// Deferred so the click that opened the popup doesn't immediately close it.
	setTimeout(() => {
		document.addEventListener("mousedown", onOutsideClick, true);
		document.addEventListener("keydown", onKeydown, true);
	}, 0);
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
