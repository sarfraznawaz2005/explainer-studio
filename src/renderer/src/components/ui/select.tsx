import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

export type SelectOption<T extends string> = { value: T; label: ReactNode; hint?: ReactNode; disabled?: boolean };

/** Styled single-choice list for short option sets. For long, searchable lists use Combobox. */
export function Select<T extends string>({
	value,
	onChange,
	options,
	placeholder,
	ariaLabel,
	disabled,
	className,
}: {
	value: T | undefined;
	onChange: (v: T) => void;
	options: SelectOption<T>[];
	placeholder?: string;
	ariaLabel: string;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<SelectPrimitive.Root value={value ?? ""} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
			<SelectPrimitive.Trigger
				aria-label={ariaLabel}
				className={cn(
					"flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-50 data-[placeholder]:text-muted-foreground/70",
					className,
				)}
			>
				<span className="min-w-0 truncate">
					<SelectPrimitive.Value placeholder={placeholder} />
				</span>
				<SelectPrimitive.Icon>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</SelectPrimitive.Icon>
			</SelectPrimitive.Trigger>
			<SelectPrimitive.Portal>
				<SelectPrimitive.Content
					position="popper"
					sideOffset={6}
					className="z-50 max-h-[min(var(--radix-select-content-available-height),360px)] min-w-[var(--radix-select-trigger-width)] animate-in overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
				>
					<SelectPrimitive.Viewport className="p-1">
						{options.map((o) => (
							<SelectPrimitive.Item
								key={o.value}
								value={o.value}
								disabled={o.disabled}
								className="relative flex h-8 cursor-default select-none items-center gap-2 rounded-md pl-2 pr-8 text-[13px] outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
							>
								<SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
								{o.hint ? <span className="ml-auto text-[11px] text-muted-foreground">{o.hint}</span> : null}
								<SelectPrimitive.ItemIndicator className="absolute right-2">
									<Check className="size-3.5 text-primary" />
								</SelectPrimitive.ItemIndicator>
							</SelectPrimitive.Item>
						))}
					</SelectPrimitive.Viewport>
				</SelectPrimitive.Content>
			</SelectPrimitive.Portal>
		</SelectPrimitive.Root>
	);
}
