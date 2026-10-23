/** "just now", "5 min ago", "3 h ago", "2 days ago", then a date. */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
	if (!iso) return "";
	const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
	if (s < 45) return "just now";
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} h ago`;
	const d = Math.round(h / 24);
	if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
	return new Date(iso).toLocaleDateString();
}

/** 950 → "950", 12_300 → "12.3k", 4_100_000 → "4.1M". */
export function compactNumber(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
	return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** US dollars with enough digits for tiny per-call costs. */
export function usd(n: number): string {
	if (n === 0) return "$0";
	if (n < 0.01) return `$${n.toFixed(4)}`;
	return `$${n.toFixed(2)}`;
}

/** 1_234 → "1.2 KB", 354_000_000 → "354 MB". Decimal units, like Windows Explorer's "size on disk" rounding. */
export function bytes(n: number): string {
	if (n < 1000) return `${n} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let v = n / 1000;
	let i = 0;
	while (v >= 1000 && i < units.length - 1) {
		v /= 1000;
		i++;
	}
	return `${v.toFixed(v < 10 ? 1 : 0).replace(/\.0$/, "")} ${units[i]}`;
}

/** 1:05, 12:30, 1:02:03 for a length in milliseconds. */
export function duration(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** "about 4 min" style time left. */
export function timeLeft(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return "less than a minute";
	const m = Math.round(s / 60);
	if (m < 60) return `about ${m} min`;
	const h = Math.floor(m / 60);
	return `about ${h} h ${m % 60} min`;
}
