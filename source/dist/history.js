const LIMIT = 100;
/**
 * Present is the live document held by the caller.
 * undoStack stores previous presents; redoStack stores presents replaced by undo.
 */
export class History {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
    }
    reset() {
        this.undoStack = [];
        this.redoStack = [];
    }
    /** Call with a snapshot taken immediately before the mutation. */
    pushBefore(before) {
        this.undoStack.push(JSON.stringify(before));
        if (this.undoStack.length > LIMIT)
            this.undoStack.shift();
        this.redoStack = [];
    }
    canUndo() {
        return this.undoStack.length > 0;
    }
    canRedo() {
        return this.redoStack.length > 0;
    }
    undo(live) {
        const prev = this.undoStack.pop();
        if (!prev)
            return null;
        this.redoStack.push(JSON.stringify(live));
        return JSON.parse(prev);
    }
    redo(live) {
        const next = this.redoStack.pop();
        if (!next)
            return null;
        this.undoStack.push(JSON.stringify(live));
        return JSON.parse(next);
    }
}
