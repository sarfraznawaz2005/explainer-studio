import { Outlet, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@renderer/lib/utils";
import { TooltipProvider } from "../ui/primitives";
import { ConfirmHost } from "../ui/confirm";
import { Toaster } from "../ui/misc";
import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";
import { TitleBar } from "./titlebar";

/** Screens that manage their own layout edge to edge (no page padding or max width). */
const FULL_BLEED = new Set(["/studio"]);

export function Shell() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const full = FULL_BLEED.has(pathname);
	return (
		<TooltipProvider delayDuration={400}>
			<div className="flex h-full flex-col">
				<TitleBar />
				<div className="flex min-h-0 flex-1">
					<Sidebar />
					<main className={cn("relative min-w-0 flex-1", full ? "overflow-hidden" : "overflow-y-auto")}>
						<AnimatePresence mode="wait" initial={false}>
							<motion.div
								key={pathname}
								initial={{ opacity: 0, y: 6 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: -4 }}
								transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
								className={full ? "h-full w-full" : "w-full px-6 py-6"}
							>
								<Outlet />
							</motion.div>
						</AnimatePresence>
					</main>
				</div>
			</div>
			<CommandPalette />
			<ConfirmHost />
			<Toaster />
		</TooltipProvider>
	);
}
