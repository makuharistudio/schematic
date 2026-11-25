const DB_NAME = "schematic";
const STORE = "handles";
const HANDLE_KEY = "schema";
function supportsHandles() {
    return typeof window !== "undefined" && "showOpenFilePicker" in window && "indexedDB" in window;
}
function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE))
                db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
export async function rememberHandle(handle) {
    if (!supportsHandles())
        return;
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            const store = tx.objectStore(STORE);
            if (handle)
                store.put(handle, HANDLE_KEY);
            else
                store.delete(HANDLE_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    }
    catch {
        /* private mode or blocked storage — the session still works */
    }
}
export async function recallHandle() {
    if (!supportsHandles())
        return null;
    try {
        const db = await openDb();
        const handle = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readonly");
            const req = tx.objectStore(STORE).get(HANDLE_KEY);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
        db.close();
        if (!handle)
            return null;
        const perm = await handle.queryPermission({ mode: "readwrite" });
        if (perm === "granted")
            return handle;
        return handle;
    }
    catch {
        return null;
    }
}
export async function readHandle(handle) {
    const file = await handle.getFile();
    return file.text();
}
export async function writeHandle(handle, text) {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
}
export function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
export async function pickOpen() {
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
        }
        catch (err) {
            if (isAbort(err))
                return null;
            throw err;
        }
    }
    return pickViaInput();
}
function pickViaInput() {
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
export async function pickSave(suggested, text) {
    if ("showSaveFilePicker" in window) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: suggested,
                types: [{ description: "Schematic JSON", accept: { "application/json": [".json"] } }],
            });
            await writeHandle(handle, text);
            return handle;
        }
        catch (err) {
            if (isAbort(err))
                return null;
            throw err;
        }
    }
    downloadText(suggested, text, "application/json");
    return null;
}
export function schemaFileName(doc) {
    const base = (doc.meta.name || "untitled").replace(/[^\w.-]+/g, "_");
    return `${base}.schematic.json`;
}
export function settingsFileName() {
    return "schematic.settings.json";
}
export function serialize(doc) {
    return `${JSON.stringify(doc, null, 2)}\n`;
}
function isAbort(err) {
    return err instanceof DOMException && err.name === "AbortError";
}
export async function ensurePermission(handle, mode) {
    const query = await handle.queryPermission({ mode });
    if (query === "granted")
        return true;
    const asked = await handle.requestPermission({ mode });
    return asked === "granted";
}
