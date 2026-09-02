# Assigning Folders and Defaults

Statuses are turned on **per folder**, not globally. A folder that's "enabled" governs the statuses shown for its direct children — the files and subfolders sitting immediately inside it.

## Two ways to enable a folder

- **Right-click the folder** in the file tree → **Enable statuses for this folder** → pick a status set. Every item starts at that set's [default status](status-sets.md#default-status) — there's no separate "pick a default" step.
- **From Settings**, under **Folder assignments**, use the **Assign a folder** row: start typing a folder path and pick one from the live suggestions (or leave it blank for the vault root), pick a status set, and click **Enable**.

![The "Assign a folder" field suggesting matching vault folders as you type](../assets/folder-autocomplete.png)

Either way, every direct child that doesn't already have a status of its own gets assigned the status set's default. Items that already had a status (from a previous enable/disable cycle) keep it.

## Changing the default later

Right-click an already-enabled folder and choose **Change default status for this folder** — or change it directly from the **Folder assignments** list in Settings. This only affects items that get a status assigned *from now on*; it doesn't retroactively change existing items.

## Disabling a folder

Right-click an enabled folder and choose **Disable statuses for this folder**. The dots disappear, but nothing is deleted — every item's assignment is preserved, so re-enabling the folder (even with a different status set) restores exactly where you left off if you switch back.

## Hide completed

Each folder assignment has its own **Hide completed** toggle — turn it on and any item whose current status is marked [completed](status-sets.md#completed-statuses) disappears from the tree entirely (it's still there, just not shown in the sidebar). Toggle it from the **Folder assignments** list in Settings, or right-click an enabled folder and choose **Hide completed items** / **Show completed items**.

![Folder assignments showing labeled "Inherit to subfolders" and "Hide completed" toggles, next to the color palette](../assets/palette-and-folders.png)

## Nested folders and inheritance

A subfolder with no status configuration of its own **inherits** its nearest enabled ancestor's status set — so enabling `Projects` also puts dots on files inside `Projects/Mobile App` even though `Mobile App` was never explicitly enabled itself.

This inheritance is a per-folder toggle (the labeled **Inherit to subfolders** switch in **Folder assignments**), so you can turn it off for a specific folder if you don't want its configuration to cascade down to subfolders.

A subfolder *can* have its own explicit configuration — different status set, different default — which takes over for its own children, while the subfolder itself (as an item inside its parent) still shows whatever status its parent's configuration gives it.

**Moving an inheriting subfolder is safe.** If you drag or move a subfolder that was only ever inheriting (no config of its own) out from under its enabled ancestor, the plugin snapshots what it was inheriting right before the move and gives the subfolder that same configuration as its own at its new location — so its statuses keep working instead of silently disappearing just because it's no longer under the folder it used to inherit from.

## What actually gets stored

Nothing is written to your notes. Every status set, folder assignment, and per-item status lives in the plugin's own data file (`data.json` inside the plugin folder), keyed by vault-relative path. Renaming or moving a file updates its stored path automatically, so a status assignment survives a rename.
