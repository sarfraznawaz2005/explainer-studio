import { continueRender, delayRender } from "remotion";

const pending = new Set<string>();
const done = new Set<string>();

/**
 * Holds the frame (delayRender) until `load` finishes, once per key for the
 * whole page. Safe to call while rendering: when React throws a render away and
 * renders again (it does that after an error, for example a crash in AI video
 * code), the second call finds the first wait and adds none. A wait made in a
 * useState initializer would be lost there and never cleared.
 */
export function waitOnce(key: string, label: string, load: () => Promise<unknown>): void {
	if (done.has(key) || pending.has(key)) return;
	pending.add(key);
	const handle = delayRender(label);
	load()
		.catch(() => undefined)
		.finally(() => {
			pending.delete(key);
			done.add(key);
			continueRender(handle);
		});
}
