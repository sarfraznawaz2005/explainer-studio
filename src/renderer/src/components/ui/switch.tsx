import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@renderer/lib/utils";

export function Switch({
	checked,
	onChange,
	ariaLabel,
	disabled,
	className,
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
	ariaLabel: string;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<SwitchPrimitive.Root
			checked={checked}
			onCheckedChange={onChange}
			aria-label={ariaLabel}
			disabled={disabled}
			className={cn(
				"inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-input transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 data-[state=checked]:bg-primary",
				className,
			)}
		>
			<SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
		</SwitchPrimitive.Root>
	);
}
