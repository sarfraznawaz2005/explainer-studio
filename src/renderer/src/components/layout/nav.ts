import {
	Clapperboard,
	FileStack,
	Home,
	Layers,
	Library,
	ListVideo,
	Palette,
	Plus,
	Settings,
	Sparkles,
	type LucideIcon,
} from "lucide-react";

export interface NavItem {
	to: string;
	label: string;
	icon: LucideIcon;
	/** Words the command palette also matches on. */
	keywords?: string[];
	shortcut?: string;
}

export interface NavGroup {
	label?: string;
	items: NavItem[];
}

export const NAV: NavGroup[] = [
	{
		items: [
			{ to: "/", label: "Home", icon: Home, keywords: ["dashboard", "start"] },
			{ to: "/new", label: "New Video", icon: Plus, keywords: ["create", "upload", "pdf", "generate"], shortcut: "N" },
			{ to: "/studio", label: "Studio", icon: Sparkles, keywords: ["editor", "preview", "scenes", "edit"] },
		],
	},
	{
		label: "Library",
		items: [
			{ to: "/library", label: "Videos", icon: Clapperboard, keywords: ["library", "past", "finished", "exports"] },
			{ to: "/drafts", label: "Drafts", icon: FileStack, keywords: ["unfinished", "work in progress"] },
			{ to: "/series", label: "Series", icon: Library, keywords: ["episodes", "playlist", "course", "unit"] },
			{ to: "/queue", label: "Render Queue", icon: ListVideo, keywords: ["jobs", "progress", "rendering"] },
		],
	},
	{
		label: "Resources",
		items: [
			{ to: "/assets", label: "Assets", icon: Layers, keywords: ["music", "sound", "sfx", "voices", "fonts"] },
			{ to: "/brand", label: "Brand Kit", icon: Palette, keywords: ["logo", "colours", "colors", "intro", "outro", "watermark"] },
		],
	},
];

export const SETTINGS_ITEM: NavItem = { to: "/settings", label: "Settings", icon: Settings, keywords: ["preferences", "providers", "api", "theme"], shortcut: "," };

export const ALL_NAV: NavItem[] = [...NAV.flatMap((g) => g.items), SETTINGS_ITEM];

export function navItemFor(pathname: string): NavItem | undefined {
	return ALL_NAV.find((i) => (i.to === "/" ? pathname === "/" : pathname.startsWith(i.to)));
}
