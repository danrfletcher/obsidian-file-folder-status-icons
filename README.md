# File and Folder Status Icons

Traffic-light style status icons for files and folders in Obsidian's file
tree — think ClickUp's status pills, applied to your vault structure.

![Screenshot](images/screenshot.png)

## Features

- **Status dots in the file tree.** Any file or folder can show a small
  colored status icon next to its name, right in the native file explorer.
- **Custom statuses, custom colors.** Define your own statuses (label +
  color) grouped into reusable **status sets** in Settings.
- **Per-folder status sets and defaults.** Right-click any folder →
  *Enable statuses for this folder*, pick a status set, and every item in
  that folder is assigned its default status. You can also assign folders
  directly from Settings.
- **Click a dot to change it.** Click any status icon to open a small
  popup and re-assign that file or folder's status.
- **Group by status.** Enabled folders automatically sort their contents by
  status, and that order persists across restarts.
- **Nothing touches your notes.** All assignments live in the plugin's own
  data file — no frontmatter is ever written.

## Usage

1. Open **Settings → File and Folder Status Icons** and create a status set
   (e.g. "Not started" / "In progress" / "Done") with a color for each.
2. Right-click a folder in the file explorer → **Enable statuses for this
   folder** → pick the status set and a default status.
3. Click any status dot in the tree to change that item's status.
4. Right-click an enabled folder again to change its default status or turn
   statuses off (existing assignments are kept, so re-enabling restores
   them).

## Installation

### From Obsidian

Settings → Community plugins → Browse → search "File and Folder Status
Icons" → Install → Enable.

### Manually

Copy `main.js`, `manifest.json`, and `styles.css` from a
[release](https://github.com/danrfletcher/obsidian-file-folder-status-icons/releases)
into `<your-vault>/.obsidian/plugins/file-folder-status-icons/`, then
enable the plugin from Community plugins.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # typecheck + production build
npm run lint
```

## License

MIT
