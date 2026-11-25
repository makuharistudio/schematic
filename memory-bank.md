# Schematic memory bank

Living progress log for the client-side schema designer. Update this file as features land.

## Constraints

- Pure TypeScript + pure CSS. Zero runtime libraries, frameworks, or CDN resources.
- Entry: `index.html`. Modules under `/source/components/`, CSS under `/source/style/`, SVGs under `/source/assets/`.
- TypeScript is compiled locally to `/source/dist/` so `index.html` runs by opening the file (or via a static server). The compiler is a dev tool only and is not shipped as a dependency of the app.
- One schema open at a time. Undo/redo only. Autosave on blur/Enter. File System Access API for last-opened handle when the browser allows it.
- Visual language: dense terminal HUD. Monospace, square corners, thin borders, no shadows. Themes: light, dark, Blue Horizon, high-contrast terminal green / blue / orange.

## JSON schemas (locked)

### Schema file — `schematic.schema.json` (`kind: "schematic.schema"`, `version: 1`)

```json
{
  "kind": "schematic.schema",
  "version": 1,
  "meta": { "name": "untitled", "comment": "", "updatedAt": "" },
  "entities": [
    {
      "id": "ent_…",
      "typeId": "table",
      "name": "users",
      "position": { "x": 80, "y": 80 },
      "collapsed": false,
      "comment": "",
      "color": "",
      "columns": [
        {
          "id": "col_…",
          "name": "id",
          "dataTypeId": "pg_int8",
          "key": "P",
          "nullable": false,
          "comment": "",
          "defaultValue": "",
          "unique": false,
          "nested": null
        }
      ],
      "indexes": [
        { "id": "idx_…", "name": "users_email_idx", "unique": true, "columnIds": ["col_…"], "comment": "" }
      ],
      "constraints": [
        { "id": "cst_…", "name": "users_email_chk", "kind": "check", "expression": "", "columnIds": [], "comment": "" }
      ]
    }
  ],
  "relations": [
    {
      "id": "rel_…",
      "sourceEntityId": "ent_…",
      "sourceColumnId": "col_…",
      "targetEntityId": "ent_…",
      "targetColumnId": "col_…",
      "cardinality": "only-one",
      "onDelete": "",
      "onUpdate": "",
      "comment": "",
      "routing": { "points": [], "manual": false }
    }
  ],
  "enums": [
    { "id": "enm_…", "name": "status", "values": ["active", "disabled"], "comment": "" }
  ]
}
```

Nested field (`nested`) is `null` for a scalar, or:

```json
{ "kind": "object", "fields": [ /* same shape as columns, recursive */ ] }
{ "kind": "array", "of": { /* nested node or null for scalar element */ }, "comment": "" }
```

`key` is `"P" | "F" | null`. Cardinality is `"zero-or-one" | "zero-or-many" | "only-one" | "one-or-many"`. Source side is the key/parent side; target side is the foreign-key side.

### Settings file — `schematic.settings.json` (`kind: "schematic.settings"`, `version: 1`)

```json
{
  "kind": "schematic.settings",
  "version": 1,
  "databases": [{ "id": "postgresql", "name": "PostgreSQL" }],
  "primitives": ["string", "number", "integer", "boolean", "binary", "datetime", "json", "uuid", "enum", "other"],
  "dataTypes": [
    { "id": "pg_int8", "name": "int8", "primitive": "integer", "maxByteSize": 8, "databaseId": "postgresql" }
  ],
  "entityTypes": [
    { "id": "table", "name": "Table", "plural": "Tables" }
  ],
  "ui": {
    "fontSize": 11,
    "theme": "dark",
    "zoomSensitivity": 1,
    "panSensitivity": 1,
    "edgeRouting": "orthogonal",
    "showMinimap": true
  }
}
```

`theme` is `"light" | "dark" | "horizon" | "hc-green" | "hc-blue" | "hc-orange"`. Older files may still say `"hc"`; that loads as `hc-green`. `edgeRouting` is `"straight" | "orthogonal" | "curved"`. `ui.language` is a language id, default `en-US`.

## Languages

UI strings live in `source/assets/languages.json`. English (US) is complete. Other language objects may be empty.

Whenever UI strings are added or changed, update languages.json so every shipped language has a complete entry for that key. English (US) is the fallback, so a missing English key shows the raw key. Then regenerate `source/components/catalog.ts` from that file so the embedded catalog matches. The page embeds the catalog so language switching does not depend on a fetch. Shipped languages: English (US), English (UK), Español, Français, Deutsch, 简体中文, 日本語.

Status text is stored as a language key (`statusKey` / `statusVars`) and resolved in `renderChrome`. Do not assign an already-translated string to the status bar, or a later language switch will leave that item in the old language. The third bottom-left status item is `#stat-mode`.

Missing keys fall back to English, then to the key itself. The selector shows “English (US)” and “En”.

## Feature checklist

- [x] Lock schema + settings JSON shapes
- [x] Default settings catalog (PostgreSQL types, databases, entity types)
- [x] Document store + undo/redo
- [x] File new / load / save / autosave / last handle
- [x] Themes, density, status bar
- [x] Canvas pan / zoom / drag entities / minimap / fit
- [x] Entity nodes (inline edit, key cycle, nullable, type dropdown, collapse, add column)
- [x] Key-pair and nullable warnings
- [x] Detail dialog (comments, indexes, constraints, enums, nested structures, delete columns)
- [x] Crow’s-foot SVG marks + create-relation gesture
- [x] Orthogonal / straight / curved routing to column rows
- [x] Context menus (canvas, entity, column, relation)
- [x] Settings page
- [x] Export JSON + export as prompt
- [x] Keyboard shortcuts
- [x] Browser verification (headless Chromium: load sample, rename, relate, menu, detail, undo, themes)

## Verification notes (2026-11-25)

- Served at `http://127.0.0.1:8753/` and driven with headless Chromium DevTools.
- Sample `samples/orders.schematic.json` loads two tables, two relations, nested jsonb, an index, a check, and an enum.
- Warnings: invalid key pair paints both key cells; nullable `F` paints the `n` cell.
- Click-to-rename commits on Enter. Cardinality button then two column clicks creates a relation and sets P/F.
- Canvas context menu lists entity types. Detail dialog columns tab edits keys, types, and nested kind.
- Undo removed a table added from the menu and restored the previous entity count.
- Light, dark, and high-contrast themes render. Fit, minimap, and status zoom update.
- The top menu and status bar stay on one row when the items fit. They wrap only when the row is too narrow. The left cluster stays first; the right cluster stays right-aligned and can wrap underneath. No horizontal scrollbar.

## Decisions

- 2026-11-25: Ship compiled JS next to sources so opening `index.html` works without a bundler. No runtime dependency.
- 2026-11-25: Crow’s-foot marks are original SVGs modelled on the public geometry of erd-editor’s MIT-licensed notation icons (circle + bars + fork). No lucide assets copied.
- 2026-11-25: IndexedDB stores the File System Access handle. Settings live in localStorage and can also be exported as the settings JSON file.
- 2026-11-25: Relation cardinality is the notation drawn at the target (FK) end. The source (PK) end is drawn as a single bar.

## Session notes

- Workspace was empty at start.
- Chromium is available for verification. Node is being fetched as a local compiler only.
