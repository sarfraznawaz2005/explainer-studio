import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

export const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[background-color,color,box-shadow,opacity] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
				secondary: "bg-muted text-foreground hover:bg-accent",
				outline: "border border-input bg-card text-foreground shadow-xs hover:bg-accent",
				ghost: "text-foreground hover:bg-accent",
				subtle: "text-muted-foreground hover:bg-accent hover:text-foreground",
				danger: "bg-danger text-white shadow-xs hover:bg-danger-hover",
				"danger-ghost": "text-danger hover:bg-danger-soft",
				link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
			},
			size: {
				sm: "h-8 px-3 text-[13px]",
				md: "h-9 px-4",
				lg: "h-11 px-5 text-[15px]",
				icon: "size-9",
				"icon-sm": "size-8",
			},
		},
		defaultVariants: { variant: "default", size: "md" },
	},
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
	asChild?: boolean;
	loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
	const classes = cn(buttonVariants({ variant, size }), className);
	// Slot needs exactly one child element, so the spinner is only added to real buttons.
	if (asChild) {
		return (
			<Slot.Root ref={ref} className={classes} {...props}>
				{children}
			</Slot.Root>
		);
	}
	return (
		<button ref={ref} className={classes} disabled={disabled || loading} {...props}>
			{loading ? <Loader2 className="animate-spin" /> : null}
			{children}
		</button>
	);
});
Button.displayName = "Button";
