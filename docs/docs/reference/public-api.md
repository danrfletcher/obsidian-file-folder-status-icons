# Public API (for plugin developers)

Status Sets exposes a small read-only API for other plugins to build on top
of its status sets, rather than storing their own copy or reimplementing the
status-change popup.

!!! warning "Unstable"
    This is a young, hand-rolled contract — no semver package, no
    deprecation window. It exists specifically to support the companion
    [Checklist Status Icons](https://danrfletcher.github.io/obsidian-checklist-status-icons/)
    plugin. Check `apiVersion` if you need to guard against future breaking
    changes, and expect it to grow rather than shrink.

## Reaching it

```ts
const statusSets = app.plugins.plugins["file-folder-status-icons"]?.api;
if (!statusSets) {
    // Not installed, not enabled, or predates this API — handle gracefully.
    return;
}
```

Always optional-chain and check for `undefined`.

## Surface

```ts
interface PublicApi {
    readonly apiVersion: 1;

    getStatusSets(): StatusSet[];
    getStatusSet(id: string): StatusSet | undefined;

    isGlowEnabled(): boolean;

    onChange(callback: () => void): () => void;

    openStatusPopup(opts: {
        anchor: HTMLElement;
        statusSet: StatusSet;
        currentStatusId: string;
        onSelect: (status: StatusDefinition) => void;
    }): void;
}
```

- **`getStatusSets` / `getStatusSet`** return snapshot copies — mutating the
  returned objects has no effect on Status Sets' own data. Status sets are
  never created, edited, or duplicated by a consumer; Status Sets owns that
  data exclusively.
- **`isGlowEnabled`** reflects the Design → Glow toggle, so a consumer's own
  status icons can inherit it rather than exposing a second toggle.
- **`onChange`** fires (no payload) whenever anything changes — a status
  edited, a set renamed, Glow toggled, etc. Re-read whatever you need via the
  getters above. Returns an unsubscribe function; call it from your plugin's
  `onunload`.
- **`openStatusPopup`** opens the exact same status-change popup component
  used internally, anchored to any `HTMLElement`, so a consumer's UI stays
  visually and behaviorally in sync with this plugin automatically.

## What this API deliberately doesn't do

- No write access. Status sets are read-only from the outside.
- No access to folder configs or item statuses — those are this plugin's own
  file-tree feature, not a general-purpose store.
