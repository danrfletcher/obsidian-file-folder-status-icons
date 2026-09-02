# Changelog

## 0.3.1

- Fixed: clicking a status dot on a folder that has a **folder note** (e.g.
  the [Folder Notes](https://github.com/LostPaul/obsidian-folder-notes)
  plugin) did nothing — that plugin's own click handling on the file tree
  ate the click before it reached this plugin. The change-status popup now
  opens reliably for those folders too, files and plain folders unaffected.

## 0.3.0

- Fixed: a status added to a set *after* a folder was already assigned to it
  now shows up immediately in that folder's change-status popup — no restart
  needed.
- **Folder assignments** in Settings: the dropdown next to each folder now
  switches which **status set** governs it, instead of duplicating the
  per-folder default-status control (right-click the folder → **Change
  default status for this folder** for that). Switching sets resets the
  folder's default to the new set's own default.
- **Status sets** in Settings now start **collapsed** — click the chevron to
  expand one you're editing. Cuts down on scrolling once you have a few sets
  defined.
- **Design → Glow**: an optional neon glow around status dots in the file
  tree. The dot itself stays the same size either way — only the glow, which
  paints outside the dot without affecting the row's height.

## 0.2.1

- Style fix: the "Hide completed" rule no longer uses `!important` (a directory-review lint flag) — same effect, via selector specificity instead.

## 0.2.0

- Status sets now have a **default status** (starts as the first status you add, changeable via each status's **"..."** menu → **Make default**). Enabling a folder uses it directly instead of asking again.
- **Completed statuses** — mark any status "completed" (a set can have more than one) via the **"..."** menu, and **Hide completed** per folder to hide those items from the tree (Settings or right-click).
- **Color palette** — pick from a curated pastel palette or a fully custom color, and save custom colors back to the palette. Palette entries (including defaults) can be removed.
- **Folder path autocomplete** in "Assign a folder".
- Labeled the "Inherit to subfolders" toggle (previously tooltip-only).
- Fixed: a folder relying purely on an ancestor's inherited status configuration no longer loses its statuses when moved out from under that ancestor.

## 0.1.3

- Cross-window compatibility fixes (popped-out file explorer windows) and added GitHub artifact attestations to releases — no user-facing behavior change.

## 0.1.2

- Renamed the plugin from "File & Folder Status Icons" to "File and Folder Status Icons" to meet the community directory's naming rules.

## 0.1.1

- Settings UI polish.

## 0.1.0

- Initial release: status sets with custom statuses and colors, per-folder enable/disable via right-click or Settings, click-to-change-status popup, persistent group-by-status sorting, and nested-folder inheritance.

See the full commit history on [GitHub](https://github.com/danrfletcher/obsidian-file-folder-status-icons/releases).
