import type { SchemaDoc, SettingsDoc } from "./types.js";

const DB_NAME = "schematic";
const STORE = "handles";
const HANDLE_KEY = "schema";

export interface FileBinding {
  handle: FileSystemFileHandle | null;
  name: string;
}

function supportsHandles(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function rememberHandle(handle: FileSystemFileHandle | null): Promise<void> {
  if (!supportsHandles()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      if (handle) store.put(handle, HANDLE_KEY);
      else store.delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* private mode or blocked storage — the session still works */
  }
}

export async function recallHandle(): Promise<FileSystemFileHandle | null> {
  if (!supportsHandles()) return null;
  try {
    const db = await openDb();
    const handle = await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemFileHandle | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!handle) return null;
    const perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm === "granted") return handle;
    return handle;
  } catch {
    return null;
  }
}

export async function readHandle(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

export async function writeHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function pickOpen(): Promise<{ handle: FileSystemFileHandle | null; text: string; name: string } | null> {
  if ("showOpenFilePicker" in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "Schematic JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      const text = await readHandle(handle);
      return { handle, text, name: handle.name };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  return pickViaInput();
}

function pickViaInput(): Promise<{ handle: null; text: string; name: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ handle: null, text: String(reader.result ?? ""), name: file.name });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

export async function pickSave(suggested: string, text: string): Promise<FileSystemFileHandle | null> {
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: "Schematic JSON", accept: { "application/json": [".json"] } }],
      });
      await writeHandle(handle, text);
      return handle;
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  downloadText(suggested, text, "application/json");
  return null;
}

export function schemaFileName(doc: SchemaDoc): string {
  const base = (doc.meta.name || "untitled").replace(/[^\w.-]+/g, "_");
  return `${base}.schematic.json`;
}

export function settingsFileName(): string {
  return "schematic.settings.json";
}

export function serialize(doc: SchemaDoc | SettingsDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export async function ensurePermission(handle: FileSystemFileHandle, mode: "read" | "readwrite"): Promise<boolean> {
  const query = await handle.queryPermission({ mode });
  if (query === "granted") return true;
  const asked = await handle.requestPermission({ mode });
  return asked === "granted";
}
