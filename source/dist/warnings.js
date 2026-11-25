/**
 * A relation is a valid key pair only when one end is P and the other is F.
 * The create gesture treats source as the key side and target as the FK side,
 * so the expected pair is source P + target F. Either orientation is accepted
 * so a hand-edited pair still validates.
 */
export function computeWarnings(doc) {
    const badKey = new Set();
    const badNull = new Set();
    const columnOf = (entityId, columnId) => {
        const entity = doc.entities.find((e) => e.id === entityId);
        return entity?.columns.find((c) => c.id === columnId) ?? null;
    };
    for (const relation of doc.relations) {
        const source = columnOf(relation.sourceEntityId, relation.sourceColumnId);
        const target = columnOf(relation.targetEntityId, relation.targetColumnId);
        if (!source || !target)
            continue;
        const pair = `${source.key ?? "-"}${target.key ?? "-"}`;
        if (pair !== "PF" && pair !== "FP") {
            badKey.add(columnKey(relation.sourceEntityId, source.id));
            badKey.add(columnKey(relation.targetEntityId, target.id));
        }
    }
    for (const entity of doc.entities) {
        for (const column of entity.columns) {
            if ((column.key === "P" || column.key === "F") && column.nullable) {
                badNull.add(columnKey(entity.id, column.id));
            }
        }
    }
    return { badKeyColumns: badKey, badNullColumns: badNull };
}
export function columnKey(entityId, columnId) {
    return `${entityId}:${columnId}`;
}
export function relationTouches(relation, entityId, columnId) {
    return ((relation.sourceEntityId === entityId && relation.sourceColumnId === columnId) ||
        (relation.targetEntityId === entityId && relation.targetColumnId === columnId));
}
