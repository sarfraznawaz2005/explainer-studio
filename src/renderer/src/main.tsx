import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { router } from "./router";
import { useTheme } from "./stores/theme";

// Apply the theme before the first paint so the window never flashes the wrong colours.
void useTheme
	.getState()
	.init()
	.catch((err) => console.error("theme init failed", err))
	.finally(() => {
		createRoot(document.getElementById("root")!).render(
			<StrictMode>
				<RouterProvider router={router} />
			</StrictMode>,
		);
	});
