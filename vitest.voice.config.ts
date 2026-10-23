import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Real Kokoro tests against the installed voice engine. Run with `npm run test:voice`.
export default defineConfig({
	resolve: { alias: { "@shared": resolve("src/shared") } },
	test: {
		include: ["tests/voice/**/*.voice.test.ts"],
		environment: "node",
		fileParallelism: false,
		testTimeout: 180_000,
	},
});
