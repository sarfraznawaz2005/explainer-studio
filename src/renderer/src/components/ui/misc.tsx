import type { LucideIcon } from "lucide-react";
import { DropdownMenu as Menu } from "radix-ui";
import type { ReactNode } from "react";
import { Toaster as Sonner } from "sonner";
import { useTheme } from "@renderer/stores/theme";
import { cn } from "@renderer/lib/utils";

/* ---------- Empty state ---------- */

export function EmptyState({
	icon: Icon,
	title,
	description,
	actions,
	children,
	className,
}: {
	icon: LucideIcon;
	title: string;
	description: string;
	actions?: ReactNode;
	children?: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed bg-subtle/60 px-8 py-16 text-center", className)}>
			<div className="relative mb-5">
				<div className="absolute inset-0 -z-10 scale-150 rounded-full bg-primary/10 blur-2xl" />
				<div className="flex size-14 items-center justify-center rounded-2xl border bg-card text-primary shadow-sm">
					<Icon className="size-6" strokeWidth={1.75} />
				</div>
			</div>
			<h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
			<p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
			{actions ? <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
			{children}
		</div>
	);
}

/* ---------- Segmented control ---------- */

export function Segmented<T extends string>({
	value,
	onChange,
	options,
	ariaLabel,
}: {
	value: T;
	onChange: (v: T) => void;
	options: { value: T; label: string; icon?: LucideIcon }[];
	ariaLabel: string;
}) {
	return (
		<div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-lg border bg-muted p-0.5">
			{options.map((o) => {
				const active = o.value === value;
				return (
					<button
						key={o.value}
						role="radio"
						aria-checked={active}
						onClick={() => onChange(o.value)}
						className={cn(
							"inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-all",
							active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
						)}
					>
						{o.icon ? <o.icon className="size-3.5" /> : null}
						{o.label}
					</button>
				);
			})}
		</div>
	);
}

/* ---------- Dropdown menu ---------- */

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({ children, align = "end" }: { children: ReactNode; align?: "start" | "center" | "end" }) {
	return (
		<Menu.Portal>
			<Menu.Content
				align={align}
				sideOffset={6}
				className="z-50 min-w-44 animate-in rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
			>
				{children}
			</Menu.Content>
		</Menu.Portal>
	);
}

export function DropdownMenuItem({
	children,
	onSelect,
	icon: Icon,
	danger,
	checked,
}: {
	children: ReactNode;
	onSelect?: () => void;
	icon?: LucideIcon;
	danger?: boolean;
	checked?: boolean;
}) {
	return (
		<Menu.Item
			onSelect={onSelect}
			className={cn(
				"flex h-8 items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[highlighted]:bg-accent",
				danger && "text-danger data-[highlighted]:bg-danger-soft",
			)}
		>
			{Icon ? <Icon className="size-4 opacity-80" /> : null}
			<span className="flex-1">{children}</span>
			{checked ? <span className="size-1.5 rounded-full bg-primary" /> : null}
		</Menu.Item>
	);
}

export const DropdownMenuSeparator = () => <Menu.Separator className="my-1 h-px bg-border" />;

/* ---------- Toaster ---------- */

export function Toaster() {
	const resolved = useTheme((s) => s.resolved);
	return (
		<Sonner
			theme={resolved}
			position="bottom-right"
			offset={20}
			toastOptions={{
				classNames: {
					toast: "!rounded-xl !border !border-border !bg-popover !text-popover-foreground !shadow-lg !font-sans",
					description: "!text-muted-foreground",
					actionButton: "!bg-primary !text-primary-foreground",
					success: "[&_[data-icon]]:!text-success",
					error: "[&_[data-icon]]:!text-danger",
				},
			}}
		/>
	);
}
