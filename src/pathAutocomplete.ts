import { ROOT_PATH } from "./pathUtils";

const MAX_SUGGESTIONS = 30;

/**
 * Wires a live folder-path suggestion dropdown onto a text input: as the
 * user types, shows vault folders whose path contains the current text,
 * clicking one fills the input and closes the dropdown.
 */
export function attachFolderPathAutocomplete(opts: {
	input: HTMLInputElement;
	getAllFolderPaths: () => string[];
	onSelect: (path: string) => void;
}): void {
	const { input } = opts;
	const doc = input.doc;
	const win = input.win;
	let dropdown: HTMLElement | null = null;

	function close() {
		dropdown?.remove();
		dropdown = null;
		doc.removeEventListener("mousedown", onOutsideClick, true);
	}

	function onOutsideClick(evt: MouseEvent) {
		if (dropdown && !dropdown.contains(evt.target as Node) && evt.target !== input) close();
	}

	function render() {
		const query = input.value.trim().toLowerCase();
		const allPaths = opts.getAllFolderPaths();
		const matches = allPaths
			.filter((p) => (query === "" ? true : p.toLowerCase().includes(query)))
			.slice(0, MAX_SUGGESTIONS);

		if (matches.length === 0) {
			close();
			return;
		}

		if (!dropdown) {
			dropdown = doc.body.createDiv({ cls: "ffsi-popup ffsi-autocomplete" });
			win.setTimeout(() => doc.addEventListener("mousedown", onOutsideClick, true), 0);
		}
		dropdown.empty();
		for (const path of matches) {
			const row = dropdown.createDiv({ cls: "ffsi-popup-item" });
			row.createSpan({ cls: "ffsi-popup-label", text: path === ROOT_PATH ? "/ (vault root)" : path });
			row.addEventListener("mousedown", (evt) => {
				// mousedown (not click) so this fires before the input's blur closes the dropdown.
				evt.preventDefault();
				input.value = path;
				opts.onSelect(path);
				close();
			});
		}

		const rect = input.getBoundingClientRect();
		dropdown.setCssStyles({
			left: `${Math.round(rect.left)}px`,
			top: `${Math.round(rect.bottom + 4)}px`,
			width: `${Math.round(rect.width)}px`,
		});
	}

	input.addEventListener("input", render);
	input.addEventListener("focus", render);
}
