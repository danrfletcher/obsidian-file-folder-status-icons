# Status Sets and Colors

A **status set** is a named, ordered list of statuses. Each status has:

- A **label** — the text shown in the change-status popup and as the dot's tooltip.
- A **color** — any color, picked via a native color picker.

You can have as many status sets as you want, and reuse the same one across multiple folders, or give different folders their own. A `Client Work` folder might use *Red / Amber / Green*, while a `Reading List` folder next to it uses *To Read / Reading / Done* — they don't have to match.

## Order matters

The order statuses appear in within a set is also the **sort rank** used when a folder groups its contents by status (see [Sorting and Grouping](sorting.md)) — the first status sorts first, the last sorts last. Use the up/down arrows next to each status in Settings to reorder them.

A common pattern is ordering from "not started" to "done", so a folder's contents naturally read left-to-right, top-to-bottom as a progression.

## Editing statuses

From **Settings → File and Folder Status Icons**, each status set shows every status as a row with its color swatch and label, editable in place:

- **Add status** appends a new one to the end.
- The **up/down arrows** reorder a status within its set.
- The **trash icon** removes a status. Any folder defaulting to a removed status falls back to whatever is now first in the set.
- Renaming a status or changing its color updates every dot currently showing that status immediately.

## Deleting a status set

Deleting a status set (via the trash icon next to its name) also disables statuses for any folder that was using it — those folders stop showing dots, but existing per-item assignments aren't deleted, so assigning a new status set to the same folder later doesn't start you from scratch.

## Next

See [Assigning Folders and Defaults](folders.md) for how a status set actually gets applied to your file tree.
