import { app } from "electron";

function version(): string {
	try {
		return app.getVersion();
	} catch {
		return "dev";
	}
}

/** Sent with every provider request. */
export const PROVIDER_HEADERS: Record<string, string> = {
	"User-Agent": `explainer-studio/${version()} (win32)`,
};
