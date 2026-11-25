export const ROW_H = 18;
export const HEADER_H = 20;
export const NODE_W = 248;
export const KEY_W = 16;
export const PAD = 0;
export function rowCenterY(entityY, collapsed, rowIndex) {
    if (collapsed)
        return entityY + HEADER_H / 2;
    return entityY + HEADER_H + rowIndex * ROW_H + ROW_H / 2;
}
export function entityHeight(collapsed, columnCount) {
    if (collapsed)
        return HEADER_H;
    return HEADER_H + Math.max(1, columnCount) * ROW_H + ROW_H;
}
/** Pick the facing sides so the stub leaves the nearer vertical edge. */
export function anchorsFor(sourceBox, sourceY, targetBox, targetY) {
    const same = Math.abs(sourceBox.x - targetBox.x) < 1 &&
        Math.abs(sourceBox.y - targetBox.y) < 1 &&
        sourceBox.w === targetBox.w;
    const sMid = sourceBox.x + sourceBox.w / 2;
    const tMid = targetBox.x + targetBox.w / 2;
    const sourceOnLeft = same ? false : sMid <= tMid;
    const sy = clamp(sourceY, sourceBox.y + 4, sourceBox.y + sourceBox.h - 4);
    const ty = clamp(targetY, targetBox.y + 4, targetBox.y + targetBox.h - 4);
    if (same) {
        return {
            source: { x: sourceBox.x + sourceBox.w, y: sy, side: "right" },
            target: { x: targetBox.x + targetBox.w, y: ty, side: "right" },
        };
    }
    return {
        source: {
            x: sourceOnLeft ? sourceBox.x + sourceBox.w : sourceBox.x,
            y: sy,
            side: sourceOnLeft ? "right" : "left",
        },
        target: {
            x: sourceOnLeft ? targetBox.x : targetBox.x + targetBox.w,
            y: ty,
            side: sourceOnLeft ? "left" : "right",
        },
    };
}
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}
function stub(anchor, length) {
    const dir = anchor.side === "right" ? 1 : -1;
    return { x: anchor.x + dir * length, y: anchor.y };
}
/**
 * Orthogonal elbow:
 *   start --stub--> vertical channel --stub--> end
 * Same shape as a hand-drawn `|____` then `|` when the tables sit apart.
 */
export function routePath(input) {
    const stubLen = 18 + Math.abs(input.lane) * 4;
    const a = input.source;
    const b = input.target;
    if (input.style === "straight") {
        return [
            { x: a.x, y: a.y },
            { x: b.x, y: b.y },
        ];
    }
    const sameSide = a.side === b.side;
    const s = stub(a, sameSide ? stubLen + 16 : stubLen);
    const t = stub(b, sameSide ? stubLen + 16 : stubLen);
    if (input.style === "curved") {
        return [
            { x: a.x, y: a.y },
            s,
            t,
            { x: b.x, y: b.y },
        ];
    }
    const channel = sameSide
        ? (a.side === "right" ? Math.max(s.x, t.x) : Math.min(s.x, t.x)) + input.lane * 6
        : (s.x + t.x) / 2 + input.lane * 6;
    const points = [{ x: a.x, y: a.y }, s];
    if (Math.abs(s.y - t.y) < 0.5 && Math.abs(s.x - t.x) < 1) {
        points.push({ x: b.x, y: b.y });
        return points;
    }
    points.push({ x: channel, y: s.y });
    points.push({ x: channel, y: t.y });
    points.push(t);
    points.push({ x: b.x, y: b.y });
    return dedupe(points);
}
export function pointsToPath(points, style) {
    if (points.length === 0)
        return "";
    if (style === "curved" && points.length >= 4) {
        const [p0, p1, p2, p3] = points;
        return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
    }
    return points.map((p, i) => `${i === 0 ? "M" : "L"} ${round(p.x)} ${round(p.y)}`).join(" ");
}
function round(n) {
    return Math.round(n * 10) / 10;
}
function dedupe(points) {
    const out = [];
    for (const p of points) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - p.x) < 0.4 && Math.abs(last.y - p.y) < 0.4)
            continue;
        out.push(p);
    }
    return out;
}
/** Unit direction the mark should face: from the node edge toward the line. */
export function outward(anchor) {
    return anchor.side === "right" ? 1 : -1;
}
export function cardinalityMark(cardinality) {
    if (cardinality === "zero-or-one")
        return "zero-one";
    if (cardinality === "zero-or-many")
        return "zero-many";
    if (cardinality === "one-or-many")
        return "one-many";
    return "only-one";
}
export function hitDistance(points, x, y) {
    let best = Infinity;
    for (let i = 1; i < points.length; i += 1) {
        best = Math.min(best, segmentDistance(points[i - 1], points[i], x, y));
    }
    return best;
}
function segmentDistance(a, b, x, y) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.01)
        return Math.hypot(x - a.x, y - a.y);
    let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}
