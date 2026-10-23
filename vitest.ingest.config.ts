import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Real reading tests: the installed local engine (RapidOCR, PDF helper) and a free OpenCode vision model.
// Run with `npm run test:ingest`.
export default defineConfig({
	resolve: { alias: { "@shared": resolve("src/shared") } },
	test: {
		include: ["tests/ingest/**/*.ingest.test.ts"],
		environment: "node",
		fileParallelism: false,
		testTimeout: 15 * 60_000,
		hookTimeout: 15 * 60_000,
	},
});
