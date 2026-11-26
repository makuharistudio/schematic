import { SCHEMA_KIND, SETTINGS_KIND, FORMAT_VERSION } from "./types.js";
import type {
  DataTypeDef,
  DatabaseDef,
  Entity,
  EntityTypeDef,
  Field,
  SchemaDoc,
  SettingsDoc,
} from "./types.js";
import { uid } from "./ids.js";

export const PRIMITIVES = [
  "string",
  "number",
  "integer",
  "boolean",
  "binary",
  "datetime",
  "json",
  "uuid",
  "enum",
  "other",
];

interface TypeSeed {
  name: string;
  primitive: string;
  maxByteSize: number | null;
}

const PG_TYPES: TypeSeed[] = [
  { name: "int2", primitive: "integer", maxByteSize: 2 },
  { name: "int4", primitive: "integer", maxByteSize: 4 },
  { name: "int8", primitive: "integer", maxByteSize: 8 },
  { name: "smallint", primitive: "integer", maxByteSize: 2 },
  { name: "integer", primitive: "integer", maxByteSize: 4 },
  { name: "bigint", primitive: "integer", maxByteSize: 8 },
  { name: "serial", primitive: "integer", maxByteSize: 4 },
  { name: "bigserial", primitive: "integer", maxByteSize: 8 },
  { name: "numeric", primitive: "number", maxByteSize: null },
  { name: "decimal", primitive: "number", maxByteSize: null },
  { name: "real", primitive: "number", maxByteSize: 4 },
  { name: "float4", primitive: "number", maxByteSize: 4 },
  { name: "double precision", primitive: "number", maxByteSize: 8 },
  { name: "float8", primitive: "number", maxByteSize: 8 },
  { name: "money", primitive: "number", maxByteSize: 8 },
  { name: "boolean", primitive: "boolean", maxByteSize: 1 },
  { name: "char", primitive: "string", maxByteSize: 1 },
  { name: "varchar", primitive: "string", maxByteSize: null },
  { name: "character varying", primitive: "string", maxByteSize: null },
  { name: "text", primitive: "string", maxByteSize: null },
  { name: "citext", primitive: "string", maxByteSize: null },
  { name: "name", primitive: "string", maxByteSize: 64 },
  { name: "bytea", primitive: "binary", maxByteSize: null },
  { name: "date", primitive: "datetime", maxByteSize: 4 },
  { name: "time", primitive: "datetime", maxByteSize: 8 },
  { name: "timetz", primitive: "datetime", maxByteSize: 12 },
  { name: "timestamp", primitive: "datetime", maxByteSize: 8 },
  { name: "timestamptz", primitive: "datetime", maxByteSize: 8 },
  { name: "interval", primitive: "datetime", maxByteSize: 16 },
  { name: "uuid", primitive: "uuid", maxByteSize: 16 },
  { name: "json", primitive: "json", maxByteSize: null },
  { name: "jsonb", primitive: "json", maxByteSize: null },
  { name: "xml", primitive: "string", maxByteSize: null },
  { name: "inet", primitive: "string", maxByteSize: null },
  { name: "cidr", primitive: "string", maxByteSize: null },
  { name: "macaddr", primitive: "string", maxByteSize: 6 },
  { name: "macaddr8", primitive: "string", maxByteSize: 8 },
  { name: "bit", primitive: "binary", maxByteSize: null },
  { name: "varbit", primitive: "binary", maxByteSize: null },
  { name: "point", primitive: "other", maxByteSize: 16 },
  { name: "line", primitive: "other", maxByteSize: 24 },
  { name: "lseg", primitive: "other", maxByteSize: 32 },
  { name: "box", primitive: "other", maxByteSize: 32 },
  { name: "path", primitive: "other", maxByteSize: null },
  { name: "polygon", primitive: "other", maxByteSize: null },
  { name: "circle", primitive: "other", maxByteSize: 24 },
  { name: "tsvector", primitive: "other", maxByteSize: null },
  { name: "tsquery", primitive: "other", maxByteSize: null },
  { name: "array", primitive: "other", maxByteSize: null },
  { name: "oid", primitive: "integer", maxByteSize: 4 },
  { name: "enum", primitive: "enum", maxByteSize: 4 },
];

export const DATABASES: DatabaseDef[] = [
  { id: "postgresql", name: "PostgreSQL" },
  { id: "mssql", name: "MSSQL" },
  { id: "oracle", name: "Oracle" },
  { id: "mysql", name: "MySQL" },
  { id: "mariadb", name: "MariaDB" },
  { id: "sqlite", name: "SQLite" },
  { id: "mongodb", name: "MongoDB" },
  { id: "cassandra", name: "Cassandra" },
  { id: "neo4j", name: "Neo4j" },
  { id: "generic", name: "Generic" },
];

export const ENTITY_TYPES: EntityTypeDef[] = [
  { id: "table", name: "Table", plural: "Tables" },
  { id: "view", name: "View", plural: "Views" },
  { id: "collection", name: "Collection", plural: "Collections" },
  { id: "document", name: "Document", plural: "Documents" },
  { id: "vertex", name: "Vertex", plural: "Vertices" },
  { id: "node", name: "Graph node", plural: "Graph nodes" },
  { id: "edge", name: "Graph edge", plural: "Graph edges" },
];

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function defaultDataTypes(): DataTypeDef[] {
  return PG_TYPES.map((seed) => ({
    id: `pg_${slug(seed.name)}`,
    name: seed.name,
    primitive: seed.primitive,
    maxByteSize: seed.maxByteSize,
    databaseId: "postgresql",
  }));
}

export function defaultSettings(): SettingsDoc {
  return {
    kind: SETTINGS_KIND,
    version: FORMAT_VERSION,
    databases: DATABASES.map((db) => ({ ...db })),
    primitives: [...PRIMITIVES],
    dataTypes: defaultDataTypes(),
    entityTypes: ENTITY_TYPES.map((t) => ({ ...t })),
    ui: {
      fontSize: 11,
      theme: "dark",
      language: "en-US",
      zoomSensitivity: 1,
      panSensitivity: 1,
      edgeRouting: "orthogonal",
      showMinimap: true,
      showGrid: true,
      snapToGrid: false,
    },
  };
}

export function emptySchema(name = "untitled"): SchemaDoc {
  return {
    kind: SCHEMA_KIND,
    version: FORMAT_VERSION,
    meta: { name, comment: "", updatedAt: new Date().toISOString() },
    entities: [],
    relations: [],
    enums: [],
    activeLayout: "Custom",
    layouts: {
      Custom: { positions: {} },
      Hierarchical: { positions: {} },
      ForceDirected: { positions: {} },
      Circular: { positions: {} },
    },
  };
}

export function makeField(dataTypeId: string, name = "column"): Field {
  return {
    id: uid("col"),
    name,
    dataTypeId,
    key: null,
    nullable: true,
    comment: "",
    defaultValue: "",
    unique: false,
    nested: null,
  };
}

export function makeEntity(
  typeId: string,
  dataTypeId: string,
  position: { x: number; y: number },
  name = "entity",
): Entity {
  const idCol = makeField(dataTypeId, "id");
  idCol.key = "P";
  idCol.nullable = false;
  return {
    id: uid("ent"),
    typeId,
    name,
    position: { x: position.x, y: position.y },
    collapsed: false,
    comment: "",
    color: "",
    columns: [idCol],
    indexes: [],
    constraints: [],
  };
}
