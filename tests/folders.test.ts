import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureFolders, folderLayout, folderSize, FOLDERS, storageUsage } from "../src/main/app/folders";
import { tempDir } from "./helpers";

describe("app folders", () => {
	it("are all created on first start", () => {
		const root = join(tempDir(), "Explainer Studio");
		const f = ensureFolders(folderLayout(root));
		for (const name of FOLDERS) expect(existsSync(f[name]), name).toBe(true);
		expect(f.backups).toBe(join(root, "data", "backups"));
		// Running again on an existing profile is harmless.
		expect(() => ensureFolders(folderLayout(root))).not.toThrow();
	});

	it("report their size, with backups split out of data", async () => {
		const f = ensureFolders(folderLayout(tempDir()));
		writeFileSync(join(f.data, "studio.db"), Buffer.alloc(1000));
		writeFileSync(join(f.backups, "b.db"), Buffer.alloc(300));
		mkdirSync(join(f.cache, "deep", "er"), { recursive: true });
		writeFileSync(join(f.cache, "deep", "er", "x.bin"), Buffer.alloc(50));
		const u = await storageUsage(f);
		expect(u.data).toEqual({ bytes: 1000, files: 1 });
		expect(u.backups).toEqual({ bytes: 300, files: 1 });
		expect(u.cache).toEqual({ bytes: 50, files: 1 });
		expect(await folderSize(join(f.root, "missing"))).toEqual({ bytes: 0, files: 0 });
	});
});
