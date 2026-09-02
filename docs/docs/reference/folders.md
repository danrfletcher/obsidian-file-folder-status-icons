# Assigning Folders and Defaults

Statuses are turned on **per folder**, not globally. A folder that's "enabled" governs the statuses shown for its direct children — the files and subfolders sitting immediately inside it.

## Two ways to enable a folder

- **Right-click the folder** in the file tree → **Enable statuses for this folder** → pick a status set → pick a default status.
- **From Settings**, under **Folder assignments**, use the **Assign a folder** row: type a folder path (or leave it blank for the vault root), pick a status set, and click **Enable**.

Either way, every direct child that doesn't already have a status of its own gets assigned the **default status** you picked. Items that already had a status (from a previous enable/disable cycle) keep it.

## Changing the default later

Right-click an already-enabled folder and choose **Change default status for this folder** — or change it directly from the **Folder assignments** list in Settings. This only affects items that get a status assigned *from now on*; it doesn't retroactively change existing items.

## Disabling a folder

Right-click an enabled folder and choose **Disable statuses for this folder**. The dots disappear, but nothing is deleted — every item's assignment is preserved, so re-enabling the folder (even with a different status set) restores exactly where you left off if you switch back.

## Nested folders and inheritance

A subfolder with no status configuration of its own **inherits** its nearest enabled ancestor's status set — so enabling `Projects` also puts dots on files inside `Projects/Mobile App` even though `Mobile App` was never explicitly enabled itself.

This inheritance is a per-folder toggle (**Folder assignments** in Settings), so you can turn it off for a specific folder if you don't want its configuration to cascade down to subfolders.

A subfolder *can* have its own explicit configuration — different status set, different default — which takes over for its own children, while the subfolder itself (as an item inside its parent) still shows whatever status its parent's configuration gives it.

## What actually gets stored

Nothing is written to your notes. Every status set, folder assignment, and per-item status lives in the plugin's own data file (`data.json` inside the plugin folder), keyed by vault-relative path. Renaming or moving a file updates its stored path automatically, so a status assignment survives a rename.
