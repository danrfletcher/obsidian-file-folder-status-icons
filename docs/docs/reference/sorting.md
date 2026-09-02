# Sorting and Grouping

Once a folder has statuses enabled, its direct children automatically **group by status** — items sharing a status cluster together, in the order statuses appear within their status set (see [Status Sets and Colors](status-sets.md)). Within a group, items are sorted alphabetically.

## It's live

Change an item's status by clicking its dot, and the tree re-sorts immediately — the item moves to sit with everything else sharing its new status. There's no manual "re-sort" step.

## It persists

The grouped order isn't recomputed from scratch and forgotten — it's tied to the same status data that's saved in the plugin's data file, so closing and reopening Obsidian (or restarting your machine) shows your folders exactly as you left them.

## Scope

Grouping only applies to a folder's **direct children** — files and subfolders sitting immediately inside it. A subfolder's own contents group according to whichever configuration governs *that* subfolder (its own, or an inherited one — see [Assigning Folders and Defaults](folders.md)), independently of its parent.

## Items without a status

If a folder is enabled but a specific item somehow has no resolvable status (rare — usually only during a mid-edit state), it sorts to the end of the group, after every status-bearing item.
