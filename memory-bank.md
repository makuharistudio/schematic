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
  ],
  "activeLayout": "Custom",
  "layouts": {
    "Custom": { "positions": { "ent_…": { "x": 80, "y": 80 } } },
    "Hierarchical": { "positions": {} },
    "ForceDirected": { "positions": {} },
    "Circular": { "positions": {} }
  }
}
```

`activeLayout` is `"Custom" | "Hierarchical" | "ForceDirected" | "Circular"`. Older files omit `layouts`; the loader fills four empty maps and copies live `entity.position` into Custom. Only entity x/y is stored per layout. Relation routing stays on the relation. The live `entity.position` always matches the active layout, so render, hit testing, and fit keep reading it.

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
    "showMinimap": true,
    "showGrid": true,
    "snapToGrid": false
  }
}
```

`theme` is `"light" | "dark" | "horizon" | "hc-green" | "hc-blue" | "hc-orange"`. Older files may still say `"hc"`; that loads as `hc-green`. `edgeRouting` is `"straight" | "orthogonal" | "curved"`. `ui.language` is a language id, default `en-US`. `showGrid` defaults to true. `snapToGrid` defaults to false. Missing booleans load from the built-in defaults, so older settings files keep the grid visible and snap off.

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
- 2026-11-26: Grid and Snap sit immediately left of Select. Grid defaults on and hides the background lines. Snap defaults off. While Snap is on, a dragged entity follows the 32px grid during the drag. Turning Snap on does not move entities already on the canvas. Both preferences persist in `ui.showGrid` and `ui.snapToGrid`.
- The top-menu right cluster uses `flex: 0 0 auto`, so it stays on the first row until the row cannot hold it, then wraps as a group. The status bar cluster still uses `flex: 0 1 auto`.
- 2026-11-26: Layout dropdown and Reset sit immediately before Undo and Redo, inside the left cluster. Order is Layout, Reset, Undo, Redo. Custom is the default and disables Reset. Hierarchical, Force-directed, and Circular generate positions the first time they are selected and keep those positions across switches. Drag and the detail x/y fields write only the active layout. Reset re-runs that algorithm and is one undo entry. Switches made after a reset, before any other edit, are not separate history entries, so Undo returns to the layout that was reset and restores the pre-reset positions. Redo puts the reset back. Selected relations use `--rel-select` for the line and the crow’s-foot marks; unselected relations use `--rel`. Those two tokens differ in every theme.
- The top bar is two clusters. The left cluster grows and wraps its own buttons when the row is short. The right cluster stays `flex: 0 0 auto` and drops to the next row as a group. At 1400px the bar is one row. At 720px and 480px it is two rows and the page does not scroll sideways.
- 2026-11-26: The SCHEMATIC label uses `flex: 0 0 max-content` so it stays the width of the word and sits on the same row as New. `flex-basis: auto` was resolving against the wrapping cluster and claiming the whole row.

## Decisions

- 2026-11-25: Ship compiled JS next to sources so opening `index.html` works without a bundler. No runtime dependency.
- 2026-11-25: Crow’s-foot marks are original SVGs modelled on the public geometry of erd-editor’s MIT-licensed notation icons (circle + bars + fork). No lucide assets copied.
- 2026-11-25: IndexedDB stores the File System Access handle. Settings live in localStorage and can also be exported as the settings JSON file.
- 2026-11-25: Relation cardinality is the notation drawn at the target (FK) end. The source (PK) end is drawn as a single bar.
- 2026-11-26: Grid and snap share the canvas grid step of 32. Snap is applied while dragging, from each entity's position at pointer-down, so an entity that was off-grid stays there until the user moves it.
- 2026-11-26: Four layouts. Custom is free placement. Hierarchical is a left-to-right layered tree (roots have no incoming relation; cycles get a leftover pass). Force-directed is repulsion plus attraction for a fixed 90 steps, with an extra push when boxes overlap. Circular places each connected component on a ring sized so the chord clears the tallest box. After each algorithmic layout, a separation pass enforces a 28px gap. Layered mode keeps column x. Radial mode pushes along the ring. Free mode is the fallback. Custom is not separated. Algorithms live in `source/components/layout.ts`. No runtime library.
- 2026-11-26: Relation selection color is `--rel-select`, never `--ink` and never equal to `--rel`. Light uses burnt orange on a pale canvas; dark and Blue Horizon use amber; high-contrast green and blue use yellow; high-contrast orange uses white.

## Session notes

- Workspace was empty at start.
- Chromium is available for verification. Node is being fetched as a local compiler only.
