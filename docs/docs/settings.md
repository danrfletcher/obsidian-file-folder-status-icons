# Settings Reference

Everything lives under **Settings → File and Folder Status Icons**.

![The full settings tab: status sets, and folder assignments](assets/settings.png)

## Status sets

- **New status set** — creates an empty status set; give it a name in the text field next to its heading.
- Each status row has a **color swatch** (click to open the color picker), a **label** text field, **up/down** arrows to reorder it within the set, and a **trash icon** to remove it.
- **Add status** — appends a new status (defaults to a plain gray) to the set.
- The **trash icon** next to a status set's name deletes the whole set, and disables statuses for any folder that was using it.

See [Status Sets and Colors](reference/status-sets.md) for the full behavior.

## Folder assignments

Lists every folder that currently has statuses turned on:

- The folder's **path** (`/` for the vault root) and which **status set** governs it.
- A **dropdown** to change its default status.
- A **toggle** for whether its configuration is inherited by subfolders that don't have their own (on by default).
- A **trash icon** to disable statuses for that folder (assignments are preserved, not deleted).

## Assign a folder

A quick way to enable statuses for a folder without leaving Settings or hunting for it in the file tree:

- **Path field** — type a vault-relative folder path, or leave it blank for the vault root.
- **Status set dropdown** — which set to use.
- **Enable** — turns statuses on for that folder, using the status set's first status as the default.

See [Assigning Folders and Defaults](reference/folders.md) for everything this does under the hood.
