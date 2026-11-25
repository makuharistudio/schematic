import type { SchemaDoc } from "./types.js";

const LIMIT = 100;

/**
 * Present is the live document held by the caller.
 * undoStack stores previous presents; redoStack stores presents replaced by undo.
 */
export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Call with a snapshot taken immediately before the mutation. */
  pushBefore(before: SchemaDoc): void {
    this.undoStack.push(JSON.stringify(before));
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(live: SchemaDoc): SchemaDoc | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(JSON.stringify(live));
    return JSON.parse(prev) as SchemaDoc;
  }

  redo(live: SchemaDoc): SchemaDoc | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(JSON.stringify(live));
    return JSON.parse(next) as SchemaDoc;
  }
}
