import { createHashHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { ErrorScreen } from "./components/layout/error-screen";
import { Shell } from "./components/layout/shell";
import { AssetsPage } from "./pages/assets/assets-page";
import { BrandPage } from "./pages/brand-page";
import { DraftsPage } from "./pages/library/drafts-page";
import { QueuePage } from "./pages/library/queue-page";
import { SeriesPage } from "./pages/library/series-page";
import { LibraryPage } from "./pages/library/videos-page";
import { HomePage } from "./pages/home";
import { NewVideoPage } from "./pages/new-video";
import { SettingsPage } from "./pages/settings";
import { StudioPage } from "./pages/studio/studio-page";

const root = createRootRoute({ component: Shell });

const page = <P extends string>(path: P, component: () => React.JSX.Element) => createRoute({ getParentRoute: () => root, path, component, errorComponent: ErrorScreen });

const routeTree = root.addChildren([
	page("/", HomePage),
	createRoute({
		getParentRoute: () => root,
		path: "/new",
		component: NewVideoPage,
		errorComponent: ErrorScreen,
		// ?draft=<id> continues a draft at the outline step.
		validateSearch: (s: Record<string, unknown>): { draft?: string } => ({ draft: typeof s.draft === "string" && /^[0-9a-f-]{36}$/i.test(s.draft) ? s.draft : undefined }),
	}),
	createRoute({
		getParentRoute: () => root,
		path: "/studio",
		component: StudioPage,
		errorComponent: ErrorScreen,
		// ?draft=<id> opens a draft; "sample" opens the built-in sample plan.
		validateSearch: (s: Record<string, unknown>): { draft?: string } => ({ draft: typeof s.draft === "string" && s.draft.length <= 64 ? s.draft : undefined }),
	}),
	page("/library", LibraryPage),
	page("/drafts", DraftsPage),
	page("/series", SeriesPage),
	page("/queue", QueuePage),
	page("/assets", AssetsPage),
	page("/brand", BrandPage),
	createRoute({
		getParentRoute: () => root,
		path: "/settings",
		component: SettingsPage,
		errorComponent: ErrorScreen,
		// ?section=ai opens one section directly (unknown values fall back to the first).
		validateSearch: (s: Record<string, unknown>): { section?: string } => ({ section: typeof s.section === "string" && s.section.length <= 32 ? s.section : undefined }),
	}),
]);

// Hash history: works the same from the dev server and from file:// in the packaged app.
export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: false });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
