/**
 * Hosts the app may open in the system browser without asking.
 * Any other https link asks the user first; other schemes are dropped.
 */
const ALLOWED_HOSTS = [
	"remotion.dev",
	"github.com",
	"youtube.com",
	"studio.youtube.com",
	"freesound.org",
	"freepd.com",
	"kenney.nl",
	"creativecommons.org",
	"openrouter.ai",
	"anthropic.com",
	"claude.ai",
	"opencode.ai",
	"platform.openai.com",
	"aistudio.google.com",
	"console.groq.com",
	"platform.deepseek.com",
	"console.x.ai",
	"z.ai",
	"ollama.com",
	"python.org",
	"archive.org",
];

export type LinkVerdict = "open" | "ask" | "block";

export function classifyLink(raw: string): { verdict: LinkVerdict; host: string } {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { verdict: "block", host: "" };
	}
	if (url.protocol !== "https:" || url.username || url.password) return { verdict: "block", host: url.hostname };
	const host = url.hostname.toLowerCase();
	const known = ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
	return { verdict: known ? "open" : "ask", host };
}
