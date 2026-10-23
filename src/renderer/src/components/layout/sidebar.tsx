import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "motion/react";
import { cn } from "@renderer/lib/utils";
import { NAV, SETTINGS_ITEM, type NavItem } from "./nav";

function isActive(item: NavItem, pathname: string): boolean {
	return item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
	const active = isActive(item, pathname);
	const Icon = item.icon;
	return (
		<Link
			to={item.to}
			className={cn(
				"group relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
				active ? "text-foreground" : "text-muted-foreground hover:bg-sidebar-hover hover:text-foreground",
			)}
		>
			{active ? (
				<motion.span
					layoutId="nav-active"
					className="absolute inset-0 rounded-lg border border-border/70 bg-sidebar-active shadow-xs"
					transition={{ type: "spring", stiffness: 500, damping: 38 }}
				/>
			) : null}
			<Icon className={cn("relative size-4 shrink-0", active ? "text-primary" : "")} strokeWidth={active ? 2.25 : 2} />
			<span className="relative truncate">{item.label}</span>
		</Link>
	);
}

export function Sidebar() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	return (
		<aside className="flex w-[200px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
			<nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4" aria-label="Main">
				{NAV.map((group, gi) => (
					<div key={gi} className="space-y-1">
						{group.label ? <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">{group.label}</div> : null}
						{group.items.map((item) => (
							<NavLink key={item.to} item={item} pathname={pathname} />
						))}
					</div>
				))}
			</nav>
			<div className="border-t border-sidebar-border px-2.5 py-3">
				<NavLink item={SETTINGS_ITEM} pathname={pathname} />
			</div>
		</aside>
	);
}
