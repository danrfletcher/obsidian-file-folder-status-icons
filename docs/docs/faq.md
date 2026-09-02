# FAQ and Troubleshooting

## I enabled a folder but I don't see any dots

Check that the status set you picked actually has statuses defined — a set with zero statuses enables cleanly but has nothing to show. Add at least one status in **Settings → File and Folder Status Icons**, then reopen the folder (collapse and re-expand it if it doesn't refresh immediately).

## A subfolder isn't showing dots even though its parent is enabled

Inheritance is a per-folder toggle. Check **Folder assignments** in Settings for the *parent* folder — if **inherit to subfolders** is off, only that folder's own direct children get dots, not deeper descendants. Turn it on, or enable the subfolder explicitly with its own status set.

## I disabled statuses for a folder — did I lose everything?

No. Disabling a folder only stops showing dots; every item's assigned status is kept. Re-enable the folder (same status set or a different one) and previously-assigned items keep whatever status they had.

## The tree isn't grouping/sorting by status

Grouping only applies to folders with statuses currently enabled. A folder with statuses off sorts however your Obsidian file explorer is normally configured. If the folder *is* enabled and still isn't grouping, try clicking any status dot in it once — that's a state change and will force a re-sort.

## Does this write anything to my notes?

No. Every status set, folder assignment, and per-item status lives entirely in the plugin's own data file, keyed by path — never in frontmatter or note content. This also means status **isn't currently queryable from Dataview or Bases**, since there's no frontmatter field to query against. If that's something you need, open an issue — an optional "also write to frontmatter" mode is a reasonable thing to consider.

## Does it work on Obsidian Mobile?

Not currently — the plugin is marked `isDesktopOnly: true`. It works by patching the native file explorer's DOM directly, which hasn't been verified on mobile yet.

## I renamed or moved a file — did its status survive?

If you renamed or moved it **from inside Obsidian** (the sidebar, the command palette, drag-and-drop), yes — the plugin listens for Obsidian's own rename event and rekeys the stored status automatically. If a file was renamed **outside Obsidian** (Finder, Terminal, another app) while the vault was closed, Obsidian's own file watcher may see that as a delete-and-recreate rather than a rename, in which case the new path won't have picked up the old status — it'll just fall back to the folder's default the next time Obsidian scans it.

## I moved a folder that was inheriting its statuses — did it lose them?

It shouldn't. If a folder had no status configuration of its own and was only inheriting from an enabled ancestor, moving it snapshots what it was inheriting and gives it that same configuration at its new location — see [Nested folders and inheritance](reference/folders.md#nested-folders-and-inheritance). If you do hit a case where this doesn't hold, please open an issue with the before/after folder structure.

## Marked a status "completed" but items in it still show

Completed only controls **hiding**, not display style — dots for completed items look the same as any other. To actually hide them, turn on **Hide completed** for that specific folder (Settings, or right-click the folder → **Hide completed items**). It's per-folder, so a completed item can be hidden in one folder's view and still show normally if inherited elsewhere.

## Why does the plugin need my vault's folder list?

The "Assign a folder" autocomplete (see [Settings Reference](settings.md#assign-a-folder)) suggests matching folder paths as you type, which requires reading the vault's folder structure. It never reads file contents, and never sends anything over the network — the plugin makes no network requests at all.

## What happens if I delete a status that's set as a folder's default?

Any folder whose default was that status falls back to whichever status is now first in the set. Existing items that were already explicitly assigned that status keep showing it until you change them, even though it's no longer selectable as a *new* default going forward — remove or reassign them manually if you want a clean break.

## Still stuck?

Open an issue on [GitHub](https://github.com/danrfletcher/obsidian-file-folder-status-icons/issues) with what you tried and what happened.
