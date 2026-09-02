/** Vault-relative path helpers. Obsidian paths use "/" and never a leading slash. */

export const ROOT_PATH = "";

export function parentPath(path: string): string {
	if (path === ROOT_PATH) return ROOT_PATH;
	const idx = path.lastIndexOf("/");
	return idx === -1 ? ROOT_PATH : path.slice(0, idx);
}

export function basename(path: string): string {
	const idx = path.lastIndexOf("/");
	return idx === -1 ? path : path.slice(idx + 1);
}

/** True if `path` is `ancestor` itself or nested under it. */
export function isSameOrDescendant(path: string, ancestor: string): boolean {
	if (ancestor === ROOT_PATH) return true;
	return path === ancestor || path.startsWith(ancestor + "/");
}

/**
 * Rewrites a stored path when a file/folder is renamed or moved.
 * Returns null if `storedPath` is unaffected by the rename.
 */
export function rewritePathOnRename(
	storedPath: string,
	oldPath: string,
	newPath: string,
): string | null {
	if (storedPath === oldPath) return newPath;
	if (storedPath.startsWith(oldPath + "/")) {
		return newPath + storedPath.slice(oldPath.length);
	}
	return null;
}
