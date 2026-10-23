import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appChannels } from "@shared/ipc/app";
import { renderChannels } from "@shared/ipc/render";
import { configureLogger, logFile, writeLog } from "../src/main/app/logger";
import { openFile } from "../src/main/db/connection";
import { runMigrations } from "../src/main/db/migrate";
import { MIGRATIONS } from "../src/main/db/migrations";
import { createRepos } from "../src/main/db/repos";
import { IpcInputError, parseInput } from "../src/main/ipc/validate";
import { runTool } from "../src/main/security/exec";
import { createKeystore, type Sealer } from "../src/main/security/keystore";
import { classifyLink } from "../src/main/security/links";
import { createPathGuard, PathDeniedError } from "../src/main/security/path-guard";
import { redact } from "../src/main/security/redact";
import { tempDir } from "./helpers";

describe("IPC validation", () => {
	it("accepts valid payloads", () => {
		expect(parseInput(appChannels.setTheme, { pref: "dark" })).toEqual({ pref: "dark" });
		expect(parseInput(appChannels.info, undefined)).toBeUndefined();
	});

	it("rejects invalid payloads with a validation error", () => {
		expect(() => parseInput(appChannels.setTheme, { pref: "neon" })).toThrow(IpcInputError);
		expect(() => parseInput(appChannels.setTheme, "dark")).toThrow(/Invalid input/);
		expect(() => parseInput(appChannels.setTitleBarColors, { color: "red; background:url(x)", symbolColor: "#fff" })).toThrow(IpcInputError);
		expect(() => parseInput(renderChannels.cancel, { jobId: "../../etc" })).toThrow(/jobId/);
		expect(() => parseInput(appChannels.info, { sneaky: true })).toThrow(IpcInputError);
	});
});

describe("path guard", () => {
	const root = tempDir();
	const drafts = join(root, "drafts");
	const outside = join(root, "outside");
	mkdirSync(drafts, { recursive: true });
	mkdirSync(outside, { recursive: true });
	writeFileSync(join(outside, "secret.txt"), "x");
	const guard = createPathGuard([drafts]);

	it("allows files inside an app folder", () => {
		expect(guard.check(join(drafts, "a", "plan.json"))).toBe(join(drafts, "a", "plan.json"));
		expect(guard.check(drafts)).toBe(drafts);
	});

	it("rejects ../ traversal out of a root", () => {
		expect(() => guard.check(join(drafts, "..", "outside", "secret.txt"))).toThrow(PathDeniedError);
		expect(() => guard.check(`${drafts}\\..\\outside\\secret.txt`)).toThrow(PathDeniedError);
		expect(() => guard.check(`${drafts}/a/../../outside`)).toThrow(PathDeniedError);
	});

	it("rejects paths outside the roots and look-alike prefixes", () => {
		expect(() => guard.check(join(outside, "secret.txt"))).toThrow(PathDeniedError);
		expect(() => guard.check(`${drafts}-evil\\x.txt`)).toThrow(PathDeniedError);
		expect(() => guard.check("C:\\Windows\\System32\\drivers\\etc\\hosts")).toThrow(PathDeniedError);
	});

	it("rejects malformed and dangerous path forms", () => {
		for (const bad of ["", "relative\\file.txt", "..\\x", `${drafts}\\a\0b`, "\\\\server\\share\\x", "\\\\?\\C:\\x", "\\\\.\\PhysicalDrive0", `${drafts}\\file.txt:hidden`, `${drafts}\\NUL`, `${drafts}\\con.txt`, 42, null]) {
			expect(() => guard.check(bad), String(bad)).toThrow(PathDeniedError);
		}
	});

	it("is case-insensitive on Windows", () => {
		if (process.platform !== "win32") return;
		expect(() => guard.check(join(drafts.toUpperCase(), "x.json"))).not.toThrow();
	});

	it("does not follow a junction out of a root", () => {
		const link = join(drafts, "escape");
		symlinkSync(outside, link, "junction");
		expect(() => guard.check(join(link, "secret.txt"))).toThrow(PathDeniedError);
	});

	it("allows a file the user picked in a dialog only when asked to", () => {
		const picked = join(outside, "secret.txt");
		guard.allowPicked(picked);
		expect(() => guard.check(picked)).toThrow(PathDeniedError);
		expect(guard.check(picked, { allowPicked: true })).toBe(picked);
		expect(() => guard.check(join(outside, "other.txt"), { allowPicked: true })).toThrow(PathDeniedError);
	});
});

describe("secrets", () => {
	// Reversible fake in place of safeStorage, which needs Electron.
	const fake: Sealer = {
		available: async () => true,
		seal: async (p) => new Uint8Array(Buffer.from(p, "utf8").map((b) => b ^ 0x5a)),
		open: async (s) => Buffer.from(Buffer.from(s).map((b) => b ^ 0x5a)).toString("utf8"),
	};

	it("round-trip through the keystore and the database, and never reach the log", async () => {
		const logs = tempDir();
		configureLogger(logs);
		const d = openFile(join(tempDir(), "studio.db"));
		await runMigrations(d, MIGRATIONS);
		const r = createRepos(() => d);
		const ks = createKeystore(fake);

		const key = "my-private-provider-key-1234567890"; // no known prefix: masked only because it was registered
		const p = r.providers.create({ kind: "custom", name: "Custom", secret: await ks.seal(key) });
		const stored = r.providers.get(p.id)!.secret!;
		expect(Buffer.from(stored).toString("utf8")).not.toContain(key);
		expect(await ks.open(stored)).toBe(key);

		writeLog("test", "info", `calling provider with key ${key}`);
		writeLog("test", "error", "request failed", new Error(`401 for key=${key}`));
		const text = readFileSync(logFile("test")!, "utf8");
		expect(text).not.toContain(key);
		expect(text).toContain("[REDACTED]");
		d.close();
	});

	it("refuse to seal when secure storage is unavailable", async () => {
		const ks = createKeystore({ ...fake, available: async () => false });
		await expect(ks.seal("abcdefghijkl")).rejects.toThrow(/not available/);
	});

	it("mask common key formats even when not registered", () => {
		const samples = [
			"sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
			"sk-or-v1-0123456789abcdef0123456789abcdef",
			"AIzaSyA1234567890abcdefghijklmnopqrstu",
			"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
			'{"api_key": "zzzzzzzzzzzz"}',
			"https://x.test/v1?key=abcdef123456&q=1",
		];
		for (const s of samples) {
			const out = redact(s);
			expect(out, s).toContain("[REDACTED]");
			expect(out).not.toMatch(/abcdefghijklmnop|0123456789abcdef0123|zzzzzzzzzzzz|abcdef123456|payload\.sig/);
		}
		expect(redact("plain text with no keys")).toBe("plain text with no keys");
	});
});

describe("runTool", () => {
	it("passes shell characters through as plain text", async () => {
		const evil = "a & echo INJECTED | b; $(whoami) `id` > out.txt";
		const r = await runTool(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", evil, "two words"]);
		expect(JSON.parse(r.stdout)).toEqual([evil, "two words"]);
	});

	it("refuses batch files, bad arguments and missing programs", async () => {
		await expect(runTool("C:\\x\\run.bat", [])).rejects.toThrow(/Batch files/);
		await expect(runTool("tool.CMD", [])).rejects.toThrow(/Batch files/);
		await expect(runTool(process.execPath, [1 as never])).rejects.toThrow(/plain strings/);
		await expect(runTool("definitely-not-a-real-program-xyz", [])).rejects.toThrow(/not found/);
	});

	it("reports a non-zero exit and enforces the timeout", async () => {
		await expect(runTool(process.execPath, ["-e", "console.error('boom'); process.exit(3)"])).rejects.toThrow(/exit 3.*boom/);
		await expect(runTool(process.execPath, ["-e", "setTimeout(()=>{}, 10000)"], { timeoutMs: 300 })).rejects.toThrow(/stopped/);
	});
});

describe("external links", () => {
	it("open known https hosts, ask for others, block other schemes", () => {
		expect(classifyLink("https://www.remotion.dev/docs").verdict).toBe("open");
		expect(classifyLink("https://freesound.org/s/1").verdict).toBe("open");
		expect(classifyLink("https://example.com").verdict).toBe("ask");
		expect(classifyLink("https://remotion.dev.evil.com").verdict).toBe("ask");
		expect(classifyLink("http://remotion.dev").verdict).toBe("block");
		expect(classifyLink("file:///C:/Windows/system32/calc.exe").verdict).toBe("block");
		expect(classifyLink("javascript:alert(1)").verdict).toBe("block");
		expect(classifyLink("https://user:pw@github.com").verdict).toBe("block");
		expect(classifyLink("not a url").verdict).toBe("block");
	});
});
