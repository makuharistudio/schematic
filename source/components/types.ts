/** Locked document shapes. See memory-bank.md. */

export const SCHEMA_KIND = "schematic.schema";
export const SETTINGS_KIND = "schematic.settings";
export const FORMAT_VERSION = 1;

export type KeyMark = "P" | "F" | null;
export type Cardinality = "zero-or-one" | "zero-or-many" | "only-one" | "one-or-many";
export type ThemeId = "light" | "dark" | "horizon" | "hc-green" | "hc-blue" | "hc-orange";
export type EdgeRouting = "straight" | "orthogonal" | "curved";
export type ConstraintKind = "check" | "unique" | "primary" | "foreign" | "exclude" | "other";
export type LayoutId = "Custom" | "Hierarchical" | "ForceDirected" | "Circular";

export interface Point {
  x: number;
  y: number;
}

export interface NestedArray {
  kind: "array";
  of: NestedNode | null;
  comment: string;
}

export interface NestedObject {
  kind: "object";
  fields: Field[];
}

export type NestedNode = NestedObject | NestedArray;

export interface Field {
  id: string;
  name: string;
  dataTypeId: string;
  key: KeyMark;
  nullable: boolean;
  comment: string;
  defaultValue: string;
  unique: boolean;
  nested: NestedNode | null;
}

export interface IndexDef {
  id: string;
  name: string;
  unique: boolean;
  columnIds: string[];
  comment: string;
}

export interface ConstraintDef {
  id: string;
  name: string;
  kind: ConstraintKind;
  expression: string;
  columnIds: string[];
  comment: string;
}

export interface Entity {
  id: string;
  typeId: string;
  name: string;
  position: Point;
  collapsed: boolean;
  comment: string;
  color: string;
  columns: Field[];
  indexes: IndexDef[];
  constraints: ConstraintDef[];
}

export interface RelationRouting {
  points: Point[];
  manual: boolean;
}

export interface Relation {
  id: string;
  sourceEntityId: string;
  sourceColumnId: string;
  targetEntityId: string;
  targetColumnId: string;
  cardinality: Cardinality;
  onDelete: string;
  onUpdate: string;
  comment: string;
  routing: RelationRouting;
}

export interface EnumDef {
  id: string;
  name: string;
  values: string[];
  comment: string;
}

export interface SchemaMeta {
  name: string;
  comment: string;
  updatedAt: string;
}

/** One layout's entity positions. Edge routing stays on each relation, not here. */
export interface LayoutPositions {
  positions: Record<string, Point>;
}

export interface SchemaDoc {
  kind: typeof SCHEMA_KIND;
  version: number;
  meta: SchemaMeta;
  entities: Entity[];
  relations: Relation[];
  enums: EnumDef[];
  /** Active layout. Missing on older files; treated as Custom. */
  activeLayout?: LayoutId;
  /** Per-layout entity positions. Missing on older files; filled from entity.position. */
  layouts?: Record<LayoutId, LayoutPositions>;
}

export const LAYOUT_IDS: LayoutId[] = ["Custom", "Hierarchical", "ForceDirected", "Circular"];

export interface DatabaseDef {
  id: string;
  name: string;
}

export interface DataTypeDef {
  id: string;
  name: string;
  primitive: string;
  maxByteSize: number | null;
  databaseId: string;
}

export interface EntityTypeDef {
  id: string;
  name: string;
  plural: string;
}

export interface UiPrefs {
  fontSize: number;
  theme: ThemeId;
  language: string;
  zoomSensitivity: number;
  panSensitivity: number;
  edgeRouting: EdgeRouting;
  showMinimap: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
}

export interface SettingsDoc {
  kind: typeof SETTINGS_KIND;
  version: number;
  databases: DatabaseDef[];
  primitives: string[];
  dataTypes: DataTypeDef[];
  entityTypes: EntityTypeDef[];
  ui: UiPrefs;
}

export const CARDINALITIES: Cardinality[] = [
  "zero-or-one",
  "zero-or-many",
  "only-one",
  "one-or-many",
];

export const CARDINALITY_LABEL: Record<Cardinality, string> = {
  "zero-or-one": "zero or one",
  "zero-or-many": "zero or many",
  "only-one": "only one",
  "one-or-many": "one or many",
};

export const CONSTRAINT_KINDS: ConstraintKind[] = [
  "check",
  "unique",
  "primary",
  "foreign",
  "exclude",
  "other",
];
