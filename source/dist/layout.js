import { LAYOUT_IDS } from "./types.js";
import { entityHeight, NODE_W } from "./geometry.js";
const GAP_X = 80;
const GAP_Y = 56;
const ORIGIN = 48;
/** Clear space required between entity boxes after an algorithmic layout. */
const MIN_GAP = 28;
export function emptyLayouts() {
    return {
        Custom: { positions: {} },
        Hierarchical: { positions: {} },
        ForceDirected: { positions: {} },
        Circular: { positions: {} },
    };
}
/** Fill missing layout maps from the live entity positions. Does not move entities. */
export function ensureLayouts(doc) {
    if (!doc.layouts)
        doc.layouts = emptyLayouts();
    for (const id of LAYOUT_IDS) {
        if (!doc.layouts[id] || typeof doc.layouts[id] !== "object" || !doc.layouts[id].positions) {
            doc.layouts[id] = { positions: {} };
        }
    }
    if (!doc.activeLayout || !LAYOUT_IDS.includes(doc.activeLayout))
        doc.activeLayout = "Custom";
    const custom = doc.layouts.Custom.positions;
    for (const entity of doc.entities) {
        if (!custom[entity.id])
            custom[entity.id] = { x: entity.position.x, y: entity.position.y };
    }
}
export function captureActive(doc) {
    ensureLayouts(doc);
    const id = doc.activeLayout ?? "Custom";
    const positions = doc.layouts[id].positions;
    for (const entity of doc.entities) {
        positions[entity.id] = { x: entity.position.x, y: entity.position.y };
    }
}
export function applyLayout(doc, id) {
    ensureLayouts(doc);
    captureActive(doc);
    doc.activeLayout = id;
    const stored = doc.layouts[id].positions;
    const known = doc.entities.every((entity) => Boolean(stored[entity.id]));
    if (id !== "Custom" && (Object.keys(stored).length === 0 || !known)) {
        writePositions(doc, id, computeLayout(doc, id));
    }
    for (const entity of doc.entities) {
        const point = doc.layouts[id].positions[entity.id];
        if (point)
            entity.position = { x: point.x, y: point.y };
    }
}
/** Re-run an algorithmic layout and replace only that layout's positions. */
export function resetLayout(doc, id) {
    if (id === "Custom")
        return;
    ensureLayouts(doc);
    writePositions(doc, id, computeLayout(doc, id));
    if ((doc.activeLayout ?? "Custom") === id) {
        for (const entity of doc.entities) {
            const point = doc.layouts[id].positions[entity.id];
            if (point)
                entity.position = { x: point.x, y: point.y };
        }
    }
}
export function noteEntity(doc, entity) {
    ensureLayouts(doc);
    const id = doc.activeLayout ?? "Custom";
    doc.layouts[id].positions[entity.id] = { x: entity.position.x, y: entity.position.y };
}
export function dropEntity(doc, entityId) {
    if (!doc.layouts)
        return;
    for (const id of LAYOUT_IDS)
        delete doc.layouts[id].positions[entityId];
}
function writePositions(doc, id, points) {
    doc.layouts[id] = { positions: points };
}
function sizes(entities) {
    const map = new Map();
    for (const entity of entities) {
        map.set(entity.id, { w: NODE_W, h: entityHeight(entity.collapsed, entity.columns.length) });
    }
    return map;
}
export function computeLayout(doc, id) {
    const box = sizes(doc.entities);
    if (id === "Hierarchical")
        return separate(hierarchical(doc.entities, doc.relations, box), box, "layer");
    if (id === "ForceDirected")
        return separate(forceDirected(doc.entities, doc.relations, box), box, "free");
    if (id === "Circular")
        return separate(circular(doc.entities, doc.relations, box), box, "radial");
    const positions = {};
    for (const entity of doc.entities)
        positions[entity.id] = { x: entity.position.x, y: entity.position.y };
    return positions;
}
function neighbors(entities, relations) {
    const map = new Map();
    for (const entity of entities)
        map.set(entity.id, new Set());
    for (const relation of relations) {
        map.get(relation.sourceEntityId)?.add(relation.targetEntityId);
        map.get(relation.targetEntityId)?.add(relation.sourceEntityId);
    }
    return map;
}
function outgoing(relations) {
    const map = new Map();
    for (const relation of relations) {
        const list = map.get(relation.sourceEntityId) ?? [];
        if (!list.includes(relation.targetEntityId) && relation.targetEntityId !== relation.sourceEntityId) {
            list.push(relation.targetEntityId);
        }
        map.set(relation.sourceEntityId, list);
    }
    return map;
}
/**
 * Layered tree. Roots are entities with no incoming relation.
 * Cycles fall back to a remaining-node pass so every entity is placed.
 * Columns are ordered by a barycenter of already placed parents.
 */
export function hierarchical(entities, relations, box) {
    const positions = {};
    if (entities.length === 0)
        return positions;
    const children = outgoing(relations);
    const incoming = new Map();
    for (const entity of entities)
        incoming.set(entity.id, 0);
    for (const relation of relations) {
        if (relation.sourceEntityId === relation.targetEntityId)
            continue;
        if (incoming.has(relation.targetEntityId)) {
            incoming.set(relation.targetEntityId, (incoming.get(relation.targetEntityId) ?? 0) + 1);
        }
    }
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    const placed = new Set();
    const layers = [];
    let frontier = entities.filter((entity) => (incoming.get(entity.id) ?? 0) === 0).map((entity) => entity.id);
    if (frontier.length === 0)
        frontier = [entities[0].id];
    while (placed.size < entities.length) {
        if (frontier.length === 0) {
            const rest = entities.find((entity) => !placed.has(entity.id));
            if (!rest)
                break;
            frontier = [rest.id];
        }
        const layer = frontier.filter((id) => !placed.has(id));
        for (const id of layer)
            placed.add(id);
        if (layer.length)
            layers.push(layer);
        const next = [];
        for (const id of layer) {
            for (const child of children.get(id) ?? []) {
                if (!placed.has(child) && !next.includes(child))
                    next.push(child);
            }
        }
        frontier = next;
    }
    const order = new Map();
    layers.forEach((layer, index) => {
        if (index === 0) {
            layer.sort((a, b) => (byId.get(a)?.name ?? a).localeCompare(byId.get(b)?.name ?? b));
        }
        else {
            const parentLayer = layers[index - 1];
            const parentIndex = new Map(parentLayer.map((id, i) => [id, i]));
            layer.sort((a, b) => bary(a, parentIndex, relations) - bary(b, parentIndex, relations));
        }
        layer.forEach((id, i) => order.set(id, i));
    });
    let x = ORIGIN;
    for (const layer of layers) {
        let y = ORIGIN;
        let widest = NODE_W;
        for (const id of layer) {
            const size = box.get(id) ?? { w: NODE_W, h: 40 };
            positions[id] = { x, y };
            y += size.h + GAP_Y;
            widest = Math.max(widest, size.w);
        }
        x += widest + GAP_X;
    }
    return positions;
}
function bary(id, parentIndex, relations) {
    const parents = relations
        .filter((relation) => relation.targetEntityId === id && parentIndex.has(relation.sourceEntityId))
        .map((relation) => parentIndex.get(relation.sourceEntityId) ?? 0);
    if (parents.length === 0)
        return 0;
    return parents.reduce((sum, value) => sum + value, 0) / parents.length;
}
/**
 * Repulsion between every pair, attraction along relations.
 * A short fixed iteration count keeps the pass interactive on large schemas.
 */
export function forceDirected(entities, relations, box) {
    const positions = {};
    const n = entities.length;
    if (n === 0)
        return positions;
    const radius = Math.max(220, n * 36);
    entities.forEach((entity, index) => {
        const angle = (index / n) * Math.PI * 2;
        positions[entity.id] = {
            x: ORIGIN + radius + Math.cos(angle) * radius * 0.55,
            y: ORIGIN + radius + Math.sin(angle) * radius * 0.55,
        };
    });
    const links = neighbors(entities, relations);
    const ideal = 320;
    const iterations = 90;
    for (let step = 0; step < iterations; step += 1) {
        const disp = new Map();
        for (const entity of entities)
            disp.set(entity.id, { x: 0, y: 0 });
        for (let i = 0; i < n; i += 1) {
            for (let j = i + 1; j < n; j += 1) {
                const a = entities[i];
                const b = entities[j];
                const pa = positions[a.id];
                const pb = positions[b.id];
                let dx = pa.x - pb.x;
                let dy = pa.y - pb.y;
                let dist = Math.hypot(dx, dy);
                if (dist < 1) {
                    dx = (i - j) || 1;
                    dy = 0.5;
                    dist = Math.hypot(dx, dy);
                }
                const overlap = overlapAmount(a.id, b.id, positions, box);
                const force = (ideal * ideal) / dist + (overlap > 0 ? overlap * 6 : 0);
                const ux = dx / dist;
                const uy = dy / dist;
                const da = disp.get(a.id);
                const db = disp.get(b.id);
                da.x += ux * force;
                da.y += uy * force;
                db.x -= ux * force;
                db.y -= uy * force;
            }
        }
        for (const entity of entities) {
            for (const other of links.get(entity.id) ?? []) {
                if (other < entity.id)
                    continue;
                const pa = positions[entity.id];
                const pb = positions[other];
                const dx = pb.x - pa.x;
                const dy = pb.y - pa.y;
                const dist = Math.hypot(dx, dy) || 1;
                const force = (dist * dist) / ideal;
                const ux = dx / dist;
                const uy = dy / dist;
                const da = disp.get(entity.id);
                const db = disp.get(other);
                da.x += ux * force;
                da.y += uy * force;
                db.x -= ux * force;
                db.y -= uy * force;
            }
        }
        const temperature = 40 * (1 - step / iterations);
        for (const entity of entities) {
            const d = disp.get(entity.id);
            const dist = Math.hypot(d.x, d.y) || 1;
            const limit = Math.min(dist, temperature * 8);
            positions[entity.id].x += (d.x / dist) * limit;
            positions[entity.id].y += (d.y / dist) * limit;
        }
    }
    return normalize(positions, box);
}
/**
 * One ring when the graph is a single component.
 * Several components sit on concentric rings so a disconnected schema stays readable.
 */
export function circular(entities, relations, box) {
    const positions = {};
    if (entities.length === 0)
        return positions;
    const components = componentsOf(entities, relations);
    components.forEach((ids, ring) => {
        const maxH = Math.max(...ids.map((id) => box.get(id)?.h ?? 40), 40);
        const maxW = Math.max(...ids.map((id) => box.get(id)?.w ?? NODE_W), NODE_W);
        // Chord length must clear the larger box plus the gap, or neighbours on the ring overlap.
        const chord = Math.hypot(maxW + MIN_GAP, maxH + MIN_GAP);
        const radius = Math.max(180, chord / (2 * Math.sin(Math.PI / Math.max(ids.length, 2))), ring * (maxH + MIN_GAP));
        const cx = ORIGIN + radius + ring * (maxW + GAP_X);
        const cy = ORIGIN + radius + maxH / 2;
        ids.forEach((id, index) => {
            const size = box.get(id) ?? { w: NODE_W, h: 40 };
            const angle = (index / ids.length) * Math.PI * 2 - Math.PI / 2;
            positions[id] = {
                x: cx + Math.cos(angle) * radius - size.w / 2,
                y: cy + Math.sin(angle) * radius - size.h / 2,
            };
        });
    });
    return normalize(positions, box);
}
function componentsOf(entities, relations) {
    const links = neighbors(entities, relations);
    const seen = new Set();
    const groups = [];
    for (const entity of entities) {
        if (seen.has(entity.id))
            continue;
        const group = [];
        const stack = [entity.id];
        while (stack.length) {
            const id = stack.pop();
            if (seen.has(id))
                continue;
            seen.add(id);
            group.push(id);
            for (const next of links.get(id) ?? [])
                stack.push(next);
        }
        groups.push(group);
    }
    groups.sort((a, b) => b.length - a.length);
    return groups;
}
function overlapAmount(a, b, positions, box) {
    const pa = positions[a];
    const pb = positions[b];
    const sa = box.get(a) ?? { w: NODE_W, h: 40 };
    const sb = box.get(b) ?? { w: NODE_W, h: 40 };
    const ox = MIN_GAP + (sa.w + sb.w) / 2 - Math.abs(pa.x + sa.w / 2 - (pb.x + sb.w / 2));
    const oy = MIN_GAP + (sa.h + sb.h) / 2 - Math.abs(pa.y + sa.h / 2 - (pb.y + sb.h / 2));
    if (ox <= 0 || oy <= 0)
        return 0;
    return Math.min(ox, oy);
}
/**
 * Push overlapping boxes apart until every pair has MIN_GAP clear space.
 * layer keeps a column's x so a tree stays layered.
 * radial pushes along the ring so a circle stays a circle.
 * free pushes along the shortest escape, which keeps a force layout organic.
 */
export function separate(positions, box, mode) {
    const ids = Object.keys(positions);
    if (ids.length < 2)
        return normalize(positions, box);
    const points = {};
    for (const id of ids)
        points[id] = { x: positions[id].x, y: positions[id].y };
    const center = centroid(points, box);
    const lockX = mode === "layer" ? layerLocks(points) : null;
    for (let step = 0; step < 80; step += 1) {
        let moved = false;
        for (let i = 0; i < ids.length; i += 1) {
            for (let j = i + 1; j < ids.length; j += 1) {
                if (pushApart(ids[i], ids[j], points, box, mode, center, lockX))
                    moved = true;
            }
        }
        if (!moved)
            break;
    }
    // A crowded ring can still touch after the radial pass. Finish with a free push.
    if (mode !== "free" && hasOverlap(points, box)) {
        return separate(points, box, "free");
    }
    return normalize(points, box);
}
function layerLocks(points) {
    const locks = new Map();
    const xs = [...new Set(Object.values(points).map((point) => Math.round(point.x / 8) * 8))].sort((a, b) => a - b);
    for (const [id, point] of Object.entries(points)) {
        let best = xs[0] ?? point.x;
        let bestDist = Infinity;
        for (const x of xs) {
            const dist = Math.abs(point.x - x);
            if (dist < bestDist) {
                best = x;
                bestDist = dist;
            }
        }
        locks.set(id, best);
    }
    return locks;
}
function pushApart(a, b, points, box, mode, center, lockX) {
    const amount = overlapAmount(a, b, points, box);
    if (amount <= 0)
        return false;
    const sa = box.get(a) ?? { w: NODE_W, h: 40 };
    const sb = box.get(b) ?? { w: NODE_W, h: 40 };
    const acx = points[a].x + sa.w / 2;
    const acy = points[a].y + sa.h / 2;
    const bcx = points[b].x + sb.w / 2;
    const bcy = points[b].y + sb.h / 2;
    let dx = acx - bcx;
    let dy = acy - bcy;
    if (mode === "layer") {
        dx = 0;
        if (Math.abs(dy) < 0.5)
            dy = acy <= bcy ? -1 : 1;
    }
    else if (mode === "radial") {
        const aAng = Math.atan2(acy - center.y, acx - center.x);
        const bAng = Math.atan2(bcy - center.y, bcx - center.x);
        const amid = { x: Math.cos(aAng), y: Math.sin(aAng) };
        const bmid = { x: Math.cos(bAng), y: Math.sin(bAng) };
        dx = amid.x - bmid.x;
        dy = amid.y - bmid.y;
        if (Math.hypot(dx, dy) < 0.05) {
            dx = -Math.sin(aAng);
            dy = Math.cos(aAng);
        }
    }
    if (Math.hypot(dx, dy) < 0.05) {
        dx = 0.2;
        dy = 1;
    }
    const dist = Math.hypot(dx, dy);
    const push = amount / 2 + 0.5;
    points[a].x += (dx / dist) * push;
    points[a].y += (dy / dist) * push;
    points[b].x -= (dx / dist) * push;
    points[b].y -= (dy / dist) * push;
    if (lockX) {
        const ax = lockX.get(a);
        const bx = lockX.get(b);
        if (ax !== undefined)
            points[a].x = ax;
        if (bx !== undefined)
            points[b].x = bx;
    }
    return true;
}
function centroid(points, box) {
    let x = 0;
    let y = 0;
    const ids = Object.keys(points);
    for (const id of ids) {
        const size = box.get(id) ?? { w: NODE_W, h: 40 };
        x += points[id].x + size.w / 2;
        y += points[id].y + size.h / 2;
    }
    return { x: x / ids.length, y: y / ids.length };
}
export function hasOverlap(positions, box) {
    const ids = Object.keys(positions);
    for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
            if (overlapAmount(ids[i], ids[j], positions, box) > 0.5)
                return true;
        }
    }
    return false;
}
function normalize(positions, box) {
    const ids = Object.keys(positions);
    if (ids.length === 0)
        return positions;
    let minX = Infinity;
    let minY = Infinity;
    for (const id of ids) {
        minX = Math.min(minX, positions[id].x);
        minY = Math.min(minY, positions[id].y);
    }
    const dx = ORIGIN - minX;
    const dy = ORIGIN - minY;
    for (const id of ids) {
        const size = box.get(id);
        positions[id] = {
            x: Math.round(positions[id].x + dx),
            y: Math.round(positions[id].y + dy),
        };
        if (size && positions[id].y < 0)
            positions[id].y = ORIGIN;
    }
    return positions;
}
