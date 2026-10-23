import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
	children,
	className,
	title,
	description,
	hideClose,
	...props
}: DialogPrimitive.DialogContentProps & { title: ReactNode; description?: ReactNode; hideClose?: boolean }) {
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-overlay bg-black/40 backdrop-blur-[2px] dark:bg-black/60" />
			<DialogPrimitive.Content
				className={cn(
					"fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 animate-in rounded-2xl border bg-popover p-6 text-popover-foreground shadow-lg focus:outline-none",
					className,
				)}
				{...props}
			>
				<DialogPrimitive.Title className="pr-8 text-base font-semibold tracking-tight">{title}</DialogPrimitive.Title>
				{description ? (
					<DialogPrimitive.Description className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</DialogPrimitive.Description>
				) : (
					<DialogPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogPrimitive.Description>
				)}
				{children}
				{hideClose ? null : (
					<DialogPrimitive.Close
						aria-label="Close"
						className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<X className="size-4" />
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
	return <div className={cn("mt-6 flex justify-end gap-2", className)}>{children}</div>;
}
