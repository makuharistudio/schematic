export interface LanguagePack {
  default: string;
  languages: { id: string; label: string; short: string }[];
  strings: Record<string, Record<string, string>>;
}

const pack: LanguagePack = {
  default: "en-US",
  languages: [{ id: "en-US", label: "English (US)", short: "En" }],
  strings: { "en-US": {} },
};

let active = "en-US";
const listeners = new Set<() => void>();

export function installLanguages(next: LanguagePack): void {
  pack.default = next.default || "en-US";
  pack.languages = next.languages?.length ? next.languages : pack.languages;
  pack.strings = next.strings ?? { "en-US": {} };
  if (!pack.strings[pack.default]) pack.strings[pack.default] = {};
}

export function setLanguage(id: string): void {
  const known = pack.languages.some((item) => item.id === id) || Boolean(pack.strings[id]);
  const next = known ? id : pack.default;
  if (next === active) return;
  active = next;
  for (const listener of listeners) listener();
}

/** Apply a language even when it is already active, so the first paint refreshes. */
export function applyLanguage(id: string): void {
  const known = pack.languages.some((item) => item.id === id) || Boolean(pack.strings[id]);
  active = known ? id : pack.default;
  for (const listener of listeners) listener();
}

export function onLanguageChange(listener: () => void): void {
  listeners.add(listener);
}

export function currentLanguage(): string {
  return active;
}

export function languageChoices(): { id: string; label: string; short: string }[] {
  return pack.languages.map((item) => ({
    id: item.id,
    label: item.label || item.id,
    short: item.short || item.id,
  }));
}

/** Look up a UI string. A missing or blank key falls back to English, then to the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
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

export async function loadLanguages(url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`language file ${response.status}`);
  installLanguages((await response.json()) as LanguagePack);
}
