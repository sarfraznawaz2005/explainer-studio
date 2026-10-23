import { Slider as SliderPrimitive } from "radix-ui";
import { cn } from "@renderer/lib/utils";

/** A single-thumb slider. `onCommit` fires once when the user lets go. */
export function Slider({
	value,
	onChange,
	onCommit,
	min,
	max,
	step,
	ariaLabel,
	disabled,
	className,
}: {
	value: number;
	onChange: (v: number) => void;
	onCommit?: (v: number) => void;
	min: number;
	max: number;
	step: number;
	ariaLabel: string;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<SliderPrimitive.Root
			value={[value]}
			onValueChange={(v) => onChange(v[0]!)}
			onValueCommit={(v) => onCommit?.(v[0]!)}
			min={min}
			max={max}
			step={step}
			disabled={disabled}
			className={cn("relative flex h-5 w-full touch-none select-none items-center data-[disabled]:opacity-50", className)}
		>
			<SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-muted">
				<SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
			</SliderPrimitive.Track>
			<SliderPrimitive.Thumb
				aria-label={ariaLabel}
				className="block size-4 rounded-full border-2 border-primary bg-white shadow-sm transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
			/>
		</SliderPrimitive.Root>
	);
}
