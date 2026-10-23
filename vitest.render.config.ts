import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Slow render tests (real Remotion bundle + headless Chrome). Run with `npm run test:render`.
export default defineConfig({
	resolve: { alias: { "@shared": resolve("src/shared") } },
	test: {
		include: ["tests/render/**/*.render.test.ts"],
		environment: "node",
		fileParallelism: false,
		sequence: { concurrent: false },
	},
});
