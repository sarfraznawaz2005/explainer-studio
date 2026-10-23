import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Real planner tests through the local Claude Code CLI login (claude-subscription provider).
// Run with `npm run test:planner`.
export default defineConfig({
	resolve: { alias: { "@shared": resolve("src/shared") } },
	test: {
		include: ["tests/planner/**/*.planner.test.ts"],
		environment: "node",
		fileParallelism: false,
		testTimeout: 30 * 60_000,
		hookTimeout: 30 * 60_000,
	},
});
