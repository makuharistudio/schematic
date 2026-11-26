import { CARDINALITIES, CONSTRAINT_KINDS, FORMAT_VERSION, LAYOUT_IDS, SCHEMA_KIND, SETTINGS_KIND } from "./types.js";
import type {
  Cardinality,
  ConstraintKind,
  EdgeRouting,
  Field,
  KeyMark,
  LayoutId,
  NestedNode,
  Point,
  SchemaDoc,
  SettingsDoc,
  ThemeId,
} from "./types.js";

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function keyMark(value: unknown): KeyMark {
  return value === "P" || value === "F" ? value : null;
}

function cardinality(value: unknown): Cardinality {
  return CARDINALITIES.includes(value as Cardinality) ? (value as Cardinality) : "only-one";
}

function theme(value: unknown): ThemeId {
  if (value === "hc") return "hc-green";
  const allowed: ThemeId[] = ["light", "dark", "horizon", "hc-green", "hc-blue", "hc-orange"];
  return allowed.includes(value as ThemeId) ? (value as ThemeId) : "dark";
}

function routing(value: unknown): EdgeRouting {
  return value === "straight" || value === "orthogonal" || value === "curved" ? value : "orthogonal";
}

function constraintKind(value: unknown): ConstraintKind {
  return CONSTRAINT_KINDS.includes(value as ConstraintKind) ? (value as ConstraintKind) : "other";
}

function layoutId(value: unknown): LayoutId {
  return LAYOUT_IDS.includes(value as LayoutId) ? (value as LayoutId) : "Custom";
}

function readPoint(value: unknown): Point | null {
  if (!isRecord(value)) return null;
  if (typeof value.x !== "number" || typeof value.y !== "number") return null;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return { x: value.x, y: value.y };
}

function readPositions(value: unknown): Record<string, Point> {
  if (!isRecord(value)) return {};
  const positions: Record<string, Point> = {};
  for (const [id, point] of Object.entries(value)) {
    const read = readPoint(point);
    if (read) positions[id] = read;
  }
  return positions;
}

function readNested(value: unknown, depth: number): NestedNode | null {
  if (!isRecord(value) || depth > 32) return null;
  if (value.kind === "array") {
    return {
      kind: "array",
      of: readNested(value.of, depth + 1),
      comment: str(value.comment),
    };
  }
  if (value.kind === "object") {
    const fields = Array.isArray(value.fields) ? value.fields.map((f) => readField(f, depth + 1)) : [];
    return { kind: "object", fields };
  }
  return null;
}

function readField(value: unknown, depth = 0): Field {
  const raw = isRecord(value) ? value : {};
  return {
    id: str(raw.id) || `col_import_${Math.random().toString(36).slice(2, 8)}`,
    name: str(raw.name, "column"),
    dataTypeId: str(raw.dataTypeId),
    key: keyMark(raw.key),
    nullable: bool(raw.nullable, true),
    comment: str(raw.comment),
    defaultValue: str(raw.defaultValue),
    unique: bool(raw.unique, false),
    nested: readNested(raw.nested, depth),
  };
}

export function parseSchema(value: unknown): SchemaDoc {
  if (!isRecord(value)) throw new FormatError("Schema file is not a JSON object.");
  if (value.kind !== SCHEMA_KIND) throw new FormatError(`Expected kind "${SCHEMA_KIND}".`);
  if (value.version !== FORMAT_VERSION) throw new FormatError(`Unsupported schema version ${String(value.version)}.`);
  const meta = isRecord(value.meta) ? value.meta : {};
  const entities = Array.isArray(value.entities) ? value.entities : [];
  const relations = Array.isArray(value.relations) ? value.relations : [];
  const enums = Array.isArray(value.enums) ? value.enums : [];
  return {
    kind: SCHEMA_KIND,
    version: FORMAT_VERSION,
    meta: {
      name: str(meta.name, "untitled"),
      comment: str(meta.comment),
      updatedAt: str(meta.updatedAt),
    },
    entities: entities.filter(isRecord).map((raw) => ({
      id: str(raw.id) || `ent_import_${Math.random().toString(36).slice(2, 8)}`,
      typeId: str(raw.typeId, "table"),
      name: str(raw.name, "entity"),
      position: {
        x: num(isRecord(raw.position) ? raw.position.x : 0),
        y: num(isRecord(raw.position) ? raw.position.y : 0),
      },
      collapsed: bool(raw.collapsed, false),
      comment: str(raw.comment),
      color: str(raw.color),
      columns: Array.isArray(raw.columns) ? raw.columns.map((c) => readField(c)) : [],
      indexes: Array.isArray(raw.indexes)
        ? raw.indexes.filter(isRecord).map((idx) => ({
            id: str(idx.id) || `idx_${Math.random().toString(36).slice(2, 8)}`,
            name: str(idx.name, "index"),
            unique: bool(idx.unique, false),
            columnIds: Array.isArray(idx.columnIds) ? idx.columnIds.filter((id) => typeof id === "string") : [],
            comment: str(idx.comment),
          }))
        : [],
      constraints: Array.isArray(raw.constraints)
        ? raw.constraints.filter(isRecord).map((cst) => ({
            id: str(cst.id) || `cst_${Math.random().toString(36).slice(2, 8)}`,
            name: str(cst.name, "constraint"),
            kind: constraintKind(cst.kind),
            expression: str(cst.expression),
            columnIds: Array.isArray(cst.columnIds) ? cst.columnIds.filter((id) => typeof id === "string") : [],
            comment: str(cst.comment),
          }))
        : [],
    })),
    relations: relations.filter(isRecord).map((raw) => {
      const route = isRecord(raw.routing) ? raw.routing : {};
      const points = Array.isArray(route.points)
        ? route.points.filter(isRecord).map((p) => ({ x: num(p.x), y: num(p.y) }))
        : [];
      return {
        id: str(raw.id) || `rel_${Math.random().toString(36).slice(2, 8)}`,
        sourceEntityId: str(raw.sourceEntityId),
        sourceColumnId: str(raw.sourceColumnId),
        targetEntityId: str(raw.targetEntityId),
        targetColumnId: str(raw.targetColumnId),
        cardinality: cardinality(raw.cardinality),
        onDelete: str(raw.onDelete),
        onUpdate: str(raw.onUpdate),
        comment: str(raw.comment),
        routing: { points, manual: bool(route.manual, false) },
      };
    }),
    enums: enums.filter(isRecord).map((raw) => ({
      id: str(raw.id) || `enm_${Math.random().toString(36).slice(2, 8)}`,
      name: str(raw.name, "enum"),
      values: Array.isArray(raw.values) ? raw.values.filter((v) => typeof v === "string") : [],
      comment: str(raw.comment),
    })),
    activeLayout: layoutId(value.activeLayout),
    layouts: readLayouts(value.layouts),
  };
}

function readLayouts(value: unknown): SchemaDoc["layouts"] {
  const raw = isRecord(value) ? value : {};
  const layouts = {} as NonNullable<SchemaDoc["layouts"]>;
  for (const id of LAYOUT_IDS) {
    const entry = isRecord(raw[id]) ? raw[id] : {};
    layouts[id] = { positions: readPositions(entry.positions) };
  }
  return layouts;
}

export function parseSettings(value: unknown, fallback: SettingsDoc): SettingsDoc {
  if (!isRecord(value)) throw new FormatError("Settings file is not a JSON object.");
  if (value.kind !== SETTINGS_KIND) throw new FormatError(`Expected kind "${SETTINGS_KIND}".`);
  if (value.version !== FORMAT_VERSION) throw new FormatError(`Unsupported settings version ${String(value.version)}.`);
  const ui = isRecord(value.ui) ? value.ui : {};
  const databases = Array.isArray(value.databases)
    ? value.databases.filter(isRecord).map((db) => ({ id: str(db.id), name: str(db.name, "database") })).filter((db) => db.id)
    : fallback.databases;
  const primitives = Array.isArray(value.primitives)
    ? value.primitives.filter((p): p is string => typeof p === "string" && p.length > 0)
    : fallback.primitives;
  const dataTypes = Array.isArray(value.dataTypes)
    ? value.dataTypes.filter(isRecord).map((dt) => ({
        id: str(dt.id),
        name: str(dt.name, "type"),
        primitive: str(dt.primitive, primitives[0] ?? "other"),
        maxByteSize: typeof dt.maxByteSize === "number" ? dt.maxByteSize : null,
        databaseId: str(dt.databaseId),
      })).filter((dt) => dt.id)
    : fallback.dataTypes;
  const entityTypes = Array.isArray(value.entityTypes)
    ? value.entityTypes.filter(isRecord).map((et) => ({
        id: str(et.id),
        name: str(et.name, "Entity"),
        plural: str(et.plural, "Entities"),
      })).filter((et) => et.id)
    : fallback.entityTypes;
  return {
    kind: SETTINGS_KIND,
    version: FORMAT_VERSION,
    databases: databases.length ? databases : fallback.databases,
    primitives: primitives.length ? primitives : fallback.primitives,
    dataTypes: dataTypes.length ? dataTypes : fallback.dataTypes,
    entityTypes: entityTypes.length ? entityTypes : fallback.entityTypes,
    ui: {
      fontSize: Math.min(18, Math.max(9, num(ui.fontSize, fallback.ui.fontSize))),
      theme: theme(ui.theme),
      language: str(ui.language, fallback.ui.language || "en-US"),
      zoomSensitivity: Math.min(3, Math.max(0.2, num(ui.zoomSensitivity, fallback.ui.zoomSensitivity))),
      panSensitivity: Math.min(3, Math.max(0.2, num(ui.panSensitivity, fallback.ui.panSensitivity))),
      edgeRouting: routing(ui.edgeRouting),
      showMinimap: bool(ui.showMinimap, fallback.ui.showMinimap),
      showGrid: bool(ui.showGrid, fallback.ui.showGrid),
      snapToGrid: bool(ui.snapToGrid, fallback.ui.snapToGrid),
    },
  };
}
