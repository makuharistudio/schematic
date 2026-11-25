import { t } from "./i18n.js";
import type { Field, NestedNode, SchemaDoc, SettingsDoc } from "./types.js";

function typeName(settings: SettingsDoc, id: string): string {
  return settings.dataTypes.find((t) => t.id === id)?.name ?? (id || "untyped");
}

function keyLabel(field: Field): string {
  if (field.key === "P") return t("prompt.primaryKey");
  if (field.key === "F") return t("prompt.foreignKey");
  return t("prompt.notKey");
}

function nullLabel(field: Field): string {
  return field.nullable ? t("prompt.nullable") : t("prompt.notNull");
}

function indent(level: number): string {
  return "  ".repeat(level);
}

function writeNested(node: NestedNode, settings: SettingsDoc, level: number, lines: string[]): void {
  if (node.kind === "array") {
    lines.push(`${indent(level)}- ${t("prompt.array")}${node.comment ? ` — ${node.comment}` : ""}`);
    if (node.of) writeNested(node.of, settings, level + 1, lines);
    else lines.push(`${indent(level + 1)}- ${t("prompt.scalarElement")}`);
    return;
  }
  lines.push(`${indent(level)}- ${t("prompt.object")}`);
  if (node.fields.length === 0) {
    lines.push(`${indent(level + 1)}- ${t("prompt.noFields")}`);
    return;
  }
  for (const field of node.fields) writeField(field, settings, level + 1, lines);
}

function writeField(field: Field, settings: SettingsDoc, level: number, lines: string[]): void {
  const flags = [keyLabel(field), nullLabel(field)];
  if (field.unique) flags.push(t("prompt.unique"));
  if (field.defaultValue) flags.push(t("prompt.default", { value: field.defaultValue }));
  lines.push(
    `${indent(level)}- ${field.name}: ${typeName(settings, field.dataTypeId)} (${flags.join(", ")})${field.comment ? ` — ${field.comment}` : ""}`,
  );
  if (field.nested) writeNested(field.nested, settings, level + 1, lines);
}

export function schemaToPrompt(doc: SchemaDoc, settings: SettingsDoc): string {
  const lines: string[] = [];
  lines.push(`# ${t("prompt.schemaTitle", { name: doc.meta.name || t("file.untitledName") })}`);
  if (doc.meta.comment) lines.push("", doc.meta.comment);
  lines.push("", t("prompt.intro"));

  const typeNameOf = (id: string) => {
    const stored = settings.entityTypes.find((item) => item.id === id)?.name ?? id;
    const label = t(`entity.${id}`);
    return label === `entity.${id}` ? stored : label;
  };

  lines.push("", `## ${t("prompt.entities")}`);
  if (doc.entities.length === 0) lines.push("", t("prompt.none"));
  for (const entity of doc.entities) {
    lines.push("", `### ${entity.name} (${typeNameOf(entity.typeId)})`);
    if (entity.comment) lines.push(entity.comment);
    lines.push("", t("prompt.columns"));
    if (entity.columns.length === 0) lines.push(`- ${t("prompt.none")}`);
    for (const column of entity.columns) writeField(column, settings, 0, lines);
    if (entity.indexes.length) {
      lines.push("", t("prompt.indexes"));
      for (const index of entity.indexes) {
        const cols = index.columnIds
          .map((id) => entity.columns.find((c) => c.id === id)?.name ?? id)
          .join(", ");
        lines.push(`- ${index.name}${index.unique ? " UNIQUE" : ""} (${cols || t("prompt.noColumns")})${index.comment ? ` — ${index.comment}` : ""}`);
      }
    }
    if (entity.constraints.length) {
      lines.push("", t("prompt.constraints"));
      for (const constraint of entity.constraints) {
        const cols = constraint.columnIds
          .map((id) => entity.columns.find((c) => c.id === id)?.name ?? id)
          .filter(Boolean)
          .join(", ");
        lines.push(
          `- ${constraint.name} [${t(`kind.${constraint.kind}`)}]${cols ? ` (${cols})` : ""}${constraint.expression ? `: ${constraint.expression}` : ""}${constraint.comment ? ` — ${constraint.comment}` : ""}`,
        );
      }
    }
  }

  lines.push("", `## ${t("prompt.relations")}`);
  if (doc.relations.length === 0) lines.push("", t("prompt.none"));
  for (const relation of doc.relations) {
    const source = doc.entities.find((e) => e.id === relation.sourceEntityId);
    const target = doc.entities.find((e) => e.id === relation.targetEntityId);
    const sCol = source?.columns.find((c) => c.id === relation.sourceColumnId);
    const tCol = target?.columns.find((c) => c.id === relation.targetColumnId);
    lines.push(
      "",
      `- ${source?.name ?? relation.sourceEntityId}.${sCol?.name ?? relation.sourceColumnId} → ${target?.name ?? relation.targetEntityId}.${tCol?.name ?? relation.targetColumnId}`,
    );
    lines.push(`  ${t("prompt.cardinality", { value: t(`card.${relation.cardinality}`) })}`);
    lines.push(`  ${t("prompt.sides")}`);
    if (relation.onDelete) lines.push(`  ${t("prompt.onDelete", { value: relation.onDelete })}`);
    if (relation.onUpdate) lines.push(`  ${t("prompt.onUpdate", { value: relation.onUpdate })}`);
    if (relation.comment) lines.push(`  ${t("prompt.note", { value: relation.comment })}`);
  }

  lines.push("", `## ${t("prompt.enums")}`);
  if (doc.enums.length === 0) lines.push("", t("prompt.none"));
  for (const item of doc.enums) {
    lines.push("", `- ${item.name}: ${item.values.join(", ") || t("prompt.noValues")}${item.comment ? ` — ${item.comment}` : ""}`);
  }

  lines.push("");
  return lines.join("\n");
}
