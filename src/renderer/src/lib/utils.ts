import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge class names; later Tailwind classes win over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

export const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
/** "Ctrl" on Windows/Linux, "⌘" on macOS. */
export const modKey = isMac ? "⌘" : "Ctrl";
