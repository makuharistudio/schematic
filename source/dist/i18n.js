const pack = {
    default: "en-US",
    languages: [{ id: "en-US", label: "English (US)", short: "En" }],
    strings: { "en-US": {} },
};
let active = "en-US";
const listeners = new Set();
export function installLanguages(next) {
    pack.default = next.default || "en-US";
    pack.languages = next.languages?.length ? next.languages : pack.languages;
    pack.strings = next.strings ?? { "en-US": {} };
    if (!pack.strings[pack.default])
        pack.strings[pack.default] = {};
}
export function setLanguage(id) {
    const known = pack.languages.some((item) => item.id === id) || Boolean(pack.strings[id]);
    const next = known ? id : pack.default;
    if (next === active)
        return;
    active = next;
    for (const listener of listeners)
        listener();
}
/** Apply a language even when it is already active, so the first paint refreshes. */
export function applyLanguage(id) {
    const known = pack.languages.some((item) => item.id === id) || Boolean(pack.strings[id]);
    active = known ? id : pack.default;
    for (const listener of listeners)
        listener();
}
export function onLanguageChange(listener) {
    listeners.add(listener);
}
export function currentLanguage() {
    return active;
}
export function languageChoices() {
    return pack.languages.map((item) => ({
        id: item.id,
        label: item.label || item.id,
        short: item.short || item.id,
    }));
}
/** Look up a UI string. A missing or blank key falls back to English, then to the key. */
export function t(key, vars) {
    const table = pack.strings[active] ?? {};
    const english = pack.strings[pack.default] ?? pack.strings["en-US"] ?? {};
    let text = table[key] || english[key] || key;
    if (vars) {
        for (const [name, value] of Object.entries(vars)) {
            text = text.split(`{${name}}`).join(String(value));
        }
    }
    return text;
}
export async function loadLanguages(url) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`language file ${response.status}`);
    installLanguages((await response.json()));
}
