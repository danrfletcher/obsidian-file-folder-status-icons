/** Small color helpers used by the popup and settings UI. Kept dependency-free. */

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isValidHexColor(value: string): boolean {
	return HEX_RE.test(value.trim());
}

export function normalizeHexColor(value: string, fallback = "#888888"): string {
	const v = value.trim();
	return isValidHexColor(v) ? v : fallback;
}

/** Picks black or white text so labels stay legible on an arbitrary swatch color. */
export function contrastingTextColor(hex: string): "#000000" | "#ffffff" {
	const c = normalizeHexColor(hex).replace("#", "");
	const full = c.length === 3 ? c.split("").map((ch) => ch + ch).join("") : c;
	const r = parseInt(full.substring(0, 2), 16);
	const g = parseInt(full.substring(2, 4), 16);
	const b = parseInt(full.substring(4, 6), 16);
	// Perceived luminance (ITU-R BT.601).
	const luminance = (r * 299 + g * 587 + b * 114) / 1000;
	return luminance > 150 ? "#000000" : "#ffffff";
}

let idCounter = 0;
export function generateId(prefix: string): string {
	idCounter += 1;
	return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}
