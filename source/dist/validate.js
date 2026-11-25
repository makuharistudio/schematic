import { CARDINALITIES, CONSTRAINT_KINDS, FORMAT_VERSION, SCHEMA_KIND, SETTINGS_KIND } from "./types.js";
export class FormatError extends Error {
    constructor(message) {
        super(message);
        this.name = "FormatError";
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
}
function num(value, fallback = 0) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function bool(value, fallback = false) {
    return typeof value === "boolean" ? value : fallback;
}
function keyMark(value) {
    return value === "P" || value === "F" ? value : null;
}
function cardinality(value) {
    return CARDINALITIES.includes(value) ? value : "only-one";
}
function theme(value) {
    if (value === "hc")
        return "hc-green";
    const allowed = ["light", "dark", "horizon", "hc-green", "hc-blue", "hc-orange"];
    return allowed.includes(value) ? value : "dark";
}
function routing(value) {
    return value === "straight" || value === "orthogonal" || value === "curved" ? value : "orthogonal";
}
function constraintKind(value) {
    return CONSTRAINT_KINDS.includes(value) ? value : "other";
}
function readNested(value, depth) {
    if (!isRecord(value) || depth > 32)
        return null;
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
function readField(value, depth = 0) {
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
export function parseSchema(value) {
    if (!isRecord(value))
        throw new FormatError("Schema file is not a JSON object.");
    if (value.kind !== SCHEMA_KIND)
        throw new FormatError(`Expected kind "${SCHEMA_KIND}".`);
    if (value.version !== FORMAT_VERSION)
        throw new FormatError(`Unsupported schema version ${String(value.version)}.`);
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
    };
}
export function parseSettings(value, fallback) {
    if (!isRecord(value))
        throw new FormatError("Settings file is not a JSON object.");
    if (value.kind !== SETTINGS_KIND)
        throw new FormatError(`Expected kind "${SETTINGS_KIND}".`);
    if (value.version !== FORMAT_VERSION)
        throw new FormatError(`Unsupported settings version ${String(value.version)}.`);
    const ui = isRecord(value.ui) ? value.ui : {};
    const databases = Array.isArray(value.databases)
        ? value.databases.filter(isRecord).map((db) => ({ id: str(db.id), name: str(db.name, "database") })).filter((db) => db.id)
        : fallback.databases;
    const primitives = Array.isArray(value.primitives)
        ? value.primitives.filter((p) => typeof p === "string" && p.length > 0)
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
        },
    };
}
