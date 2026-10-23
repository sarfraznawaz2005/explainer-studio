import { AlertDialog } from "radix-ui";
import { AlertTriangle, Info } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { create } from "zustand";
import { cn } from "@renderer/lib/utils";
import { Button } from "./button";
import { Input } from "./primitives";

export interface ConfirmOptions {
	title: string;
	description?: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	/** "danger" for destructive actions (red button, warning icon). */
	tone?: "default" | "danger";
	/** When set, the user must type this exact text before the confirm button enables. */
	typeToConfirm?: string;
}

interface ConfirmState {
	open: boolean;
	opts: ConfirmOptions | null;
	resolve: ((ok: boolean) => void) | null;
	ask: (opts: ConfirmOptions) => Promise<boolean>;
	settle: (ok: boolean) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
	open: false,
	opts: null,
	resolve: null,
	ask: (opts) =>
		new Promise<boolean>((resolve) => {
			// A second ask while one is open cancels the first, so no promise is left hanging.
			get().resolve?.(false);
			set({ open: true, opts, resolve });
		}),
	settle: (ok) => {
		get().resolve?.(ok);
		set({ open: false, resolve: null });
	},
}));

/**
 * Ask the user to confirm. Resolves true on confirm, false on cancel/escape.
 *   if (await confirm({ title: "Delete video?", tone: "danger" })) ...
 */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
	return useConfirmStore.getState().ask(opts);
}

/** Mounted once at the app root. */
export function ConfirmHost() {
	const { open, opts, settle } = useConfirmStore();
	const [typed, setTyped] = useState("");
	useEffect(() => {
		if (open) setTyped("");
	}, [open]);
	if (!opts) return null;
	const danger = opts.tone === "danger";
	const blocked = !!opts.typeToConfirm && typed !== opts.typeToConfirm;
	const Icon = danger ? AlertTriangle : Info;

	return (
		<AlertDialog.Root open={open} onOpenChange={(o) => !o && settle(false)}>
			<AlertDialog.Portal>
				<AlertDialog.Overlay className="fixed inset-0 z-50 animate-overlay bg-black/40 backdrop-blur-[2px] dark:bg-black/60" />
				<AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 animate-in rounded-2xl border bg-popover p-6 shadow-lg focus:outline-none">
					<div className="flex gap-4">
						<div
							className={cn(
								"flex size-10 shrink-0 items-center justify-center rounded-full",
								danger ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary-soft-foreground",
							)}
						>
							<Icon className="size-5" />
						</div>
						<div className="min-w-0 flex-1">
							<AlertDialog.Title className="text-base font-semibold tracking-tight">{opts.title}</AlertDialog.Title>
							{opts.description ? (
								<AlertDialog.Description className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{opts.description}</AlertDialog.Description>
							) : (
								<AlertDialog.Description className="sr-only">{opts.title}</AlertDialog.Description>
							)}
							{opts.typeToConfirm ? (
								<div className="mt-4 space-y-2">
									<p className="text-[13px] text-muted-foreground">
										Type <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">{opts.typeToConfirm}</span> to confirm.
									</p>
									<Input
										autoFocus
										value={typed}
										onChange={(e) => setTyped(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter" && !blocked) settle(true);
										}}
										aria-label={`Type ${opts.typeToConfirm} to confirm`}
									/>
								</div>
							) : null}
						</div>
					</div>
					<div className="mt-6 flex justify-end gap-2">
						<AlertDialog.Cancel asChild>
							<Button variant="outline">{opts.cancelLabel ?? "Cancel"}</Button>
						</AlertDialog.Cancel>
						<Button variant={danger ? "danger" : "default"} disabled={blocked} onClick={() => settle(true)} autoFocus={!opts.typeToConfirm && !danger}>
							{opts.confirmLabel ?? (danger ? "Delete" : "Confirm")}
						</Button>
					</div>
				</AlertDialog.Content>
			</AlertDialog.Portal>
		</AlertDialog.Root>
	);
}
