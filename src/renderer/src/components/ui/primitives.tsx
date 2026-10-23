import { cva, type VariantProps } from "class-variance-authority";
import { Separator as SeparatorPrimitive, Tooltip as TooltipPrimitive } from "radix-ui";
import { forwardRef, type HTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

/* ---------- Card ---------- */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("rounded-xl border bg-card text-card-foreground shadow-xs", className)} {...props} />;
}
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />;
}
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
	return <h3 className={cn("text-[15px] font-semibold tracking-tight", className)} {...props} />;
}
export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
	return <p className={cn("text-[13px] text-muted-foreground", className)} {...props} />;
}
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("p-5 pt-0", className)} {...props} />;
}

/* ---------- Badge ---------- */

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4", {
	variants: {
		tone: {
			neutral: "bg-muted text-muted-foreground",
			primary: "bg-primary-soft text-primary-soft-foreground",
			success: "bg-success-soft text-success",
			warning: "bg-warning-soft text-warning",
			danger: "bg-danger-soft text-danger",
		},
	},
	defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
	return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* ---------- Form fields ---------- */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
	<input
		ref={ref}
		className={cn(
			"h-9 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-50",
			className,
		)}
		{...props}
	/>
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
	<textarea
		ref={ref}
		className={cn(
			"min-h-24 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20",
			className,
		)}
		{...props}
	/>
));
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
	return <label className={cn("text-[13px] font-medium", className)} {...props} />;
}

/* ---------- Kbd ---------- */

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
	return (
		<kbd
			className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-md border bg-subtle px-1.5 font-sans text-[11px] font-medium text-muted-foreground", className)}
			{...props}
		/>
	);
}

/* ---------- Separator ---------- */

export function Separator({ className, orientation = "horizontal", ...props }: SeparatorPrimitive.SeparatorProps) {
	return (
		<SeparatorPrimitive.Root
			orientation={orientation}
			className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
			{...props}
		/>
	);
}

/* ---------- Tooltip ---------- */

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, side = "top", children }: { content: ReactNode; side?: "top" | "right" | "bottom" | "left"; children: ReactNode }) {
	return (
		<TooltipPrimitive.Root>
			<TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Content
					side={side}
					sideOffset={6}
					className="z-50 animate-in rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md"
				>
					{content}
				</TooltipPrimitive.Content>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	);
}

/* ---------- Page header ---------- */

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
	return (
		<div className="flex items-end justify-between gap-6 pb-6">
			<div className="min-w-0">
				<h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
				{description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
			</div>
			{actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
		</div>
	);
}
