import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const shared = { "@shared": resolve("src/shared") };

export default defineConfig({
	main: {
		resolve: { alias: shared },
		build: { rollupOptions: { input: { index: resolve("src/main/index.ts"), "render-worker": resolve("src/main/render/worker.ts") } } },
	},
	preload: {
		resolve: { alias: shared },
	},
	renderer: {
		root: resolve("src/renderer"),
		resolve: { alias: { ...shared, "@renderer": resolve("src/renderer/src"), "@video": resolve("video/src") } },
		build: { rollupOptions: { input: resolve("src/renderer/index.html") } },
		plugins: [react(), tailwindcss()],
	},
});
