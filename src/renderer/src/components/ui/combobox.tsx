import { Command } from "cmdk";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { cn } from "@renderer/lib/utils";

/**
 * Searchable picker for long lists (model ids). The typed text can be used as a
 * value too, because model lists are sometimes incomplete or unavailable.
 */
export function Combobox({
	value,
	onChange,
	options,
	placeholder = "Select…",
	searchPlaceholder = "Search…",
	ariaLabel,
	loading,
	disabled,
	allowCustom = true,
	emptyText = "Nothing found.",
	className,
	mono = true,
}: {
	value: string;
	onChange: (v: string) => void;
	options: string[];
	placeholder?: string;
	searchPlaceholder?: string;
	ariaLabel: string;
	loading?: boolean;
	disabled?: boolean;
	allowCustom?: boolean;
	emptyText?: string;
	className?: string;
	mono?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const q = query.trim();
	const custom = allowCustom && q && !options.includes(q) && /^[\w.:/@+-]+$/.test(q);
	const pick = (v: string) => {
		onChange(v);
		setOpen(false);
		setQuery("");
	};

	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger asChild disabled={disabled}>
				<button
					type="button"
					role="combobox"
					aria-expanded={open}
					aria-label={ariaLabel}
					className={cn(
						"flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-50",
						className,
					)}
				>
					<span className={cn("min-w-0 truncate", !value && "text-muted-foreground/70", value && mono && "font-mono text-[12.5px]")}>{value || placeholder}</span>
					{loading ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />}
				</button>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					align="start"
					sideOffset={6}
					className="z-50 w-[max(var(--radix-popover-trigger-width),280px)] animate-in overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
				>
					<Command loop>
						<Command.Input
							value={query}
							onValueChange={setQuery}
							placeholder={searchPlaceholder}
							className="h-10 w-full border-b bg-transparent px-3 text-[13px] outline-none placeholder:text-muted-foreground/70"
						/>
						<Command.List className="max-h-72 overflow-y-auto p-1">
							{loading && !options.length ? (
								<Command.Loading>
									<div className="flex items-center justify-center gap-2 py-6 text-[13px] text-muted-foreground">
										<Loader2 className="size-4 animate-spin" /> Loading models…
									</div>
								</Command.Loading>
							) : null}
							{!loading || options.length ? <Command.Empty className="py-6 text-center text-[13px] text-muted-foreground">{emptyText}</Command.Empty> : null}
							{custom ? (
								<Command.Item value={`__custom__${q}`} onSelect={() => pick(q)} className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[selected=true]:bg-accent">
									<Plus className="size-3.5 text-muted-foreground" />
									Use <span className="font-mono text-[12.5px]">{q}</span>
								</Command.Item>
							) : null}
							{options.map((o) => (
								<Command.Item
									key={o}
									value={o}
									onSelect={() => pick(o)}
									className={cn("flex h-8 items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[selected=true]:bg-accent", mono && "font-mono text-[12.5px]")}
								>
									<Check className={cn("size-3.5 shrink-0 text-primary", o === value ? "opacity-100" : "opacity-0")} />
									<span className="truncate">{o}</span>
								</Command.Item>
							))}
						</Command.List>
					</Command>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
