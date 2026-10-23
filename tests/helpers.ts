import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh temp folder per test. The OS cleans the temp root. */
export function tempDir(prefix = "es-test-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}
