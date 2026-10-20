/** Bounded undo history of immutable states. `undo(current)` returns the previous state or null. */
export class UndoStack<T> {
  private stack: T[] = [];

  constructor(private readonly limit = 100) {}

  push(state: T): void {
    this.stack.push(state);
    if (this.stack.length > this.limit) this.stack.shift();
  }

  undo(_current: T): T | null {
    return this.stack.pop() ?? null;
  }

  get canUndo(): boolean {
    return this.stack.length > 0;
  }

  clear(): void {
    this.stack = [];
  }
}
