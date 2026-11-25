let seq = 0;
export function uid(prefix) {
    seq += 1;
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${Date.now().toString(36)}${rand}${seq.toString(36)}`;
}
export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
