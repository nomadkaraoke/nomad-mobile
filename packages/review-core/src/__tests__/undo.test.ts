import { UndoStack } from '../undo';

describe('UndoStack', () => {
  it('returns states LIFO, swapping nothing else', () => {
    const u = new UndoStack<number>();
    u.push(1);
    u.push(2);
    u.push(3);
    expect(u.undo(4)).toBe(3);
    expect(u.undo(3)).toBe(2);
    expect(u.undo(2)).toBe(1);
    expect(u.undo(1)).toBeNull();
  });

  it('canUndo tracks the stack', () => {
    const u = new UndoStack<string>();
    expect(u.canUndo).toBe(false);
    u.push('a');
    expect(u.canUndo).toBe(true);
    u.undo('b');
    expect(u.canUndo).toBe(false);
  });

  it('caps at 100 entries, dropping the oldest', () => {
    const u = new UndoStack<number>();
    for (let i = 0; i < 101; i++) u.push(i);
    let n = 0;
    let last: number | null = null;
    for (let s = u.undo(-1); s !== null; s = u.undo(s)) {
      n++;
      last = s;
    }
    expect(n).toBe(100);
    expect(last).toBe(1);
  });

  it('honours a custom limit and clear()', () => {
    const u = new UndoStack<number>(2);
    u.push(1); u.push(2); u.push(3);
    expect(u.undo(0)).toBe(3);
    expect(u.undo(0)).toBe(2);
    expect(u.undo(0)).toBeNull();
    u.push(9);
    u.clear();
    expect(u.canUndo).toBe(false);
  });
});
