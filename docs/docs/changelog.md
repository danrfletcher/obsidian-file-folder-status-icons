# Changelog

## 0.6.1

- Fixed: renaming a folder that had a status set assigned to it could lose
  the assignment — along with every file and subfolder's status inside it —
  and leave the app slow to reopen the vault afterwards. Root cause:
  Obsidian's vault watcher doesn't always deliver a folder rename as a single
  event; a rename that didn't originate from Obsidian's own file explorer
  (an external tool, a sync client, the OS file manager) instead arrives as
  the old folder and everything in it being deleted, followed separately by
  the new one being created, with nothing linking the two. Deletes are now
  held briefly and checked against what was just created before being
  applied, so a rename recognized this way keeps its assignment; a genuine
  deletion is unaffected.

## 0.6.0

- Added: cancelled statuses. Any status can be marked "cancelled" from its
  "..." menu in Settings, alongside the existing "completed" — a status is
  one or the other, not both, so marking one clears the other. Folder
  assignments' "Hide completed" toggle is now "Hide", with separate
  Completed/Cancelled toggles, and the file tree's right-click menu gained a
  matching "Show/Hide cancelled items" entry.
- Changed: this plugin's right-click file/folder menu entries are now nested
  under a single "File and Folder Status Options" submenu instead of several
  top-level entries.
- Fixed: expanding or collapsing a status set or folder assignment card in
  Settings scrolled the whole pane back to the top instead of leaving
  everything above the toggled section in place.

## 0.5.2

- Fixed: clicking a truncated status group's summary row (or an expanded
  member's dot to collapse it again) still didn't work for some users even
  after 0.5.1's fix, despite the row now rendering correctly. Root cause:
  every interaction in this plugin was driven by the browser's `click`/
  `dblclick` events, which are synthesized on top of the lower-level
  `mousedown`/`mouseup` pair — and at least one real combination of input
  method and Electron/Chromium build reliably delivers mousedown and mouseup
  perfectly while never synthesizing `click` at all. Every interaction
  (status dots, truncation summary rows, double-click-to-collapse) is now
  driven directly off `mousedown`, with double-click detected manually by
  timing two mousedowns on the same dot, rather than depending on `click`/
  `dblclick` ever firing.

## 0.5.1

- Fixed: clicking a truncated status group's summary row (e.g. "3 Ideas") did
  nothing — it was actually rendering with `display: none` the whole time,
  a side effect of 0.5.0's alignment fix cloning the row *after* marking it
  hidden. Clicking the dot or the text now reliably expands the group again,
  routed through the same click-handling path already used to survive other
  plugins (e.g. Folder Notes) intercepting clicks on folder titles.
- Fixed: the summary row's text and dot were still visibly different from a
  real item's — slightly muted text and a slightly larger dot. Both are now
  built from the exact same classes and elements a real row uses, with no
  styling of our own layered on top, so they render pixel-identical.

## 0.5.0

- Fixed: a truncated status group's summary row (e.g. "3 Ideas") sat visibly
  out of alignment with real rows below it — its dot didn't line up with
  theirs, and its text rendered at a slightly larger font size. The summary
  row is now built from a clone of a real row rather than from scratch, so it
  automatically picks up the exact same indentation and font rules as
  everything else in the tree.
- **Folder assignments** in Settings now start **collapsed** by default, like
  status sets — click the chevron to expand one you're working on.
- Fixed: folder assignment cards could overlap their own controls, or hide
  the folder's name entirely, in a narrow settings pane. Each toggle now gets
  its own row (matching the rest of the settings tab), and any row that still
  holds more than one toggle wraps between them instead of overlapping.
- **Support section** at the bottom of Settings: buttons to report a bug (a
  pre-filled GitHub issue form), request a feature (the GitHub Discussions
  Ideas board), or buy the developer a coffee.

## 0.4.0

- Fixed: renaming a folder that only *inherited* its status configuration
  (no explicit assignment of its own) — e.g. a subfolder created inside an
  already-enabled folder — permanently disconnected it from that
  inheritance, freezing a duplicate copy of its ancestor's configuration at
  rename time instead of continuing to follow it. Renaming within the same
  parent now leaves inheritance untouched; only an actual move to a
  different parent still snapshots and carries the configuration along, as
  intended.
- **Apply statuses to files or folders independently** — each folder
  assignment now has separate **Files** / **Folders** toggles (Settings →
  Folder assignments), both on by default. Turn either off and that type
  stops showing/sorting by status under this folder, sorting alphabetically
  below the other type instead.
- **Truncate statuses** — collapse 2 or more direct children sharing a
  status into one summary row (e.g. "3 Ideas"), per status, per folder
  assignment. Optional custom label text (e.g. "Project Ideas" instead of
  the default "Ideas"). Click the summary row to expand it; double-click any
  status dot in the expanded group to collapse it again.

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
