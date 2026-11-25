import { defaultSettings, emptySchema, makeEntity, makeField } from "./defaults.js";
import { catalog } from "./catalog.js";
import { applyLanguage, currentLanguage, installLanguages, languageChoices, loadLanguages, onLanguageChange, t } from "./i18n.js";
import { ensurePermission, downloadText, pickOpen, pickSave, readHandle, recallHandle, rememberHandle, schemaFileName, serialize, settingsFileName, writeHandle } from "./files.js";
import { anchorsFor, cardinalityMark, entityHeight, hitDistance, NODE_W, outward, pointsToPath, routePath, rowCenterY, ROW_H, HEADER_H } from "./geometry.js";
import { History } from "./history.js";
import { clone, uid } from "./ids.js";
import { schemaToPrompt } from "./prompt.js";
import { CARDINALITIES, CARDINALITY_LABEL, CONSTRAINT_KINDS } from "./types.js";
import type { Cardinality, ConstraintKind, EdgeRouting, Entity, Field, NestedNode, Relation, SchemaDoc, SettingsDoc, ThemeId } from "./types.js";
import { parseSchema, parseSettings, FormatError } from "./validate.js";
import { columnKey, computeWarnings } from "./warnings.js";

const SETTINGS_KEY = "schematic.settings.v1";
const VIEW_KEY = "schematic.view.v1";

type Tool = "select" | Cardinality;
type MenuItem = { id: string; label: string; hint?: string; danger?: boolean } | { sep: true } | { label: string };

interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

interface DragEntity {
  kind: "entity";
  ids: string[];
  origin: Map<string, { x: number; y: number }>;
  px: number;
  py: number;
  before: SchemaDoc;
  moved: boolean;
  edit: null | { kind: "entity" | "column" | "type"; entityId: string; columnId?: string };
}

interface DragPan {
  kind: "pan";
  px: number;
  py: number;
  ox: number;
  oy: number;
}

type Drag = DragEntity | DragPan | null;

interface TouchPoint {
  x: number;
  y: number;
}

interface PinchState {
  startDist: number;
  startZoom: number;
  cx: number;
  cy: number;
}

const app = {
  doc: emptySchema(),
  settings: defaultSettings(),
  history: new History(),
  handle: null as FileSystemFileHandle | null,
  fileLabel: "untitled.schematic.json",
  dirty: false,
  view: { x: 40, y: 40, zoom: 1 } as ViewState,
  selected: new Set<string>(),
  selectedRel: null as string | null,
  tool: "select" as Tool,
  relSource: null as { entityId: string; columnId: string } | null,
  drag: null as Drag,
  space: false,
  statusKey: "status.ready",
  statusVars: {} as Record<string, string | number>,
  toast: "",
  toastTimer: 0,
  pointers: new Map<number, TouchPoint>(),
  pinch: null as PinchState | null,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function boot(): void {
  installLanguages(catalog);
  loadSettings();
  loadView();
  applyLanguage(app.settings.ui.language || "en-US");
  onLanguageChange(() => {
    applyTheme();
    applyStaticLabels();
    render();
  });
  applyTheme();
  bindChrome();
  applyStaticLabels();
  render();
  void loadLanguages("source/assets/languages.json").then(() => {
    applyLanguage(app.settings.ui.language || "en-US");
  }).catch(() => {
    /* The embedded catalog already covers every shipped language. */
  });
  void restoreLastFile();
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", () => renderCanvas());
  document.addEventListener("pointerdown", (ev) => {
    const menu = $("menu");
    if (!menu.classList.contains("hidden") && !menu.contains(ev.target as Node)) hideMenu();
  });
}

function loadSettings(): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) app.settings = parseSettings(JSON.parse(raw), defaultSettings());
  } catch {
    app.settings = defaultSettings();
  }
}

function saveSettings(): void {
  localStorage.setItem(SETTINGS_KEY, serialize(app.settings));
  applyTheme();
  render();
  scheduleAutosave();
}

function loadView(): void {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return;
    const view = JSON.parse(raw) as ViewState;
    if (typeof view.x === "number") app.view = view;
  } catch {
    /* ignore */
  }
}

function saveView(): void {
  localStorage.setItem(VIEW_KEY, JSON.stringify(app.view));
}

function applyTheme(): void {
  document.documentElement.dataset.theme = app.settings.ui.theme;
  document.documentElement.style.setProperty("--fs", `${app.settings.ui.fontSize}px`);
  document.documentElement.lang = currentLanguage();
}

function applyStaticLabels(): void {
  document.title = t("brand");
  $("brand").textContent = t("brand");
  labelButton("btn-new", "action.new");
  labelButton("btn-load", "action.load");
  labelButton("btn-save", "action.save");
  labelButton("btn-save-as", "action.saveAs");
  labelButton("btn-export", "action.exportJson");
  labelButton("btn-prompt", "action.exportPrompt");
  labelButton("btn-undo", "action.undo");
  labelButton("btn-redo", "action.redo");
  labelButton("btn-select", "action.select");
  labelButton("btn-fit", "action.fit");
  labelButton("btn-minimap", "action.map");
  $("btn-settings").title = t("action.settings");
  $("btn-settings").setAttribute("aria-label", t("action.settings"));
  $("btn-zoom-out").title = t("zoom.out");
  $("btn-zoom-in").title = t("zoom.in");
  $("btn-fit").title = t("zoom.fit");
  $("btn-minimap").title = t("zoom.minimap");
  $("card-zero-or-one").title = t("card.zeroOrOne");
  $("card-zero-or-many").title = t("card.zeroOrMany");
  $("card-only-one").title = t("card.onlyOne");
  $("card-one-or-many").title = t("card.oneOrMany");
  $("zoom-input").setAttribute("aria-label", t("zoom.in"));
  $("stat-help").textContent = t("status.help");
  $("minimap").title = t("field.minimap");
}

function labelButton(id: string, key: string): void {
  const button = $(id);
  if (button.querySelector("svg")) return;
  button.textContent = t(key);
}

function displayName(kind: "db" | "entity" | "entityPlural", id: string, fallback: string): string {
  const key = kind === "db" ? `db.${id}` : kind === "entity" ? `entity.${id}` : `entity.${id}.plural`;
  const value = t(key);
  return value === key ? fallback : value;
}

function bindChrome(): void {
  $("btn-new").onclick = () => void newSchema();
  $("btn-load").onclick = () => void loadSchema();
  $("btn-save").onclick = () => void saveSchema(false);
  $("btn-save-as").onclick = () => void saveSchema(true);
  $("btn-export").onclick = () => exportJson();
  $("btn-prompt").onclick = () => openPrompt();
  $("btn-undo").onclick = () => undo();
  $("btn-redo").onclick = () => redo();
  $("btn-settings").onclick = () => openSettings();
  $("btn-fit").onclick = () => fit();
  $("btn-zoom-out").onclick = () => setZoom(app.view.zoom / 1.1);
  $("btn-zoom-in").onclick = () => setZoom(app.view.zoom * 1.1);
  const zoomInput = $<HTMLInputElement>("zoom-input");
  zoomInput.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") {
      applyZoomInput();
      zoomInput.blur();
    }
  });
  zoomInput.addEventListener("blur", () => applyZoomInput());
  zoomInput.addEventListener("focus", () => zoomInput.select());
  $("btn-minimap").onclick = () => {
    app.settings.ui.showMinimap = !app.settings.ui.showMinimap;
    saveSettings();
  };
  for (const card of CARDINALITIES) {
    $(`card-${card}`).onclick = () => armRelation(card);
  }
  $("btn-select").onclick = () => {
    app.tool = "select";
    app.relSource = null;
    setStatus("status.select");
    renderChrome();
  };
  const stage = $("stage");
  stage.addEventListener("pointerdown", (ev) => {
    trackPointer(ev);
    onPointerDown(ev);
  });
  stage.addEventListener("pointermove", (ev) => {
    trackPointer(ev);
    onPointerMove(ev);
  });
  stage.addEventListener("pointerup", (ev) => {
    onPointerUp(ev);
    forgetPointer(ev);
  });
  stage.addEventListener("pointercancel", (ev) => {
    onPointerUp(ev);
    forgetPointer(ev);
  });
  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("contextmenu", onContextMenu);
  stage.addEventListener("dblclick", onDblClick);
  $("minimap").addEventListener("pointerdown", onMinimapDown);
}

function applyZoomInput(): void {
  const raw = $<HTMLInputElement>("zoom-input").value.replace("%", "").trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    renderChrome();
    return;
  }
  setZoom(n / 100);
}

function setZoom(next: number, cx?: number, cy?: number): void {
  const zoom = Math.min(2.8, Math.max(0.25, next));
  const stage = $("stage");
  const rect = stage.getBoundingClientRect();
  const sx = cx ?? rect.width / 2;
  const sy = cy ?? rect.height / 2;
  const wx = (sx - app.view.x) / app.view.zoom;
  const wy = (sy - app.view.y) / app.view.zoom;
  app.view.zoom = zoom;
  app.view.x = sx - wx * zoom;
  app.view.y = sy - wy * zoom;
  saveView();
  renderCanvas();
  renderChrome();
}

function worldFromEvent(ev: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = $("stage").getBoundingClientRect();
  return {
    x: (ev.clientX - rect.left - app.view.x) / app.view.zoom,
    y: (ev.clientY - rect.top - app.view.y) / app.view.zoom,
  };
}

function findHit(x: number, y: number): { kind: "column" | "header" | "add" | "info" | "collapse" | "key" | "null" | "entity"; entityId: string; columnId?: string } | { kind: "relation"; id: string } | null {
  for (let i = app.doc.entities.length - 1; i >= 0; i -= 1) {
    const entity = app.doc.entities[i];
    const h = entityHeight(entity.collapsed, entity.columns.length);
    if (x < entity.position.x || y < entity.position.y || x > entity.position.x + NODE_W || y > entity.position.y + h) continue;
    const localY = y - entity.position.y;
    const localX = x - entity.position.x;
    if (localY < HEADER_H) {
      if (localX > NODE_W - 16) return { kind: "info", entityId: entity.id };
      if (localX > NODE_W - 32) return { kind: "collapse", entityId: entity.id };
      return { kind: "header", entityId: entity.id };
    }
    if (entity.collapsed) return { kind: "entity", entityId: entity.id };
    const row = Math.floor((localY - HEADER_H) / ROW_H);
    if (row >= entity.columns.length) return { kind: "add", entityId: entity.id };
    const column = entity.columns[row];
    if (localX < 16) return { kind: "key", entityId: entity.id, columnId: column.id };
    if (localX > NODE_W - 16) return { kind: "null", entityId: entity.id, columnId: column.id };
    return { kind: "column", entityId: entity.id, columnId: column.id };
  }
  let best: { id: string; d: number } | null = null;
  for (const relation of app.doc.relations) {
    const points = relationPoints(relation);
    const d = hitDistance(points, x, y);
    if (d < 8 && (!best || d < best.d)) best = { id: relation.id, d };
  }
  return best ? { kind: "relation", id: best.id } : null;
}

function relationPoints(relation: Relation) {
  const source = app.doc.entities.find((e) => e.id === relation.sourceEntityId);
  const target = app.doc.entities.find((e) => e.id === relation.targetEntityId);
  if (!source || !target) return [];
  const sIdx = Math.max(0, source.columns.findIndex((c) => c.id === relation.sourceColumnId));
  const tIdx = Math.max(0, target.columns.findIndex((c) => c.id === relation.targetColumnId));
  const lane = app.doc.relations.findIndex((r) => r.id === relation.id) % 5 - 2;
  const pair = anchorsFor(
    { x: source.position.x, y: source.position.y, w: NODE_W, h: entityHeight(source.collapsed, source.columns.length) },
    rowCenterY(source.position.y, source.collapsed, sIdx),
    { x: target.position.x, y: target.position.y, w: NODE_W, h: entityHeight(target.collapsed, target.columns.length) },
    rowCenterY(target.position.y, target.collapsed, tIdx),
  );
  if (relation.routing.manual && relation.routing.points.length >= 2) return relation.routing.points;
  return routePath({ ...pair, style: app.settings.ui.edgeRouting, lane });
}

function trackPointer(ev: PointerEvent): void {
  if (ev.pointerType === "mouse" && ev.buttons === 0 && ev.type === "pointermove") return;
  app.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (app.pointers.size >= 2) beginOrUpdatePinch();
}

function forgetPointer(ev: PointerEvent): void {
  app.pointers.delete(ev.pointerId);
  if (app.pointers.size < 2) app.pinch = null;
}

function beginOrUpdatePinch(): void {
  const pts = [...app.pointers.values()];
  if (pts.length < 2) return;
  const [a, b] = pts;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  const rect = $("stage").getBoundingClientRect();
  const cx = (a.x + b.x) / 2 - rect.left;
  const cy = (a.y + b.y) / 2 - rect.top;
  if (!app.pinch) {
    app.pinch = { startDist: Math.max(dist, 8), startZoom: app.view.zoom, cx, cy };
    app.drag = null;
    return;
  }
  if (dist < 8) return;
  const factor = dist / app.pinch.startDist;
  setZoom(app.pinch.startZoom * factor, cx, cy);
  app.pinch.cx = cx;
  app.pinch.cy = cy;
}

function onPointerDown(ev: PointerEvent): void {
  if (ev.button === 2) return;
  if (app.pointers.size >= 2 || app.pinch) return;
  hideMenu();
  const world = worldFromEvent(ev);
  const hit = findHit(world.x, world.y);
  const stage = $("stage");
  if (ev.button === 1 || app.space || (!hit && ev.button === 0)) {
    app.drag = { kind: "pan", px: ev.clientX, py: ev.clientY, ox: app.view.x, oy: app.view.y };
    stage.setPointerCapture(ev.pointerId);
    stage.classList.add("panning");
    return;
  }
  if (!hit || hit.kind === "relation") {
    if (hit && hit.kind === "relation") {
      app.selectedRel = hit.id;
      app.selected.clear();
      setStatus("status.relationId", { id: hit.id });
    } else {
      app.selected.clear();
      app.selectedRel = null;
    }
    render();
    return;
  }
  if (app.tool !== "select" && (hit.kind === "column" || hit.kind === "key" || hit.kind === "null")) {
    pickRelationEnd(hit.entityId, hit.columnId!);
    return;
  }
  if (hit.kind === "info") {
    openDetail(hit.entityId);
    return;
  }
  if (hit.kind === "collapse") {
    mutate((doc) => {
      const entity = doc.entities.find((e) => e.id === hit.entityId);
      if (entity) entity.collapsed = !entity.collapsed;
    });
    return;
  }
  if (hit.kind === "add") {
    mutate((doc) => {
      const entity = doc.entities.find((e) => e.id === hit.entityId);
      if (!entity) return;
      const typeId = app.settings.dataTypes[0]?.id ?? "";
      entity.columns.push(makeField(typeId, `col_${entity.columns.length + 1}`));
    });
    return;
  }
  if (hit.kind === "key" && hit.columnId) {
    mutate((doc) => {
      const entity = doc.entities.find((e) => e.id === hit.entityId);
      const column = entity?.columns.find((c) => c.id === hit.columnId);
      if (!column) return;
      column.key = column.key === null ? "P" : column.key === "P" ? "F" : null;
      if (column.key === "P") column.nullable = false;
    });
    return;
  }
  if (hit.kind === "null" && hit.columnId) {
    mutate((doc) => {
      const entity = doc.entities.find((e) => e.id === hit.entityId);
      const column = entity?.columns.find((c) => c.id === hit.columnId);
      if (column) column.nullable = !column.nullable;
    });
    return;
  }
  if (!ev.shiftKey) {
    app.selected.clear();
    app.selectedRel = null;
  }
  app.selected.add(hit.entityId);
  const before = clone(app.doc);
  const origin = new Map<string, { x: number; y: number }>();
  for (const id of app.selected) {
    const entity = app.doc.entities.find((e) => e.id === id);
    if (entity) origin.set(id, { x: entity.position.x, y: entity.position.y });
  }
  let edit: DragEntity["edit"] = null;
  const entity = app.doc.entities.find((e) => e.id === hit.entityId);
  const localX = entity ? world.x - entity.position.x : 0;
  if (hit.kind === "header" && localX > 26 && localX < NODE_W - 34) edit = { kind: "entity", entityId: hit.entityId };
  if (hit.kind === "column" && hit.columnId && localX >= 16 && localX < NODE_W - 92) {
    edit = { kind: "column", entityId: hit.entityId, columnId: hit.columnId };
  }
  if (hit.kind === "column" && hit.columnId && localX >= NODE_W - 92 && localX < NODE_W - 16) {
    edit = { kind: "type", entityId: hit.entityId, columnId: hit.columnId };
  }
  app.drag = { kind: "entity", ids: [...app.selected], origin, px: world.x, py: world.y, before, moved: false, edit };
  stage.setPointerCapture(ev.pointerId);
  render();
}

function onPointerMove(ev: PointerEvent): void {
  if (app.pinch || app.pointers.size >= 2) return;
  if (!app.drag) return;
  if (app.drag.kind === "pan") {
    const sens = app.settings.ui.panSensitivity;
    app.view.x = app.drag.ox + (ev.clientX - app.drag.px) * sens;
    app.view.y = app.drag.oy + (ev.clientY - app.drag.py) * sens;
    renderCanvas();
    return;
  }
  const world = worldFromEvent(ev);
  const dx = world.x - app.drag.px;
  const dy = world.y - app.drag.py;
  if (Math.hypot(dx, dy) > 1) app.drag.moved = true;
  for (const id of app.drag.ids) {
    const entity = app.doc.entities.find((e) => e.id === id);
    const origin = app.drag.origin.get(id);
    if (!entity || !origin) continue;
    entity.position.x = origin.x + dx;
    entity.position.y = origin.y + dy;
  }
  renderCanvas();
}

function onPointerUp(ev: PointerEvent): void {
  if (app.pinch) return;
  const stage = $("stage");
  if (stage.hasPointerCapture(ev.pointerId)) stage.releasePointerCapture(ev.pointerId);
  stage.classList.remove("panning");
  if (app.drag?.kind === "entity" && app.drag.moved) {
    app.history.pushBefore(app.drag.before);
    markDirty();
  } else if (app.drag?.kind === "entity" && app.drag.edit) {
    const edit = app.drag.edit;
    if (edit.kind === "type" && edit.columnId) openTypeEditor(edit.entityId, edit.columnId);
    else openNameEditor(edit.kind === "column" ? "column" : "entity", edit.entityId, edit.columnId);
  }
  if (app.drag?.kind === "pan") saveView();
  app.drag = null;
  renderChrome();
}

function onWheel(ev: WheelEvent): void {
  ev.preventDefault();
  const rect = $("stage").getBoundingClientRect();
  const factor = Math.exp(-ev.deltaY * 0.0012 * app.settings.ui.zoomSensitivity);
  setZoom(app.view.zoom * factor, ev.clientX - rect.left, ev.clientY - rect.top);
}

function onDblClick(ev: MouseEvent): void {
  const world = worldFromEvent(ev);
  const hit = findHit(world.x, world.y);
  if (hit && "entityId" in hit) openDetail(hit.entityId);
}

function onContextMenu(ev: MouseEvent): void {
  ev.preventDefault();
  const world = worldFromEvent(ev);
  const hit = findHit(world.x, world.y);
  const items: MenuItem[] = [];
  if (!hit) {
    items.push({ label: t("menu.canvas") });
    for (const type of app.settings.entityTypes) {
      items.push({ id: `add:${type.id}`, label: t("menu.addType", { type: displayName("entity", type.id, type.name) }) });
    }
    items.push({ sep: true });
    items.push({ id: "fit", label: t("menu.fit"), hint: "F" });
    items.push({ id: "select-all", label: t("menu.selectAll"), hint: "A" });
    items.push({ sep: true });
    items.push({ id: "paste-json", label: t("menu.load") });
  } else if (hit.kind === "relation") {
    app.selectedRel = hit.id;
    const relation = app.doc.relations.find((r) => r.id === hit.id);
    items.push({ label: t("menu.relation") });
    for (const card of CARDINALITIES) {
      items.push({ id: `rel-card:${card}`, label: t(`card.${card}`), hint: relation?.cardinality === card ? "*" : "" });
    }
    items.push({ sep: true });
    items.push({ id: "rel-delete", label: t("menu.deleteRelation"), danger: true, hint: "Del" });
  } else {
    if (!app.selected.has(hit.entityId)) {
      app.selected.clear();
      app.selected.add(hit.entityId);
    }
    const entity = app.doc.entities.find((e) => e.id === hit.entityId);
    items.push({ label: (entity?.name ?? t("menu.entityFallback")).toUpperCase() });
    items.push({ id: "detail", label: t("menu.openDetail"), hint: "Enter" });
    items.push({ id: "rename", label: t("menu.rename") });
    items.push({ id: "add-col", label: t("menu.addColumn") });
    if (hit.columnId) items.push({ id: "del-col", label: t("menu.deleteColumn"), danger: true });
    items.push({ id: "collapse", label: entity?.collapsed ? t("menu.expand") : t("menu.collapse") });
    items.push({ id: "focus", label: t("menu.focus") });
    items.push({ sep: true });
    items.push({ label: t("menu.relationshipType") });
    for (const card of CARDINALITIES) items.push({ id: `arm:${card}`, label: t(`card.${card}`) });
    items.push({ sep: true });
    items.push({ id: "duplicate", label: t("menu.duplicate") });
    items.push({ id: "delete", label: app.selected.size > 1 ? t("menu.deleteSelected") : t("menu.delete"), danger: true, hint: "Del" });
  }
  showMenu(ev.clientX, ev.clientY, items, (id) => runMenu(id, world, hit));
  renderCanvas();
}

function runMenu(id: string, world: { x: number; y: number }, hit: ReturnType<typeof findHit>): void {
  if (id.startsWith("add:")) {
    const typeId = id.slice(4);
    const type = app.settings.entityTypes.find((t) => t.id === typeId);
    mutate((doc) => {
      const entity = makeEntity(typeId, app.settings.dataTypes[0]?.id ?? "", world, uniqueName(doc, (type?.name ?? "entity").toLowerCase()));
      doc.entities.push(entity);
      app.selected = new Set([entity.id]);
    });
    return;
  }
  if (id === "fit") return fit();
  if (id === "select-all") {
    app.selected = new Set(app.doc.entities.map((e) => e.id));
    render();
    return;
  }
  if (id === "paste-json") return void loadSchema();
  if (id.startsWith("arm:")) return armRelation(id.slice(4) as Cardinality);
  if (id.startsWith("rel-card:") && app.selectedRel) {
    const card = id.slice(9) as Cardinality;
    mutate((doc) => {
      const relation = doc.relations.find((r) => r.id === app.selectedRel);
      if (relation) relation.cardinality = card;
    });
    return;
  }
  if (id === "rel-delete" && app.selectedRel) {
    const relId = app.selectedRel;
    mutate((doc) => {
      doc.relations = doc.relations.filter((r) => r.id !== relId);
    });
    app.selectedRel = null;
    return;
  }
  const entityId = hit && "entityId" in hit ? hit.entityId : [...app.selected][0];
  if (!entityId) return;
  if (id === "detail") return openDetail(entityId);
  if (id === "rename") return openNameEditor("entity", entityId);
  if (id === "add-col") {
    mutate((doc) => {
      const entity = doc.entities.find((e) => e.id === entityId);
      if (entity) entity.columns.push(makeField(app.settings.dataTypes[0]?.id ?? "", `col_${entity.columns.length + 1}`));
    });
    return;
  }
  if (id === "del-col" && hit && "columnId" in hit && hit.columnId) {
    const columnId = hit.columnId;
    mutate((doc) => {
      const entity = doc.entities.find((e) => e.id === entityId);
      if (!entity) return;
      entity.columns = entity.columns.filter((c) => c.id !== columnId);
      doc.relations = doc.relations.filter((r) => r.sourceColumnId !== columnId && r.targetColumnId !== columnId);
    });
    return;
  }
  if (id === "collapse") {
    mutate((doc) => {
      const entity = doc.entities.find((e) => e.id === entityId);
      if (entity) entity.collapsed = !entity.collapsed;
    });
    return;
  }
  if (id === "focus") return focusEntity(entityId);
  if (id === "duplicate") {
    mutate((doc) => {
      const entity = doc.entities.find((e) => e.id === entityId);
      if (!entity) return;
      const copy = clone(entity);
      copy.id = uid("ent");
      copy.name = uniqueName(doc, `${entity.name}_copy`);
      copy.position = { x: entity.position.x + 28, y: entity.position.y + 28 };
      copy.columns = copy.columns.map((c) => ({ ...c, id: uid("col"), nested: remapNested(c.nested) }));
      doc.entities.push(copy);
      app.selected = new Set([copy.id]);
    });
    return;
  }
  if (id === "delete") deleteSelected();
}

function remapNested(node: NestedNode | null): NestedNode | null {
  if (!node) return null;
  if (node.kind === "array") return { kind: "array", of: remapNested(node.of), comment: node.comment };
  return { kind: "object", fields: node.fields.map((f) => ({ ...f, id: uid("col"), nested: remapNested(f.nested) })) };
}

function uniqueName(doc: SchemaDoc, base: string): string {
  const names = new Set(doc.entities.map((e) => e.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

function showMenu(x: number, y: number, items: MenuItem[], onPick: (id: string) => void): void {
  const menu = $("menu");
  menu.innerHTML = "";
  for (const item of items) {
    if ("sep" in item) {
      const sep = document.createElement("div");
      sep.className = "menu-sep";
      menu.append(sep);
      continue;
    }
    if (!("id" in item)) {
      const label = document.createElement("div");
      label.className = "menu-label";
      label.textContent = item.label;
      menu.append(label);
      continue;
    }
    const btn = document.createElement("button");
    btn.className = "menu-item";
    if (item.danger) btn.classList.add("danger");
    btn.type = "button";
    const text = document.createElement("span");
    text.textContent = item.label;
    btn.append(text);
    if (item.hint) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = item.hint;
      btn.append(hint);
    }
    btn.onclick = (ev) => {
      ev.stopPropagation();
      hideMenu();
      onPick(item.id);
    };
    menu.append(btn);
  }
  menu.classList.remove("hidden");
  const pad = 4;
  const w = 220;
  const h = items.length * 20 + 8;
  menu.style.left = `${Math.min(x, window.innerWidth - w - pad)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - h - pad)}px`;
}

function hideMenu(): void {
  $("menu").classList.add("hidden");
}

function armRelation(card: Cardinality): void {
  app.tool = card;
  app.relSource = null;
  setStatus("status.armRelation", { card: `card.${card}` });
  renderChrome();
  showToast(t("toast.relationHint"));
}

function pickRelationEnd(entityId: string, columnId: string): void {
  if (app.tool === "select") return;
  if (!app.relSource) {
    app.relSource = { entityId, columnId };
    setStatus("status.targetColumn");
    render();
    return;
  }
  if (app.relSource.entityId === entityId && app.relSource.columnId === columnId) {
    showToast(t("toast.sameColumn"));
    return;
  }
  const source = app.relSource;
  const card = app.tool;
  mutate((doc) => {
    const sEnt = doc.entities.find((e) => e.id === source.entityId);
    const tEnt = doc.entities.find((e) => e.id === entityId);
    const sCol = sEnt?.columns.find((c) => c.id === source.columnId);
    const tCol = tEnt?.columns.find((c) => c.id === columnId);
    if (sCol && sCol.key !== "P") sCol.key = "P";
    if (sCol) sCol.nullable = false;
    if (tCol) tCol.key = "F";
    doc.relations.push({
      id: uid("rel"),
      sourceEntityId: source.entityId,
      sourceColumnId: source.columnId,
      targetEntityId: entityId,
      targetColumnId: columnId,
      cardinality: card,
      onDelete: "",
      onUpdate: "",
      comment: "",
      routing: { points: [], manual: false },
    });
  });
  app.tool = "select";
  app.relSource = null;
  setStatus("status.relationCreated");
  render();
}

function mutate(fn: (doc: SchemaDoc) => void): void {
  const before = clone(app.doc);
  fn(app.doc);
  app.doc.meta.updatedAt = new Date().toISOString();
  app.history.pushBefore(before);
  markDirty();
  render();
}

function markDirty(): void {
  app.dirty = true;
  scheduleAutosave();
  renderChrome();
}

let saveTimer = 0;
function scheduleAutosave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void autosave(), 250);
}

async function autosave(): Promise<void> {
  if (!app.handle || !app.dirty) return;
  try {
    const ok = await ensurePermission(app.handle, "readwrite");
    if (!ok) return;
    await writeHandle(app.handle, serialize(app.doc));
    app.dirty = false;
    setStatus("status.autosaved", { file: app.fileLabel });
    renderChrome();
  } catch (err) {
    const message = err instanceof Error ? err.message : "error";
    setStatus("status.autosaveFailed", { message });
    showToast(t("status.autosaveFailed", { message }));
    renderChrome();
  }
}

function undo(): void {
  const prev = app.history.undo(app.doc);
  if (!prev) return;
  app.doc = prev;
  markDirty();
  render();
}

function redo(): void {
  const next = app.history.redo(app.doc);
  if (!next) return;
  app.doc = next;
  markDirty();
  render();
}

function deleteSelected(): void {
  if (app.selectedRel && app.selected.size === 0) {
    const id = app.selectedRel;
    mutate((doc) => {
      doc.relations = doc.relations.filter((r) => r.id !== id);
    });
    app.selectedRel = null;
    return;
  }
  if (app.selected.size === 0) return;
  const ids = new Set(app.selected);
  mutate((doc) => {
    const colIds = new Set<string>();
    for (const entity of doc.entities) {
      if (ids.has(entity.id)) for (const column of entity.columns) colIds.add(column.id);
    }
    doc.entities = doc.entities.filter((e) => !ids.has(e.id));
    doc.relations = doc.relations.filter(
      (r) => !ids.has(r.sourceEntityId) && !ids.has(r.targetEntityId) && !colIds.has(r.sourceColumnId) && !colIds.has(r.targetColumnId),
    );
  });
  app.selected.clear();
}

function onKey(ev: KeyboardEvent): void {
  const typing = isTyping(ev.target);
  if (ev.key === "Escape") {
    hideMenu();
    closeOverlay();
    app.tool = "select";
    app.relSource = null;
    setStatus("status.select");
    renderChrome();
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z") {
    ev.preventDefault();
    if (ev.shiftKey) redo();
    else undo();
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "y") {
    ev.preventDefault();
    redo();
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s") {
    ev.preventDefault();
    void saveSchema(ev.shiftKey);
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "o") {
    ev.preventDefault();
    void loadSchema();
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "n") {
    ev.preventDefault();
    void newSchema();
    return;
  }
  if (typing) return;
  if (ev.key === " " ) {
    app.space = true;
    ev.preventDefault();
  }
  if (ev.key === "Delete" || ev.key === "Backspace") {
    ev.preventDefault();
    deleteSelected();
  }
  if (ev.key.toLowerCase() === "f") fit();
  if (ev.key.toLowerCase() === "a" && (ev.metaKey || ev.ctrlKey)) {
    ev.preventDefault();
    app.selected = new Set(app.doc.entities.map((e) => e.id));
    render();
  }
  if (ev.key === "Enter" && app.selected.size === 1) openDetail([...app.selected][0]);
  if (ev.key === "1") armRelation("zero-or-one");
  if (ev.key === "2") armRelation("zero-or-many");
  if (ev.key === "3") armRelation("only-one");
  if (ev.key === "4") armRelation("one-or-many");
  if (ev.key === "0") {
    app.tool = "select";
    app.relSource = null;
    renderChrome();
  }
}

function onKeyUp(ev: KeyboardEvent): void {
  if (ev.key === " ") app.space = false;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

async function newSchema(): Promise<void> {
  if (app.dirty && !window.confirm(t("confirm.discardNew"))) return;
  app.doc = emptySchema();
  app.history.reset();
  app.handle = null;
  app.fileLabel = "untitled.schematic.json";
  app.dirty = false;
  app.selected.clear();
  app.selectedRel = null;
  await rememberHandle(null);
  setStatus("status.newSchema");
  render();
}

async function loadSchema(): Promise<void> {
  if (app.dirty && !window.confirm(t("confirm.discardLoad"))) return;
  const picked = await pickOpen();
  if (!picked) return;
  adoptText(picked.text, picked.name, picked.handle);
}

function adoptText(text: string, name: string, handle: FileSystemFileHandle | null): void {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && (parsed as { kind?: string }).kind === "schematic.settings") {
      app.settings = parseSettings(parsed, defaultSettings());
      saveSettings();
      showToast(t("toast.settingsLoaded"));
      return;
    }
    app.doc = parseSchema(parsed);
    app.history.reset();
    app.handle = handle;
    app.fileLabel = name;
    app.dirty = false;
    app.selected.clear();
    void rememberHandle(handle);
    setStatus("status.loaded", { file: name });
    render();
  } catch (err) {
    const message = err instanceof FormatError || err instanceof Error ? err.message : t("toast.invalidFile");
    showToast(message);
  }
}

async function saveSchema(forceNew: boolean): Promise<void> {
  const text = serialize(app.doc);
  try {
    if (!forceNew && app.handle) {
      const ok = await ensurePermission(app.handle, "readwrite");
      if (!ok) {
        showToast(t("toast.permission"));
        return;
      }
      await writeHandle(app.handle, text);
    } else {
      const handle = await pickSave(schemaFileName(app.doc), text);
      if (!handle && !("showSaveFilePicker" in window)) {
        app.dirty = false;
        setStatus("status.downloaded");
        renderChrome();
        return;
      }
      if (!handle) return;
      app.handle = handle;
      app.fileLabel = handle.name;
      await rememberHandle(handle);
    }
    app.dirty = false;
    setStatus("status.savedFile", { file: app.fileLabel });
    renderChrome();
  } catch (err) {
    showToast(err instanceof Error ? err.message : t("toast.saveFailed"));
  }
}

function exportJson(): void {
  downloadText(schemaFileName(app.doc), serialize(app.doc), "application/json");
  setStatus("status.exported");
  renderChrome();
}

async function restoreLastFile(): Promise<void> {
  const handle = await recallHandle();
  if (!handle) return;
  try {
    const perm = await handle.queryPermission({ mode: "read" });
    if (perm !== "granted") {
      app.fileLabel = handle.name;
      setStatus("status.lastFile", { file: handle.name });
      renderChrome();
      showToast(t("toast.lastFile", { file: handle.name }));
      $("file-name").onclick = () => void reopen(handle);
      return;
    }
    const text = await readHandle(handle);
    adoptText(text, handle.name, handle);
    setStatus("status.restored", { file: handle.name });
    renderChrome();
  } catch {
    setStatus("status.restoreFailed");
    renderChrome();
  }
}

async function reopen(handle: FileSystemFileHandle): Promise<void> {
  const ok = await ensurePermission(handle, "read");
  if (!ok) return;
  const text = await readHandle(handle);
  adoptText(text, handle.name, handle);
}

function fit(): void {
  const stage = $("stage");
  const rect = stage.getBoundingClientRect();
  if (app.doc.entities.length === 0) {
    app.view = { x: 40, y: 40, zoom: 1 };
    saveView();
    renderCanvas();
    renderChrome();
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entity of app.doc.entities) {
    minX = Math.min(minX, entity.position.x);
    minY = Math.min(minY, entity.position.y);
    maxX = Math.max(maxX, entity.position.x + NODE_W);
    maxY = Math.max(maxY, entity.position.y + entityHeight(entity.collapsed, entity.columns.length));
  }
  const pad = 36;
  const w = Math.max(40, maxX - minX);
  const h = Math.max(40, maxY - minY);
  const zoom = Math.min(1.6, Math.max(0.25, Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h)));
  app.view.zoom = zoom;
  app.view.x = (rect.width - w * zoom) / 2 - minX * zoom;
  app.view.y = (rect.height - h * zoom) / 2 - minY * zoom;
  saveView();
  renderCanvas();
  renderChrome();
}

function focusEntity(id: string): void {
  const entity = app.doc.entities.find((e) => e.id === id);
  if (!entity) return;
  const rect = $("stage").getBoundingClientRect();
  const h = entityHeight(entity.collapsed, entity.columns.length);
  app.view.x = rect.width / 2 - (entity.position.x + NODE_W / 2) * app.view.zoom;
  app.view.y = rect.height / 2 - (entity.position.y + h / 2) * app.view.zoom;
  saveView();
  app.selected = new Set([id]);
  render();
}

function render(): void {
  renderCanvas();
  renderChrome();
}

function setStatus(key: string, vars: Record<string, string | number> = {}): void {
  app.statusKey = key;
  app.statusVars = vars;
}

function statusText(): string {
  const vars: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(app.statusVars)) {
    vars[name] = typeof value === "string" && value.startsWith("card.") ? t(value) : value;
  }
  return t(app.statusKey, vars);
}

function renderChrome(): void {
  const file = $("file-name");
  file.textContent = app.fileLabel;
  file.classList.toggle("dirty", app.dirty);
  const zoomField = $<HTMLInputElement>("zoom-input");
  if (document.activeElement !== zoomField) zoomField.value = String(Math.round(app.view.zoom * 100));
  const selected = describeSelection();
  $("stat-sel").innerHTML = `${t("status.selection")} <strong>${selected}</strong>`;
  $("stat-file").textContent = app.dirty ? t("status.unsaved") : app.handle ? t("status.saved") : t("status.memory");
  $("stat-file").classList.toggle("warn", app.dirty);
  $("stat-mode").textContent = statusText();
  $("btn-undo").toggleAttribute("disabled", !app.history.canUndo());
  $("btn-redo").toggleAttribute("disabled", !app.history.canRedo());
  $("btn-select").classList.toggle("active", app.tool === "select");
  for (const card of CARDINALITIES) {
    $(`card-${card}`).classList.toggle("active", app.tool === card);
  }
  $("btn-minimap").classList.toggle("active", app.settings.ui.showMinimap);
  $("minimap").classList.toggle("hidden", !app.settings.ui.showMinimap);
}

function describeSelection(): string {
  if (app.selectedRel) {
    const relation = app.doc.relations.find((r) => r.id === app.selectedRel);
    if (!relation) return t("selection.relation");
    const s = app.doc.entities.find((e) => e.id === relation.sourceEntityId);
    const target = app.doc.entities.find((e) => e.id === relation.targetEntityId);
    return `${s?.name ?? "?"} → ${target?.name ?? "?"}`;
  }
  if (app.selected.size === 0) return t("status.none");
  if (app.selected.size > 1) return t("selection.entities", { count: app.selected.size });
  const entity = app.doc.entities.find((e) => e.id === [...app.selected][0]);
  return entity?.name ?? t("selection.entity");
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function renderCanvas(): void {
  const stage = $("stage");
  const rect = stage.getBoundingClientRect();
  stage.setAttribute("viewBox", `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);
  stage.replaceChildren();
  stage.classList.toggle("rel-arm", app.tool !== "select");
  const world = svgEl("g", { transform: `translate(${app.view.x} ${app.view.y}) scale(${app.view.zoom})` });
  world.append(grid());
  const warnings = computeWarnings(app.doc);
  for (const entity of app.doc.entities) world.append(drawEntity(entity, warnings));
  for (const relation of app.doc.relations) world.append(drawRelation(relation, warnings));
  stage.append(world);
  if (app.settings.ui.showMinimap) drawMinimap();
}

function grid(): SVGElement {
  const g = svgEl("g", { opacity: "0.35" });
  const step = 32;
  const rect = $("stage").getBoundingClientRect();
  const x0 = Math.floor(-app.view.x / app.view.zoom / step) * step - step;
  const y0 = Math.floor(-app.view.y / app.view.zoom / step) * step - step;
  const x1 = x0 + rect.width / app.view.zoom + step * 3;
  const y1 = y0 + rect.height / app.view.zoom + step * 3;
  for (let x = x0; x < x1; x += step) {
    g.append(svgEl("line", { x1: x, y1: y0, x2: x, y2: y1, stroke: "var(--line)", "stroke-width": 0.4 }));
  }
  for (let y = y0; y < y1; y += step) {
    g.append(svgEl("line", { x1: x0, y1: y, x2: x1, y2: y, stroke: "var(--line)", "stroke-width": 0.4 }));
  }
  return g;
}

function drawRelation(relation: Relation, _warnings: ReturnType<typeof computeWarnings>): SVGGElement {
  const g = svgEl("g");
  const points = relationPoints(relation);
  if (points.length < 2) return g;
  const style = app.settings.ui.edgeRouting;
  const d = pointsToPath(points, style);
  const selected = app.selectedRel === relation.id;
  const hit = svgEl("path", { d, fill: "none", stroke: "transparent", "stroke-width": 10 });
  const line = svgEl("path", {
    d,
    fill: "none",
    stroke: "var(--ink)",
    "stroke-width": selected ? 1.8 : 1.25,
  });
  g.append(hit, line);
  const source = app.doc.entities.find((e) => e.id === relation.sourceEntityId);
  const target = app.doc.entities.find((e) => e.id === relation.targetEntityId);
  if (source && target) {
    const sIdx = Math.max(0, source.columns.findIndex((c) => c.id === relation.sourceColumnId));
    const tIdx = Math.max(0, target.columns.findIndex((c) => c.id === relation.targetColumnId));
    const pair = anchorsFor(
      boxOf(source),
      rowCenterY(source.position.y, source.collapsed, sIdx),
      boxOf(target),
      rowCenterY(target.position.y, target.collapsed, tIdx),
    );
    const srcDir = outward(pair.source);
    const tgtDir = outward(pair.target);
    g.append(markAt({ x: points[0].x + srcDir * 14, y: points[0].y }, "one", srcDir));
    const end = points[points.length - 1];
    g.append(markAt({ x: end.x + tgtDir * 14, y: end.y }, cardinalityMark(relation.cardinality), tgtDir));
  }
  return g;
}

function boxOf(entity: Entity) {
  return {
    x: entity.position.x,
    y: entity.position.y,
    w: NODE_W,
    h: entityHeight(entity.collapsed, entity.columns.length),
  };
}

function markAt(anchor: { x: number; y: number }, kind: string, dir: 1 | -1): SVGGElement {
  const g = svgEl("g", {
    transform: `translate(${anchor.x} ${anchor.y}) scale(${dir} 1)`,
    stroke: "var(--ink)",
    fill: "none",
    "stroke-width": 1.25,
    "stroke-linecap": "square",
    "vector-effect": "non-scaling-stroke",
  });
  const add = (d: string) => g.append(svgEl("path", { d }));
  const ring = (cx: number) => g.append(svgEl("circle", { cx, cy: 0, r: 2.4 }));
  /* Glyphs are drawn in +x, then scaled by dir. Fingers sit on the line side (x=0). */
  if (kind === "one") {
    add("M0 0h12");
    add("M2 -4.5v9");
  } else if (kind === "only-one") {
    add("M0 0h14");
    add("M2 -4.5v9");
    add("M6 -4.5v9");
  } else if (kind === "zero-one") {
    add("M0 0h4");
    add("M2.5 -4.5v9");
    ring(9);
    add("M11.4 0h3");
  } else if (kind === "zero-many") {
    add("M0 0 L6.6 -4.5");
    add("M0 0h6.6");
    add("M0 0 L6.6 4.5");
    add("M6.6 0h2");
    ring(11.2);
    add("M13.6 0h2.2");
  } else if (kind === "one-many") {
    add("M0 0 L7 -4.5");
    add("M0 0h7");
    add("M0 0 L7 4.5");
    add("M5.5 -4.5v9");
    add("M7 0h7");
  }
  return g;
}

function drawEntity(entity: Entity, warnings: ReturnType<typeof computeWarnings>): SVGGElement {
  const g = svgEl("g", { transform: `translate(${entity.position.x} ${entity.position.y})` });
  const h = entityHeight(entity.collapsed, entity.columns.length);
  const selected = app.selected.has(entity.id);
  const body = svgEl("rect", {
    x: 0,
    y: 0,
    width: NODE_W,
    height: h,
    fill: "var(--bg-3)",
    stroke: selected ? "var(--accent)" : "var(--line-strong)",
    "stroke-width": selected ? 1.4 : 1,
  });
  g.append(body);
  const head = svgEl("rect", { x: 0, y: 0, width: NODE_W, height: HEADER_H, fill: "var(--bg-2)", stroke: "var(--line)", "stroke-width": 1 });
  g.append(head);
  const type = app.settings.entityTypes.find((t) => t.id === entity.typeId);
  const badge = svgEl("text", { x: 4, y: 13, fill: "var(--ink-dim)", "font-size": 9, "font-family": "var(--font)" });
  badge.textContent = displayName("entity", entity.typeId, type?.name ?? entity.typeId).slice(0, 3);
  g.append(badge);
  const title = svgEl("text", { x: 28, y: 14, fill: "var(--ink)", "font-size": 11, "font-family": "var(--font)", "font-weight": 700 });
  title.textContent = clip(entity.name, 18);
  const titleClip = svgEl("clipPath", { id: `clip-${entity.id}` });
  titleClip.append(svgEl("rect", { x: 26, y: 1, width: NODE_W - 64, height: HEADER_H - 2 }));
  g.append(titleClip);
  title.setAttribute("clip-path", `url(#clip-${entity.id})`);
  g.append(title);
  g.append(headerIcon(entity.collapsed ? "expand" : "collapse", NODE_W - 30, 4));
  g.append(headerIcon("info", NODE_W - 14, 4));
  if (!entity.collapsed) {
    entity.columns.forEach((column, index) => {
      const y = HEADER_H + index * ROW_H;
      const picked = app.relSource?.entityId === entity.id && app.relSource.columnId === column.id;
      if (index % 2 === 0) {
        g.append(svgEl("rect", { x: 0, y, width: NODE_W, height: ROW_H, fill: "var(--bg-2)", opacity: 0.35 }));
      }
      if (picked) g.append(svgEl("rect", { x: 1, y: y + 1, width: NODE_W - 2, height: ROW_H - 2, fill: "none", stroke: "var(--accent)", "stroke-width": 1 }));
      g.append(svgEl("line", { x1: 16, y1: y, x2: 16, y2: y + ROW_H, stroke: "var(--line)", "stroke-width": 1 }));
      g.append(svgEl("line", { x1: NODE_W - 16, y1: y, x2: NODE_W - 16, y2: y + ROW_H, stroke: "var(--line)", "stroke-width": 1 }));
      g.append(svgEl("line", { x1: NODE_W - 92, y1: y, x2: NODE_W - 92, y2: y + ROW_H, stroke: "var(--line)", "stroke-width": 1 }));
      const badKey = warnings.badKeyColumns.has(columnKey(entity.id, column.id));
      const badNull = warnings.badNullColumns.has(columnKey(entity.id, column.id));
      if (badKey) g.append(svgEl("rect", { x: 0.5, y: y + 0.5, width: 15, height: ROW_H - 1, fill: "var(--warn)" }));
      if (badNull) g.append(svgEl("rect", { x: NODE_W - 15.5, y: y + 0.5, width: 15, height: ROW_H - 1, fill: "var(--warn)" }));
      const key = svgEl("text", {
        x: 8,
        y: y + 13,
        "text-anchor": "middle",
        fill: badKey ? "var(--warn-ink)" : "var(--accent)",
        "font-size": 10,
        "font-family": "var(--font)",
      });
      key.textContent = column.key ?? "-";
      g.append(key);
      const name = svgEl("text", { x: 20, y: y + 13, fill: "var(--ink)", "font-size": 11, "font-family": "var(--font)" });
      name.textContent = clip(column.name, 14);
      g.append(name);
      const dtype = app.settings.dataTypes.find((t) => t.id === column.dataTypeId)?.name ?? "—";
      const typeText = svgEl("text", { x: NODE_W - 88, y: y + 13, fill: "var(--ink-dim)", "font-size": 10, "font-family": "var(--font)" });
      typeText.textContent = clip(dtype, 10);
      g.append(typeText);
      const nullable = svgEl("text", {
        x: NODE_W - 8,
        y: y + 13,
        "text-anchor": "middle",
        fill: badNull ? "var(--warn-ink)" : "var(--ink-dim)",
        "font-size": 10,
        "font-family": "var(--font)",
      });
      nullable.textContent = column.nullable ? "n" : "-";
      g.append(nullable);
    });
    const addY = HEADER_H + entity.columns.length * ROW_H;
    const add = svgEl("text", { x: 8, y: addY + 13, fill: "var(--accent)", "font-size": 12, "font-family": "var(--font)" });
    add.textContent = "+";
    g.append(add);
    const addLabel = svgEl("text", { x: 20, y: addY + 13, fill: "var(--ink-dim)", "font-size": 10, "font-family": "var(--font)" });
    addLabel.textContent = t("canvas.column");
    add.textContent = "+";
    g.append(addLabel);
  }
  return g;
}

function headerIcon(kind: "info" | "collapse" | "expand", x: number, y: number): SVGGElement {
  const g = svgEl("g", { transform: `translate(${x} ${y})`, stroke: "var(--ink-dim)", fill: "none", "stroke-width": 1.2 });
  if (kind === "info") {
    g.append(svgEl("circle", { cx: 6, cy: 6, r: 4.4 }));
    g.append(svgEl("path", { d: "M6 5.2v3.2M6 3.5h.01" }));
  } else if (kind === "collapse") {
    g.append(svgEl("path", { d: "M1 4h10M1 8h10" }));
  } else {
    g.append(svgEl("path", { d: "M1 2.5h10M1 6h10M1 9.5h10" }));
  }
  return g;
}

function clip(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

function drawMinimap(): void {
  const host = $("minimap");
  host.classList.remove("hidden");
  const svg = host.querySelector("svg") ?? document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 168 112");
  svg.replaceChildren();
  host.replaceChildren(svg);
  if (app.doc.entities.length === 0) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entity of app.doc.entities) {
    minX = Math.min(minX, entity.position.x);
    minY = Math.min(minY, entity.position.y);
    maxX = Math.max(maxX, entity.position.x + NODE_W);
    maxY = Math.max(maxY, entity.position.y + entityHeight(entity.collapsed, entity.columns.length));
  }
  const pad = 12;
  const w = Math.max(40, maxX - minX);
  const h = Math.max(40, maxY - minY);
  const scale = Math.min((168 - pad * 2) / w, (112 - pad * 2) / h);
  for (const entity of app.doc.entities) {
    const rect = svgEl("rect", {
      x: pad + (entity.position.x - minX) * scale,
      y: pad + (entity.position.y - minY) * scale,
      width: Math.max(2, NODE_W * scale),
      height: Math.max(2, entityHeight(entity.collapsed, entity.columns.length) * scale),
      fill: app.selected.has(entity.id) ? "var(--accent)" : "var(--line-strong)",
    });
    svg.append(rect);
  }
  const stage = $("stage").getBoundingClientRect();
  const vx = pad + (-app.view.x / app.view.zoom - minX) * scale;
  const vy = pad + (-app.view.y / app.view.zoom - minY) * scale;
  svg.append(svgEl("rect", {
    x: vx,
    y: vy,
    width: (stage.width / app.view.zoom) * scale,
    height: (stage.height / app.view.zoom) * scale,
    fill: "none",
    stroke: "var(--accent)",
    "stroke-width": 1,
  }));
}

function onMinimapDown(ev: PointerEvent): void {
  const svg = $("minimap").querySelector("svg");
  if (!svg) return;
  const bounds = svg.getBoundingClientRect();
  const px = ((ev.clientX - bounds.left) / bounds.width) * 168;
  const py = ((ev.clientY - bounds.top) / bounds.height) * 112;
  if (app.doc.entities.length === 0) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entity of app.doc.entities) {
    minX = Math.min(minX, entity.position.x);
    minY = Math.min(minY, entity.position.y);
    maxX = Math.max(maxX, entity.position.x + NODE_W);
    maxY = Math.max(maxY, entity.position.y + entityHeight(entity.collapsed, entity.columns.length));
  }
  const pad = 12;
  const scale = Math.min((168 - pad * 2) / Math.max(40, maxX - minX), (112 - pad * 2) / Math.max(40, maxY - minY));
  const wx = minX + (px - pad) / scale;
  const wy = minY + (py - pad) / scale;
  const stage = $("stage").getBoundingClientRect();
  app.view.x = stage.width / 2 - wx * app.view.zoom;
  app.view.y = stage.height / 2 - wy * app.view.zoom;
  saveView();
  renderCanvas();
}

function openNameEditor(kind: "entity" | "column", entityId: string, columnId?: string): void {
  const entity = app.doc.entities.find((e) => e.id === entityId);
  if (!entity) return;
  const column = columnId ? entity.columns.find((c) => c.id === columnId) : undefined;
  const value = kind === "entity" ? entity.name : column?.name ?? "";
  const host = $("inline");
  host.classList.remove("hidden");
  host.replaceChildren();
  const input = document.createElement("input");
  input.value = value;
  host.append(input);
  const place = () => {
    if (kind === "entity") {
      placeInline(entity.position.x + 26, entity.position.y + 2, 140, 16);
    } else if (column) {
      const index = entity.columns.findIndex((c) => c.id === column.id);
      placeInline(entity.position.x + 18, entity.position.y + HEADER_H + index * ROW_H + 1, 120, 16);
    }
  };
  place();
  const commit = () => {
    const next = input.value.trim();
    host.classList.add("hidden");
    host.replaceChildren();
    if (!next || next === value) return;
    mutate((doc) => {
      const live = doc.entities.find((e) => e.id === entityId);
      if (!live) return;
      if (kind === "entity") live.name = next;
      else {
        const col = live.columns.find((c) => c.id === columnId);
        if (col) col.name = next;
      }
    });
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") input.blur();
    if (ev.key === "Escape") {
      input.value = value;
      input.blur();
    }
    ev.stopPropagation();
  });
  input.focus();
  input.select();
}

function openTypeEditor(entityId: string, columnId: string): void {
  const entity = app.doc.entities.find((e) => e.id === entityId);
  const column = entity?.columns.find((c) => c.id === columnId);
  if (!entity || !column) return;
  const index = entity.columns.findIndex((c) => c.id === columnId);
  const host = $("inline");
  host.classList.remove("hidden");
  host.replaceChildren();
  const select = document.createElement("select");
  for (const type of app.settings.dataTypes) {
    const opt = document.createElement("option");
    opt.value = type.id;
    opt.textContent = type.name;
    if (type.id === column.dataTypeId) opt.selected = true;
    select.append(opt);
  }
  host.append(select);
  placeInline(entity.position.x + NODE_W - 90, entity.position.y + HEADER_H + index * ROW_H + 1, 72, 16);
  const commit = () => {
    const next = select.value;
    host.classList.add("hidden");
    host.replaceChildren();
    if (next === column.dataTypeId) return;
    mutate((doc) => {
      const live = doc.entities.find((e) => e.id === entityId)?.columns.find((c) => c.id === columnId);
      if (live) live.dataTypeId = next;
    });
  };
  select.addEventListener("change", commit);
  select.addEventListener("blur", () => {
    host.classList.add("hidden");
    host.replaceChildren();
  });
  select.addEventListener("keydown", (ev) => ev.stopPropagation());
  select.focus();
}

function placeInline(worldX: number, worldY: number, width: number, height: number): void {
  const host = $("inline");
  host.style.left = `${app.view.x + worldX * app.view.zoom}px`;
  host.style.top = `${app.view.y + worldY * app.view.zoom}px`;
  host.style.width = `${width * app.view.zoom}px`;
  host.style.height = `${height * app.view.zoom}px`;
}

function closeOverlay(): void {
  $("overlay").classList.add("hidden");
  $("overlay").innerHTML = "";
}

function openOverlay(node: HTMLElement): void {
  const overlay = $("overlay");
  overlay.classList.remove("hidden");
  overlay.replaceChildren(node);
  overlay.onclick = (ev) => {
    if (ev.target === overlay) closeOverlay();
  };
}

function openPrompt(): void {
  const panel = panelShell(t("dialog.exportPrompt"), () => closeOverlay());
  const body = panel.querySelector(".panel-body") as HTMLElement;
  const text = schemaToPrompt(app.doc, app.settings);
  const area = document.createElement("textarea");
  area.className = "prompt-view";
  area.readOnly = true;
  area.value = text;
  body.append(area);
  const foot = panel.querySelector(".panel-foot") as HTMLElement;
  foot.append(action(t("action.copy"), () => {
    void navigator.clipboard.writeText(text).then(() => showToast(t("toast.promptCopied")));
  }));
  foot.append(action(t("action.downloadMd"), () => downloadText(`${app.doc.meta.name || "schema"}.prompt.md`, text, "text/markdown")));
  openOverlay(panel);
}

function openSettings(): void {
  const panel = panelShell(t("dialog.settings"), () => closeOverlay());
  const body = panel.querySelector(".panel-body") as HTMLElement;
  const tabs = document.createElement("div");
  tabs.className = "tabs";
  const pages = [
    ["interface", "tab.interface"],
    ["data types", "tab.dataTypes"],
    ["databases", "tab.databases"],
    ["entity types", "tab.entityTypes"],
  ] as const;
  type SettingsPage = (typeof pages)[number][0];
  let page: SettingsPage = "interface";
  const mount = document.createElement("div");
  const draw = () => {
    tabs.replaceChildren();
    for (const [name, key] of pages) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = t(key);
      btn.classList.toggle("active", name === page);
      btn.onclick = () => {
        page = name;
        draw();
      };
      tabs.append(btn);
    }
    mount.replaceChildren();
    if (page === "interface") mount.append(interfaceForm());
    if (page === "data types") mount.append(dataTypeTable());
    if (page === "databases") mount.append(databaseTable());
    if (page === "entity types") mount.append(entityTypeTable());
  };
  body.append(tabs, mount);
  const foot = panel.querySelector(".panel-foot") as HTMLElement;
  foot.append(action(t("action.exportSettings"), () => downloadText(settingsFileName(), serialize(app.settings), "application/json")));
  foot.append(action(t("action.importSettings"), () => void importSettings()));
  foot.append(action(t("action.resetDefaults"), () => {
    if (!window.confirm(t("confirm.resetSettings"))) return;
    const theme = app.settings.ui.theme;
    const language = app.settings.ui.language;
    app.settings = defaultSettings();
    app.settings.ui.theme = theme;
    app.settings.ui.language = language;
    saveSettings();
    draw();
  }));
  draw();
  openOverlay(panel);
}

function interfaceForm(): HTMLElement {
  const form = document.createElement("div");
  form.className = "grid-form";
  const ui = app.settings.ui;
  addRow(form, t("field.fontSize"), numberInput(ui.fontSize, 9, 18, (v) => {
    app.settings.ui.fontSize = v;
    saveSettings();
  }));
  addRow(form, t("field.theme"), selectInput(
    [
      ["light", t("theme.light")],
      ["dark", t("theme.dark")],
      ["horizon", t("theme.horizon")],
      ["hc-green", t("theme.hcGreen")],
      ["hc-blue", t("theme.hcBlue")],
      ["hc-orange", t("theme.hcOrange")],
    ],
    ui.theme,
    (v) => {
      app.settings.ui.theme = v as ThemeId;
      saveSettings();
    },
  ));
  addRow(form, t("field.language"), selectInput(
    languageChoices().map((item) => [item.id, `${item.label} · ${item.short}`]),
    currentLanguage(),
    (v) => {
      app.settings.ui.language = v;
      saveSettings();
      applyLanguage(v);
      closeOverlay();
      openSettings();
    },
  ));
  addRow(form, t("field.zoomSensitivity"), numberInput(ui.zoomSensitivity, 0.2, 3, (v) => {
    app.settings.ui.zoomSensitivity = v;
    saveSettings();
  }, 0.1));
  addRow(form, t("field.panSensitivity"), numberInput(ui.panSensitivity, 0.2, 3, (v) => {
    app.settings.ui.panSensitivity = v;
    saveSettings();
  }, 0.1));
  addRow(form, t("field.edgeRouting"), selectInput(
    [["orthogonal", t("route.orthogonal")], ["straight", t("route.straight")], ["curved", t("route.curved")]],
    ui.edgeRouting,
    (v) => {
      app.settings.ui.edgeRouting = v as EdgeRouting;
      saveSettings();
    },
  ));
  const mini = document.createElement("input");
  mini.type = "checkbox";
  mini.checked = ui.showMinimap;
  mini.onchange = () => {
    app.settings.ui.showMinimap = mini.checked;
    saveSettings();
  };
  addRow(form, t("field.minimap"), mini);
  return form;
}

async function importSettings(): Promise<void> {
  const picked = await pickOpen();
  if (!picked) return;
  try {
    app.settings = parseSettings(JSON.parse(picked.text), defaultSettings());
    saveSettings();
    closeOverlay();
    openSettings();
    showToast(t("toast.settingsImported"));
  } catch (err) {
    showToast(err instanceof Error ? err.message : t("toast.invalidSettings"));
  }
}

function dataTypeTable(): HTMLElement {
  const wrap = document.createElement("div");
  const table = document.createElement("table");
  table.className = "data";
  table.innerHTML = `<thead><tr><th>${t("col.name")}</th><th>${t("col.primitive")}</th><th>${t("col.bytes")}</th><th>${t("col.database")}</th><th></th></tr></thead>`;
  const body = document.createElement("tbody");
  for (const dt of app.settings.dataTypes) {
    const tr = document.createElement("tr");
    tr.append(cellInput(dt.name, (v) => { dt.name = v; saveSettings(); }));
    tr.append(cellSelect(app.settings.primitives.map((p) => [p, p]), dt.primitive, (v) => { dt.primitive = v; saveSettings(); }));
    tr.append(cellInput(dt.maxByteSize == null ? "" : String(dt.maxByteSize), (v) => {
      dt.maxByteSize = v.trim() === "" ? null : Number(v);
      saveSettings();
    }));
    tr.append(cellSelect(app.settings.databases.map((d) => [d.id, displayName("db", d.id, d.name)]), dt.databaseId, (v) => { dt.databaseId = v; saveSettings(); }));
    tr.append(cellRemove(() => {
      app.settings.dataTypes = app.settings.dataTypes.filter((item) => item.id !== dt.id);
      saveSettings();
      openSettings();
    }));
    body.append(tr);
  }
  table.append(body);
  wrap.append(table, action(t("action.addDataType"), () => {
    app.settings.dataTypes.push({
      id: uid("dt"),
      name: t("default.customType"),
      primitive: app.settings.primitives[0] ?? "other",
      maxByteSize: null,
      databaseId: app.settings.databases[0]?.id ?? "",
    });
    saveSettings();
    openSettings();
  }));
  return wrap;
}

function databaseTable(): HTMLElement {
  const wrap = document.createElement("div");
  const table = document.createElement("table");
  table.className = "data";
  table.innerHTML = `<thead><tr><th>${t("col.id")}</th><th>${t("col.name")}</th><th></th></tr></thead>`;
  const body = document.createElement("tbody");
  for (const db of app.settings.databases) {
    const tr = document.createElement("tr");
    const idCell = document.createElement("td");
    idCell.textContent = db.id;
    tr.append(idCell);
    tr.append(cellInput(db.name, (v) => { db.name = v; saveSettings(); }));
    tr.append(cellRemove(() => {
      app.settings.databases = app.settings.databases.filter((item) => item.id !== db.id);
      saveSettings();
      openSettings();
    }));
    body.append(tr);
  }
  table.append(body);
  wrap.append(table, action(t("action.addDatabase"), () => {
    const name = window.prompt(t("prompt.databaseName"), t("default.database"));
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (app.settings.databases.some((d) => d.id === id)) return;
    app.settings.databases.push({ id, name });
    saveSettings();
    openSettings();
  }));
  return wrap;
}

function entityTypeTable(): HTMLElement {
  const wrap = document.createElement("div");
  const table = document.createElement("table");
  table.className = "data";
  table.innerHTML = `<thead><tr><th>${t("col.id")}</th><th>${t("col.name")}</th><th>${t("col.plural")}</th><th></th></tr></thead>`;
  const body = document.createElement("tbody");
  for (const et of app.settings.entityTypes) {
    const tr = document.createElement("tr");
    const idCell = document.createElement("td");
    idCell.textContent = et.id;
    tr.append(idCell);
    tr.append(cellInput(et.name, (v) => { et.name = v; saveSettings(); }));
    tr.append(cellInput(et.plural, (v) => { et.plural = v; saveSettings(); }));
    tr.append(cellRemove(() => {
      app.settings.entityTypes = app.settings.entityTypes.filter((item) => item.id !== et.id);
      saveSettings();
      openSettings();
    }));
    body.append(tr);
  }
  table.append(body);
  wrap.append(table, action(t("action.addEntityType"), () => {
    const name = window.prompt(t("prompt.entityType"), t("default.entityType"));
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    app.settings.entityTypes.push({ id, name, plural: `${name}s` });
    saveSettings();
    openSettings();
  }));
  return wrap;
}

const detailPage = new Map<string, "record" | "columns" | "indexes" | "constraints" | "enums">();
let detailSession: { entityId: string; before: SchemaDoc; local: History } | null = null;

function openDetail(entityId: string, keepPage = true): void {
  const entity = app.doc.entities.find((e) => e.id === entityId);
  if (!entity) return;
  if (!detailSession || detailSession.entityId !== entityId) {
    detailSession = { entityId, before: clone(app.doc), local: new History() };
  }
  const before = detailSession.before;
  const local = detailSession.local;
  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    if (JSON.stringify(before) !== JSON.stringify(app.doc)) {
      app.history.pushBefore(before);
      markDirty();
    }
  };
  const finish = () => {
    commit();
    detailSession = null;
    closeOverlay();
    render();
  };
  const panel = panelShell(t("dialog.detail", { name: entity.name }), finish, { floating: true, boxKey: "detail" });
  const closeBtn = panel.querySelector(".panel-head button") as HTMLButtonElement;
  closeBtn.title = t("dialog.closeCommits");
  const body = panel.querySelector(".panel-body") as HTMLElement;
  const tabs = document.createElement("div");
  tabs.className = "tabs";
  const pages = [
    ["record", "tab.record"],
    ["columns", "tab.columns"],
    ["indexes", "tab.indexes"],
    ["constraints", "tab.constraints"],
    ["enums", "tab.enums"],
  ] as const;
  type DetailPage = (typeof pages)[number][0];
  let page: DetailPage = keepPage ? detailPage.get(entityId) ?? "record" : "record";
  const mount = document.createElement("div");
  const noteLocal = () => {
    local.pushBefore(clone(app.doc));
  };
  const draw = () => {
    const live = app.doc.entities.find((e) => e.id === entityId);
    if (!live) return;
    detailPage.set(entityId, page);
    tabs.replaceChildren();
    for (const [name, key] of pages) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = t(key);
      btn.classList.toggle("active", page === name);
      btn.onclick = () => {
        page = name;
        draw();
      };
      tabs.append(btn);
    }
    mount.replaceChildren();
    if (page === "record") mount.append(recordForm(live, noteLocal));
    if (page === "columns") mount.append(columnEditor(live, () => openDetail(entityId), noteLocal));
    if (page === "indexes") mount.append(indexEditor(live, () => openDetail(entityId), noteLocal));
    if (page === "constraints") mount.append(constraintEditor(live, () => openDetail(entityId), noteLocal));
    if (page === "enums") mount.append(enumEditor(() => openDetail(entityId), noteLocal));
    (panel.querySelector(".title") as HTMLElement).textContent = t("dialog.detail", { name: live.name });
    undoBtn.toggleAttribute("disabled", !local.canUndo());
    redoBtn.toggleAttribute("disabled", !local.canRedo());
  };
  const undoBtn = action(t("action.undo"), () => {
    const prev = local.undo(app.doc);
    if (!prev) return;
    app.doc = prev;
    touch();
    draw();
    renderCanvas();
  });
  const redoBtn = action(t("action.redo"), () => {
    const next = local.redo(app.doc);
    if (!next) return;
    app.doc = next;
    touch();
    draw();
    renderCanvas();
  });
  body.append(tabs, mount);
  const foot = panel.querySelector(".panel-foot") as HTMLElement;
  foot.append(undoBtn, redoBtn);
  draw();
  openOverlay(panel);
}

function touch(): void {
  app.doc.meta.updatedAt = new Date().toISOString();
  app.dirty = true;
  renderChrome();
}

function recordForm(entity: Entity, noteLocal: () => void): HTMLElement {
  const form = document.createElement("div");
  form.className = "grid-form";
  addRow(form, t("field.name"), textInput(entity.name, (v) => { noteLocal(); entity.name = v; touch(); }));
  addRow(form, t("field.type"), selectInput(app.settings.entityTypes.map((item) => [item.id, displayName("entity", item.id, item.name)]), entity.typeId, (v) => {
    noteLocal();
    entity.typeId = v;
    touch();
  }));
  addRow(form, t("field.comment"), areaInput(entity.comment, (v) => { noteLocal(); entity.comment = v; touch(); }));
  addRow(form, t("field.color"), textInput(entity.color, (v) => { noteLocal(); entity.color = v; touch(); }));
  addRow(form, t("field.schemaName"), textInput(app.doc.meta.name, (v) => { noteLocal(); app.doc.meta.name = v; touch(); }));
  addRow(form, t("field.schemaNote"), areaInput(app.doc.meta.comment, (v) => { noteLocal(); app.doc.meta.comment = v; touch(); }));
  addRow(form, t("field.x"), numberInput(entity.position.x, -100000, 100000, (v) => { noteLocal(); entity.position.x = v; touch(); renderCanvas(); }));
  addRow(form, t("field.y"), numberInput(entity.position.y, -100000, 100000, (v) => { noteLocal(); entity.position.y = v; touch(); renderCanvas(); }));
  const collapsed = document.createElement("input");
  collapsed.type = "checkbox";
  collapsed.checked = entity.collapsed;
  collapsed.onchange = () => { noteLocal(); entity.collapsed = collapsed.checked; touch(); renderCanvas(); };
  addRow(form, t("field.collapsed"), collapsed);
  return form;
}

function columnEditor(entity: Entity, reopen: () => void, noteLocal: () => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.append(help(t("help.columns")));
  const table = document.createElement("table");
  table.className = "data";
  table.innerHTML = `<thead><tr><th>${t("col.key")}</th><th>${t("col.name")}</th><th>${t("col.type")}</th><th>${t("col.nullable")}</th><th>${t("col.unique")}</th><th>${t("col.default")}</th><th>${t("col.comment")}</th><th>${t("col.nested")}</th><th></th></tr></thead>`;
  const body = document.createElement("tbody");
  entity.columns.forEach((column) => {
    const tr = document.createElement("tr");
    tr.append(cellSelect([["", "-"], ["P", "P"], ["F", "F"]], column.key ?? "", (v) => {
      noteLocal();
      column.key = v === "P" || v === "F" ? v : null;
      touch();
    }));
    tr.append(cellInput(column.name, (v) => { noteLocal(); column.name = v; touch(); }));
    tr.append(cellSelect(app.settings.dataTypes.map((item) => [item.id, item.name]), column.dataTypeId, (v) => { noteLocal(); column.dataTypeId = v; touch(); }));
    const n = document.createElement("input");
    n.type = "checkbox";
    n.checked = column.nullable;
    n.onchange = () => { noteLocal(); column.nullable = n.checked; touch(); };
    const nCell = document.createElement("td");
    nCell.append(n);
    tr.append(nCell);
    const u = document.createElement("input");
    u.type = "checkbox";
    u.checked = column.unique;
    u.onchange = () => { noteLocal(); column.unique = u.checked; touch(); };
    const uCell = document.createElement("td");
    uCell.append(u);
    tr.append(uCell);
    tr.append(cellInput(column.defaultValue, (v) => { noteLocal(); column.defaultValue = v; touch(); }));
    tr.append(cellInput(column.comment, (v) => { noteLocal(); column.comment = v; touch(); }));
    const nest = document.createElement("td");
    const nestBtn = document.createElement("button");
    nestBtn.type = "button";
    nestBtn.className = "mini-btn";
    nestBtn.textContent = column.nested ? t(`nested.${column.nested.kind}`) : t("nested.scalar");
    nestBtn.onclick = () => openNested(column, () => {
      nestBtn.textContent = column.nested ? t(`nested.${column.nested.kind}`) : t("nested.scalar");
      touch();
    });
    nest.append(nestBtn);
    tr.append(nest);
    tr.append(cellRemove(() => {
      noteLocal();
      entity.columns = entity.columns.filter((c) => c.id !== column.id);
      app.doc.relations = app.doc.relations.filter((r) => r.sourceColumnId !== column.id && r.targetColumnId !== column.id);
      touch();
      reopen();
    }));
    body.append(tr);
  });
  table.append(body);
  wrap.append(table, action(t("action.addColumn"), () => {
    noteLocal();
    entity.columns.push(makeField(app.settings.dataTypes[0]?.id ?? "", `col_${entity.columns.length + 1}`));
    touch();
    reopen();
  }));
  return wrap;
}

function openNested(field: Field, onChange: () => void): void {
  const box = document.createElement("div");
  box.className = "panel";
  const head = document.createElement("div");
  head.className = "panel-head";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = t("dialog.nested", { name: field.name });
  head.append(title);
  const body = document.createElement("div");
  body.className = "panel-body";
  const foot = document.createElement("div");
  foot.className = "panel-foot";
  const redraw = () => {
    body.replaceChildren();
    body.append(help(t("help.nested")));
    const kind = document.createElement("div");
    kind.className = "tabs";
    for (const name of ["scalar", "object", "array"] as const) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = t(`nested.${name}`);
      const current = field.nested?.kind ?? "scalar";
      btn.classList.toggle("active", current === name);
      btn.onclick = () => {
        if (name === "scalar") field.nested = null;
        else if (name === "object") field.nested = field.nested?.kind === "object" ? field.nested : { kind: "object", fields: [] };
        else field.nested = field.nested?.kind === "array" ? field.nested : { kind: "array", of: null, comment: "" };
        onChange();
        redraw();
      };
      kind.append(btn);
    }
    body.append(kind);
    if (field.nested?.kind === "object") body.append(nestedObjectEditor(field.nested, redraw, onChange));
    if (field.nested?.kind === "array") body.append(nestedArrayEditor(field.nested, redraw, onChange));
  };
  foot.append(action(t("action.close"), () => {
    $("overlay").replaceChildren(box.parentElement ? findDetailPanel() : box);
    /* close only this nested layer by restoring detail */
    openDetail(findEntityId(field));
  }));
  box.append(head, body, foot);
  redraw();
  $("overlay").replaceChildren(box);
}

function findEntityId(field: Field): string {
  for (const entity of app.doc.entities) {
    if (containsField(entity.columns, field.id)) return entity.id;
  }
  return app.doc.entities[0]?.id ?? "";
}

function containsField(fields: Field[], id: string): boolean {
  for (const field of fields) {
    if (field.id === id) return true;
    if (field.nested && nestedHas(field.nested, id)) return true;
  }
  return false;
}

function nestedHas(node: NestedNode, id: string): boolean {
  if (node.kind === "array") return node.of ? nestedHas(node.of, id) : false;
  return containsField(node.fields, id);
}

function findDetailPanel(): HTMLElement {
  return document.createElement("div");
}

function nestedObjectEditor(node: Extract<NestedNode, { kind: "object" }>, redraw: () => void, onChange: () => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "nested-box";
  const table = document.createElement("table");
  table.className = "data";
  table.innerHTML = `<thead><tr><th>${t("col.name")}</th><th>${t("col.type")}</th><th>${t("col.nullable")}</th><th>${t("col.nested")}</th><th></th></tr></thead>`;
  const body = document.createElement("tbody");
  for (const field of node.fields) {
    const tr = document.createElement("tr");
    tr.append(cellInput(field.name, (v) => { field.name = v; onChange(); }));
    tr.append(cellSelect(app.settings.dataTypes.map((t) => [t.id, t.name]), field.dataTypeId, (v) => { field.dataTypeId = v; onChange(); }));
    const n = document.createElement("input");
    n.type = "checkbox";
    n.checked = field.nullable;
    n.onchange = () => { field.nullable = n.checked; onChange(); };
    const nc = document.createElement("td");
    nc.append(n);
    tr.append(nc);
    const nest = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mini-btn";
    btn.textContent = field.nested ? t(`nested.${field.nested.kind}`) : t("nested.scalar");
    btn.onclick = () => openNested(field, () => { onChange(); redraw(); });
    nest.append(btn);
    tr.append(nest);
    tr.append(cellRemove(() => {
      node.fields = node.fields.filter((f) => f.id !== field.id);
      onChange();
      redraw();
    }));
    body.append(tr);
  }
  table.append(body);
  wrap.append(table, action(t("action.addColumn"), () => {
    node.fields.push(makeField(app.settings.dataTypes[0]?.id ?? "", "field"));
    onChange();
    redraw();
  }));
  return wrap;
}

function nestedArrayEditor(node: Extract<NestedNode, { kind: "array" }>, redraw: () => void, onChange: () => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "nested-box";
  wrap.append(help(t("help.array")));
  const form = document.createElement("div");
  form.className = "grid-form";
  addRow(form, t("field.comment"), textInput(node.comment, (v) => { node.comment = v; onChange(); }));
  const element = node.of?.kind ?? "scalar";
  addRow(form, t("field.element"), selectInput(
    [["scalar", t("nested.scalar")], ["object", t("nested.object")], ["array", t("nested.array")]],
    element,
    (v) => {
    if (v === "scalar") node.of = null;
    else if (v === "object") node.of = node.of?.kind === "object" ? node.of : { kind: "object", fields: [] };
    else node.of = node.of?.kind === "array" ? node.of : { kind: "array", of: null, comment: "" };
    onChange();
    redraw();
  }));
  wrap.append(form);
  if (node.of?.kind === "object") wrap.append(nestedObjectEditor(node.of, redraw, onChange));
  if (node.of?.kind === "array") wrap.append(nestedArrayEditor(node.of, redraw, onChange));
  return wrap;
}

function indexEditor(entity: Entity, reopen: () => void, noteLocal: () => void): HTMLElement {
  const wrap = document.createElement("div");
  for (const index of entity.indexes) {
    const box = document.createElement("div");
    box.className = "nested-box";
    const form = document.createElement("div");
    form.className = "grid-form";
    addRow(form, t("field.name"), textInput(index.name, (v) => { noteLocal(); index.name = v; touch(); }));
    const unique = document.createElement("input");
    unique.type = "checkbox";
    unique.checked = index.unique;
    unique.onchange = () => { noteLocal(); index.unique = unique.checked; touch(); };
    addRow(form, t("field.unique"), unique);
    addRow(form, t("field.comment"), textInput(index.comment, (v) => { noteLocal(); index.comment = v; touch(); }));
    box.append(form);
    box.append(columnChecks(entity, index.columnIds, (ids) => { index.columnIds = ids; touch(); }));
    box.append(action(t("action.removeIndex"), () => {
      noteLocal();
      entity.indexes = entity.indexes.filter((item) => item.id !== index.id);
      touch();
      reopen();
    }));
    wrap.append(box);
  }
  wrap.append(action(t("action.addIndex"), () => {
    noteLocal();
    entity.indexes.push({ id: uid("idx"), name: `${entity.name}_idx`, unique: false, columnIds: [], comment: "" });
    touch();
    reopen();
  }));
  return wrap;
}

function constraintEditor(entity: Entity, reopen: () => void, noteLocal: () => void): HTMLElement {
  const wrap = document.createElement("div");
  for (const constraint of entity.constraints) {
    const box = document.createElement("div");
    box.className = "nested-box";
    const form = document.createElement("div");
    form.className = "grid-form";
    addRow(form, t("field.name"), textInput(constraint.name, (v) => { noteLocal(); constraint.name = v; touch(); }));
    addRow(form, t("field.kind"), selectInput(CONSTRAINT_KINDS.map((k) => [k, t(`kind.${k}`)]), constraint.kind, (v) => {
      noteLocal();
      constraint.kind = v as ConstraintKind;
      touch();
    }));
    addRow(form, t("field.expression"), areaInput(constraint.expression, (v) => { noteLocal(); constraint.expression = v; touch(); }));
    addRow(form, t("field.comment"), textInput(constraint.comment, (v) => { noteLocal(); constraint.comment = v; touch(); }));
    box.append(form);
    box.append(columnChecks(entity, constraint.columnIds, (ids) => { constraint.columnIds = ids; touch(); }));
    box.append(action(t("action.removeConstraint"), () => {
      noteLocal();
      entity.constraints = entity.constraints.filter((item) => item.id !== constraint.id);
      touch();
      reopen();
    }));
    wrap.append(box);
  }
  wrap.append(action(t("action.addConstraint"), () => {
    noteLocal();
    entity.constraints.push({ id: uid("cst"), name: `${entity.name}_chk`, kind: "check", expression: "", columnIds: [], comment: "" });
    touch();
    reopen();
  }));
  return wrap;
}

function enumEditor(reopen: () => void, noteLocal: () => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.append(help(t("help.enums")));
  for (const item of app.doc.enums) {
    const box = document.createElement("div");
    box.className = "nested-box";
    const form = document.createElement("div");
    form.className = "grid-form";
    addRow(form, t("field.name"), textInput(item.name, (v) => { noteLocal(); item.name = v; touch(); }));
    addRow(form, t("field.values"), areaInput(item.values.join("\n"), (v) => {
      noteLocal();
      item.values = v.split("\n").map((line) => line.trim()).filter(Boolean);
      touch();
    }));
    addRow(form, t("field.comment"), textInput(item.comment, (v) => { noteLocal(); item.comment = v; touch(); }));
    box.append(form, action(t("action.removeEnum"), () => {
      noteLocal();
      app.doc.enums = app.doc.enums.filter((e) => e.id !== item.id);
      touch();
      reopen();
    }));
    wrap.append(box);
  }
  wrap.append(action(t("action.addEnum"), () => {
    noteLocal();
    app.doc.enums.push({ id: uid("enm"), name: t("default.enum"), values: [t("default.enumValue")], comment: "" });
    touch();
    reopen();
  }));
  return wrap;
}

function columnChecks(entity: Entity, selected: string[], onChange: (ids: string[]) => void): HTMLElement {
  const wrap = document.createElement("div");
  for (const column of entity.columns) {
    const label = document.createElement("label");
    label.style.display = "inline-flex";
    label.style.gap = "4px";
    label.style.marginRight = "8px";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selected.includes(column.id);
    input.onchange = () => {
      const next = new Set(selected);
      if (input.checked) next.add(column.id);
      else next.delete(column.id);
      onChange([...next]);
    };
    label.append(input, document.createTextNode(column.name));
    wrap.append(label);
  }
  return wrap;
}

interface PanelOptions {
  floating?: boolean;
  boxKey?: string;
}

const panelBoxes = new Map<string, { x: number; y: number; w: number; h: number }>();

function panelShell(titleText: string, onClose: () => void, options: PanelOptions = {}): HTMLElement {
  const panel = document.createElement("div");
  panel.className = options.floating ? "panel floating" : "panel";
  const head = document.createElement("div");
  head.className = "panel-head";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = titleText;
  const spacer = document.createElement("div");
  spacer.className = "spacer";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "tb-btn";
  close.textContent = t("action.close");
  close.title = t("dialog.closeCommits");
  close.onclick = onClose;
  head.append(title, spacer, close);
  const body = document.createElement("div");
  body.className = "panel-body";
  const foot = document.createElement("div");
  foot.className = "panel-foot";
  panel.append(head, body, foot);
  if (options.floating) attachResize(panel, options.boxKey ?? "panel");
  return panel;
}

function attachResize(panel: HTMLElement, key: string): void {
  const saved = panelBoxes.get(key);
  const width = saved?.w ?? Math.min(920, window.innerWidth - 36);
  const height = saved?.h ?? Math.min(640, window.innerHeight - 36);
  const x = saved?.x ?? Math.max(8, (window.innerWidth - width) / 2);
  const y = saved?.y ?? Math.max(8, (window.innerHeight - height) / 2);
  placePanel(panel, x, y, width, height);
  const edges = ["n", "s", "e", "w", "nw", "ne", "sw", "se"] as const;
  for (const edge of edges) {
    const handle = document.createElement("div");
    handle.className = `resize-handle ${edge}`;
    handle.addEventListener("pointerdown", (ev) => startResize(ev, panel, key, edge));
    panel.append(handle);
  }
  const head = panel.querySelector(".panel-head") as HTMLElement;
  head.style.cursor = "move";
  head.addEventListener("pointerdown", (ev) => {
    if ((ev.target as HTMLElement).closest("button")) return;
    startResize(ev, panel, key, "move");
  });
}

function placePanel(panel: HTMLElement, x: number, y: number, w: number, h: number): void {
  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
  panel.style.width = `${w}px`;
  panel.style.height = `${h}px`;
}

function startResize(ev: PointerEvent, panel: HTMLElement, key: string, edge: string): void {
  ev.preventDefault();
  ev.stopPropagation();
  const startX = ev.clientX;
  const startY = ev.clientY;
  const rect = panel.getBoundingClientRect();
  const minW = 360;
  const minH = 220;
  const move = (event: PointerEvent) => {
    let x = rect.left;
    let y = rect.top;
    let w = rect.width;
    let h = rect.height;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (edge === "move") {
      x += dx;
      y += dy;
    }
    if (edge.includes("e")) w += dx;
    if (edge.includes("s")) h += dy;
    if (edge.includes("w")) {
      w -= dx;
      x += dx;
    }
    if (edge.includes("n")) {
      h -= dy;
      y += dy;
    }
    if (w < minW) {
      if (edge.includes("w")) x -= minW - w;
      w = minW;
    }
    if (h < minH) {
      if (edge.includes("n")) y -= minH - h;
      h = minH;
    }
    x = Math.min(Math.max(0, x), window.innerWidth - 40);
    y = Math.min(Math.max(0, y), window.innerHeight - 40);
    placePanel(panel, x, y, w, h);
    panelBoxes.set(key, { x, y, w, h });
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function action(label: string, fn: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mini-btn";
  btn.textContent = label;
  btn.onclick = fn;
  return btn;
}

function help(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "help-line";
  el.textContent = text;
  return el;
}

function addRow(form: HTMLElement, labelText: string, control: HTMLElement): void {
  const label = document.createElement("label");
  label.textContent = labelText;
  const field = document.createElement("div");
  field.className = "field";
  field.append(control);
  form.append(label, field);
}

function textInput(value: string, onCommit: (v: string) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.value = value;
  const commit = () => onCommit(input.value);
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") input.blur();
  });
  return input;
}

function areaInput(value: string, onCommit: (v: string) => void): HTMLTextAreaElement {
  const input = document.createElement("textarea");
  input.value = value;
  const commit = () => onCommit(input.value);
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  return input;
}

function numberInput(value: number, min: number, max: number, onCommit: (v: number) => void, step = 1): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const commit = () => {
    const n = Number(input.value);
    if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
  };
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  return input;
}

function selectInput(options: [string, string][], value: string, onCommit: (v: string) => void): HTMLSelectElement {
  const select = document.createElement("select");
  for (const [id, label] of options) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    if (id === value) opt.selected = true;
    select.append(opt);
  }
  select.onchange = () => onCommit(select.value);
  return select;
}

function cellInput(value: string, onCommit: (v: string) => void): HTMLTableCellElement {
  const td = document.createElement("td");
  td.append(textInput(value, onCommit));
  return td;
}

function cellSelect(options: [string, string][], value: string, onCommit: (v: string) => void): HTMLTableCellElement {
  const td = document.createElement("td");
  td.append(selectInput(options, value, onCommit));
  return td;
}

function cellRemove(fn: () => void): HTMLTableCellElement {
  const td = document.createElement("td");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn danger";
  btn.textContent = "−";
  btn.onclick = fn;
  td.append(btn);
  return td;
}

function showToast(text: string): void {
  const toast = $("toast");
  toast.textContent = text;
  toast.classList.remove("hidden");
  window.clearTimeout(app.toastTimer);
  app.toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 3200);
}

boot();

interface ProbeApi {
  add(typeId?: string): string;
  rename(entityId: string, name: string): void;
  addColumn(entityId: string): void;
  cycleKey(entityId: string, columnId: string): void;
  relate(card: Cardinality, sourceEntityId: string, sourceColumnId: string, targetEntityId: string, targetColumnId: string): void;
  undo(): void;
  redo(): void;
  fit(): void;
  setTheme(theme: ThemeId): void;
  setLanguage(id: string): void;
  setRouting(style: EdgeRouting): void;
  load(text: string): void;
  prompt(): string;
  snapshot(): string;
  counts(): { entities: number; relations: number; warnings: number };
}

const probe: ProbeApi = {
  add(typeId = "table") {
    let id = "";
    mutate((doc) => {
      const entity = makeEntity(typeId, app.settings.dataTypes[0]?.id ?? "", { x: 80 + doc.entities.length * 30, y: 80 }, uniqueName(doc, "entity"));
      doc.entities.push(entity);
      id = entity.id;
      app.selected = new Set([id]);
    });
    return id;
  },
  rename(entityId, name) {
    mutate((doc) => {
      const entity = doc.entities.find((e) => e.id === entityId);
      if (entity) entity.name = name;
    });
  },
  addColumn(entityId) {
    mutate((doc) => {
      const entity = doc.entities.find((e) => e.id === entityId);
      if (entity) entity.columns.push(makeField(app.settings.dataTypes[0]?.id ?? "", `col_${entity.columns.length + 1}`));
    });
  },
  cycleKey(entityId, columnId) {
    mutate((doc) => {
      const column = doc.entities.find((e) => e.id === entityId)?.columns.find((c) => c.id === columnId);
      if (!column) return;
      column.key = column.key === null ? "P" : column.key === "P" ? "F" : null;
    });
  },
  relate(card, sourceEntityId, sourceColumnId, targetEntityId, targetColumnId) {
    app.tool = card;
    pickRelationEnd(sourceEntityId, sourceColumnId);
    pickRelationEnd(targetEntityId, targetColumnId);
  },
  undo,
  redo,
  fit,
  setTheme(theme) {
    app.settings.ui.theme = theme;
    saveSettings();
  },
  setLanguage(id: string) {
    app.settings.ui.language = id;
    saveSettings();
    applyLanguage(id);
  },
  setRouting(style) {
    app.settings.ui.edgeRouting = style;
    saveSettings();
  },
  load(text) {
    adoptText(text, "probe.schematic.json", null);
  },
  prompt() {
    return schemaToPrompt(app.doc, app.settings);
  },
  snapshot() {
    return serialize(app.doc);
  },
  counts() {
    const warnings = computeWarnings(app.doc);
    return {
      entities: app.doc.entities.length,
      relations: app.doc.relations.length,
      warnings: warnings.badKeyColumns.size + warnings.badNullColumns.size,
    };
  },
};

(window as unknown as { __schematic: ProbeApi }).__schematic = probe;
