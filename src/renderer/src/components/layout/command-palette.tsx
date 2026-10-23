import { Command } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { CornerDownLeft, Monitor, Moon, Search, Sun, type LucideIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { create } from "zustand";
import { useTheme } from "@renderer/stores/theme";
import { modKey } from "@renderer/lib/utils";
import { Kbd } from "../ui/primitives";
import { ALL_NAV } from "./nav";

export const useCommandPalette = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
	open: false,
	setOpen: (open) => set({ open }),
}));

function Item({ icon: Icon, label, hint, keywords, onSelect }: { icon: LucideIcon; label: string; hint?: string; keywords?: string[]; onSelect: () => void }) {
	return (
		<Command.Item
			value={label}
			keywords={keywords}
			onSelect={onSelect}
			className="group flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] text-foreground outline-none data-[selected=true]:bg-accent"
		>
			<Icon className="size-4 text-muted-foreground group-data-[selected=true]:text-primary" />
			<span className="flex-1">{label}</span>
			{hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
			<CornerDownLeft className="size-3.5 text-muted-foreground opacity-0 group-data-[selected=true]:opacity-100" />
		</Command.Item>
	);
}

/** Ctrl+K palette: jump to any screen or run a quick action. Also owns the global shortcuts. */
export function CommandPalette() {
	const { open, setOpen } = useCommandPalette();
	const navigate = useNavigate();
	const setPref = useTheme((s) => s.setPref);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			if (!mod || e.altKey) return;
			const key = e.key.toLowerCase();
			if (key === "k") {
				e.preventDefault();
				setOpen(!useCommandPalette.getState().open);
			} else if (key === "n" && !e.shiftKey) {
				e.preventDefault();
				void navigate({ to: "/new" });
			} else if (key === ",") {
				e.preventDefault();
				void navigate({ to: "/settings" });
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [navigate, setOpen]);

	const run = (fn: () => void) => {
		setOpen(false);
		fn();
	};

	return (
		<DialogPrimitive.Root open={open} onOpenChange={setOpen}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-overlay bg-black/30 backdrop-blur-[2px] dark:bg-black/55" />
				<DialogPrimitive.Content className="fixed left-1/2 top-[14vh] z-50 w-[min(92vw,580px)] -translate-x-1/2 animate-in overflow-hidden rounded-2xl border bg-popover shadow-lg focus:outline-none">
					<DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
					<DialogPrimitive.Description className="sr-only">Search screens and actions</DialogPrimitive.Description>
					<Command loop className="flex flex-col">
						<div className="flex items-center gap-2.5 border-b px-4">
							<Search className="size-4 text-muted-foreground" />
							<Command.Input autoFocus placeholder="Type a command or search…" className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70" />
							<Kbd>Esc</Kbd>
						</div>
						<Command.List className="max-h-[min(56vh,420px)] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground/80">
							<Command.Empty className="py-10 text-center text-sm text-muted-foreground">No results.</Command.Empty>
							<Command.Group heading="Go to">
								{ALL_NAV.map((n) => (
									<Item
										key={n.to}
										icon={n.icon}
										label={n.label}
										keywords={n.keywords}
										hint={n.shortcut ? `${modKey} ${n.shortcut}` : undefined}
										onSelect={() => run(() => void navigate({ to: n.to }))}
									/>
								))}
							</Command.Group>
							<Command.Group heading="Appearance">
								<Item icon={Sun} label="Light theme" keywords={["theme", "appearance"]} onSelect={() => run(() => void setPref("light"))} />
								<Item icon={Moon} label="Dark theme" keywords={["theme", "appearance"]} onSelect={() => run(() => void setPref("dark"))} />
								<Item icon={Monitor} label="Use system theme" keywords={["theme", "appearance", "auto"]} onSelect={() => run(() => void setPref("system"))} />
							</Command.Group>
						</Command.List>
						<div className="flex items-center justify-between border-t bg-subtle/60 px-4 py-2 text-[11px] text-muted-foreground">
							<span className="flex items-center gap-1.5">
								<Kbd>↑</Kbd>
								<Kbd>↓</Kbd> to navigate
							</span>
							<span className="flex items-center gap-1.5">
								<Kbd>↵</Kbd> to select
							</span>
						</div>
					</Command>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
