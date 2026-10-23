import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { alias: { "@shared": resolve("src/shared") } },
	test: {
		include: ["tests/**/*.test.ts"],
		// Slow tests run separately: npm run test:render, npm run test:voice, npm run test:ingest, npm run test:planner
		exclude: ["tests/render/**", "tests/voice/**", "tests/ingest/**", "tests/planner/**", "**/node_modules/**"],
		environment: "node",
	},
});
