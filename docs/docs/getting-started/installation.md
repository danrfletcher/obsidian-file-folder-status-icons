# Installation

File Folder Status Sets is a **desktop-only** plugin — it patches Obsidian's native file explorer directly, which hasn't been verified against Obsidian Mobile yet. `isDesktopOnly: true` in `manifest.json` reflects this.

## From Obsidian's Community Plugins browser

1. Open **Settings → Community plugins → Browse**.
2. Search for "File Folder Status Sets".
3. Click **Install**, then **Enable**.

## Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/danrfletcher/obsidian-file-folder-status-icons/releases/latest).
2. Create a folder named `file-folder-status-icons` inside your vault's `.obsidian/plugins/` directory.
3. Place the three downloaded files inside it.
4. Reload Obsidian (or use **Settings → Community plugins → Reload plugins**).
5. Enable **File Folder Status Sets** under **Settings → Community plugins**.

## BRAT (Beta Reviewers Auto-update Tool)

If you use [BRAT](https://github.com/TfTHacker/obsidian42-brat) to track plugins directly from GitHub:

1. Install BRAT from the Community Plugins browser if you haven't already.
2. Run the **BRAT: Add a beta plugin for testing** command.
3. Paste `danrfletcher/obsidian-file-folder-status-icons`.
4. BRAT installs it and will offer updates as new releases ship.

## Next

Once it's enabled, head to [Your First Status Set](first-status-set.md) to set one up from scratch.
