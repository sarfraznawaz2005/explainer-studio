import { Monitor, Moon, Search, Sun } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { useTheme } from "@renderer/stores/theme";
import { modKey } from "@renderer/lib/utils";
import { Kbd, Tooltip } from "../ui/primitives";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/misc";
import { Logo } from "./logo";
import { navItemFor } from "./nav";
import { useCommandPalette } from "./command-palette";

/**
 * Custom title bar. The whole bar drags the window; buttons opt out with no-drag.
 * The right 140 px are left free for the native window buttons (titleBarOverlay).
 */
export function TitleBar() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const page = navItemFor(pathname);
	const openPalette = useCommandPalette((s) => s.setOpen);
	const { pref, resolved, setPref } = useTheme();
	const ThemeIcon = pref === "system" ? Monitor : resolved === "dark" ? Moon : Sun;

	return (
		<header className="drag relative flex h-10 shrink-0 items-center border-b bg-background pr-[140px]">
			<div className="flex w-[200px] shrink-0 items-center gap-2.5 px-4">
				<Logo size={20} />
				<span className="text-[13px] font-semibold tracking-tight">Explainer Studio</span>
			</div>
			<div className="flex min-w-0 flex-1 items-center gap-2 px-4 text-[13px] text-muted-foreground">
				{page ? <span className="truncate font-medium text-foreground">{page.label}</span> : null}
			</div>
			<button
				onClick={() => openPalette(true)}
				className="no-drag absolute left-1/2 flex h-7 w-[min(36vw,380px)] -translate-x-1/2 items-center gap-2 rounded-lg border bg-subtle px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
			>
				<Search className="size-3.5" />
				<span className="flex-1 text-left">Search or jump to…</span>
				<Kbd>{modKey}</Kbd>
				<Kbd>K</Kbd>
			</button>
			<div className="no-drag flex items-center gap-1 px-2">
				<DropdownMenu>
					<Tooltip content="Theme" side="bottom">
						<DropdownMenuTrigger asChild>
							<button aria-label="Theme" className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
								<ThemeIcon className="size-4" />
							</button>
						</DropdownMenuTrigger>
					</Tooltip>
					<DropdownMenuContent>
						<DropdownMenuItem icon={Sun} checked={pref === "light"} onSelect={() => void setPref("light")}>
							Light
						</DropdownMenuItem>
						<DropdownMenuItem icon={Moon} checked={pref === "dark"} onSelect={() => void setPref("dark")}>
							Dark
						</DropdownMenuItem>
						<DropdownMenuItem icon={Monitor} checked={pref === "system"} onSelect={() => void setPref("system")}>
							System
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</header>
	);
}
