import { Bot, Cpu, HardDrive, Info, Layers, Mic, Monitor, Moon, Paintbrush, RotateCcw, Sun, TriangleAlert, type LucideIcon } from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { appChannels } from "@shared/ipc/app";
import type { ThemePref } from "@shared/ipc/app";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@renderer/components/ui/primitives";
import { call } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { useTheme } from "@renderer/stores/theme";
import { AiSettings } from "./settings-ai";
import { AssetSettings } from "./settings-assets";
import { RenderSettings } from "./settings-render";
import { StorageSettings } from "./settings-storage";
import { VoiceSettings } from "./settings-voice";

type Section = "appearance" | "ai" | "voice" | "assets" | "render" | "storage" | "about";

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
	{ id: "appearance", label: "Appearance", icon: Paintbrush },
	{ id: "ai", label: "AI providers", icon: Bot },
	{ id: "voice", label: "Voice", icon: Mic },
	{ id: "assets", label: "Assets", icon: Layers },
	{ id: "render", label: "Rendering", icon: Cpu },
	{ id: "storage", label: "Storage", icon: HardDrive },
	{ id: "about", label: "About", icon: Info },
];

/** A small drawing of the app in each theme, used as the theme picker. */
function ThemePreview({ mode }: { mode: "light" | "dark" | "system" }) {
	const pane = (dark: boolean) => (
		<div className={cn("flex h-full flex-1 gap-1.5 p-2", dark ? "bg-[#0c0c0f]" : "bg-[#fbfbfc]")}>
			<div className={cn("w-1/4 space-y-1 rounded-sm p-1", dark ? "bg-[#131317]" : "bg-[#f0f0f3]")}>
				<div className="h-1 w-3/4 rounded-full bg-[oklch(0.6_0.2_277)]" />
				<div className={cn("h-1 w-2/3 rounded-full", dark ? "bg-[#2c2c35]" : "bg-[#dcdce2]")} />
				<div className={cn("h-1 w-1/2 rounded-full", dark ? "bg-[#2c2c35]" : "bg-[#dcdce2]")} />
			</div>
			<div className={cn("flex-1 space-y-1 rounded-sm p-1.5", dark ? "bg-[#131317]" : "bg-white")}>
				<div className={cn("h-1.5 w-1/2 rounded-full", dark ? "bg-[#3a3a44]" : "bg-[#d4d4da]")} />
				<div className={cn("h-1 w-5/6 rounded-full", dark ? "bg-[#26262d]" : "bg-[#ebebef]")} />
				<div className="mt-2 h-2.5 w-1/3 rounded-sm bg-[oklch(0.6_0.2_277)]" />
			</div>
		</div>
	);
	return (
		<div className="flex h-20 overflow-hidden rounded-lg border">
			{mode === "system" ? (
				<>
					{pane(false)}
					{pane(true)}
				</>
			) : (
				pane(mode === "dark")
			)}
		</div>
	);
}

function Appearance() {
	const { pref, setPref } = useTheme();
	const options: { value: ThemePref; label: string; icon: LucideIcon }[] = [
		{ value: "light", label: "Light", icon: Sun },
		{ value: "dark", label: "Dark", icon: Moon },
		{ value: "system", label: "System", icon: Monitor },
	];

	const resetAppearance = async () => {
		if (pref === "system") {
			toast("Appearance is already at its default.");
			return;
		}
		const ok = await confirm({
			title: "Reset appearance?",
			description: "The theme goes back to following your Windows setting.",
			confirmLabel: "Reset",
		});
		if (!ok) return;
		await setPref("system");
		toast.success("Appearance reset", { description: "Theme now follows your system." });
	};

	return (
		<div className="space-y-5">
			<Card>
				<CardHeader>
					<CardTitle>Theme</CardTitle>
					<CardDescription>Choose how Explainer Studio looks. System follows your Windows setting.</CardDescription>
				</CardHeader>
				<CardContent>
					<div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
						{options.map((o) => {
							const active = pref === o.value;
							return (
								<button
									key={o.value}
									role="radio"
									aria-checked={active}
									onClick={() => void setPref(o.value)}
									className={cn(
										"rounded-xl border p-2 text-left transition-all",
										active ? "border-primary ring-3 ring-primary/20" : "hover:border-input hover:bg-subtle",
									)}
								>
									<ThemePreview mode={o.value} />
									<div className="flex items-center gap-2 px-1 pb-0.5 pt-2.5 text-[13px] font-medium">
										<o.icon className="size-3.5 text-muted-foreground" />
										{o.label}
										{active ? <span className="ml-auto size-2 rounded-full bg-primary" /> : null}
									</div>
								</button>
							);
						})}
					</div>
				</CardContent>
			</Card>
			<Card>
				<CardHeader className="flex-row items-center justify-between gap-4 space-y-0 pb-5">
					<div>
						<CardTitle>Reset appearance</CardTitle>
						<CardDescription className="mt-1">Return theme settings to their defaults.</CardDescription>
					</div>
					<Button variant="outline" onClick={() => void resetAppearance()}>
						<RotateCcw />
						Reset
					</Button>
				</CardHeader>
			</Card>
			<Card className="border-danger/30">
				<CardHeader className="flex-row items-center justify-between gap-4 space-y-0 pb-5">
					<div>
						<CardTitle className="flex items-center gap-2 text-danger">
							<TriangleAlert className="size-4" />
							Reset all settings
						</CardTitle>
						<CardDescription className="mt-1">Restores every preference to its default. Videos, drafts and assets are not touched.</CardDescription>
					</div>
					<Button
						variant="danger-ghost"
						className="border border-danger/30"
						onClick={async () => {
							const ok = await confirm({
								title: "Reset all settings?",
								description: "Every preference returns to its default. This cannot be undone.",
								tone: "danger",
								confirmLabel: "Reset everything",
								typeToConfirm: "RESET",
							});
							if (!ok) return;
							await setPref("system");
							toast.success("Settings reset to defaults");
						}}
					>
						Reset all
					</Button>
				</CardHeader>
			</Card>
		</div>
	);
}

function About() {
	const [info, setInfo] = useState<{ name: string; version: string; platform: string; isPackaged: boolean } | null>(null);
	useEffect(() => {
		void call(appChannels.info).then(setInfo);
	}, []);
	return (
		<Card>
			<CardHeader>
				<CardTitle>Explainer Studio</CardTitle>
				<CardDescription>Long-form explainer videos from any learning material.</CardDescription>
			</CardHeader>
			<CardContent>
				<dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
					<dt className="text-muted-foreground">Version</dt>
					<dd className="font-medium tabular-nums" data-selectable>
						{info?.version ?? "—"}
					</dd>
					<dt className="text-muted-foreground">Build</dt>
					<dd className="font-medium">{info ? (info.isPackaged ? "Release" : "Development") : "—"}</dd>
					<dt className="text-muted-foreground">Platform</dt>
					<dd className="font-medium">{info?.platform ?? "—"}</dd>
				</dl>
			</CardContent>
		</Card>
	);
}

export function SettingsPage() {
	const search = useSearch({ strict: false });
	const navigate = useNavigate();
	const section: Section = SECTIONS.find((x) => x.id === search.section)?.id ?? "appearance";
	const setSection = (id: Section) => void navigate({ to: "/settings", search: { section: id }, replace: true });
	return (
		<div>
			<PageHeader title="Settings" description="Preferences for the app, AI, voice and rendering." />
			<div className="grid grid-cols-[200px_1fr] gap-8">
				<nav className="space-y-0.5" aria-label="Settings sections">
					{SECTIONS.map((s) => (
						<button
							key={s.id}
							onClick={() => setSection(s.id)}
							className={cn(
								"flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
								section === s.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
							)}
						>
							<s.icon className="size-4" />
							{s.label}
						</button>
					))}
				</nav>
				<div className="min-w-0">
					{section === "appearance" ? <Appearance /> : null}
					{section === "ai" ? <AiSettings /> : null}
					{section === "voice" ? <VoiceSettings /> : null}
					{section === "assets" ? <AssetSettings /> : null}
					{section === "render" ? <RenderSettings /> : null}
					{section === "storage" ? <StorageSettings /> : null}
					{section === "about" ? <About /> : null}
				</div>
			</div>
		</div>
	);
}
