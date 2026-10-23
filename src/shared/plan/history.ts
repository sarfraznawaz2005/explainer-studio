/**
 * Undo/redo history for Studio edits. Pure and generic, so it is unit tested
 * without the window. Each edit pushes the previous state; undo and redo move
 * between them. The oldest steps fall off after `limit` (100 by default).
 */
export type History<T> = { present: T; past: { state: T; label: string }[]; future: { state: T; label: string }[] };

export const HISTORY_LIMIT = 100;

export const historyOf = <T>(present: T): History<T> => ({ present, past: [], future: [] });

/** A new edit: the old state goes on the undo stack, redo is cleared. */
export function pushEdit<T>(h: History<T>, next: T, label: string, limit = HISTORY_LIMIT): History<T> {
	if (next === h.present) return h;
	const past = [...h.past, { state: h.present, label }];
	return { present: next, past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
	const last = h.past.at(-1);
	if (!last) return h;
	return { present: last.state, past: h.past.slice(0, -1), future: [{ state: h.present, label: last.label }, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
	const next = h.future[0];
	if (!next) return h;
	return { present: next.state, past: [...h.past, { state: h.present, label: next.label }], future: h.future.slice(1) };
}

/** Replace the present without a history step (a save came back with new voice timing, for example). */
export const replacePresent = <T>(h: History<T>, present: T): History<T> => ({ ...h, present });

export const undoLabel = <T>(h: History<T>) => h.past.at(-1)?.label ?? null;
export const redoLabel = <T>(h: History<T>) => h.future[0]?.label ?? null;
