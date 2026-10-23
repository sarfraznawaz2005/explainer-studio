import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "../ui/button";

/** Shown instead of a blank page when a screen throws. */
export function ErrorScreen({ error, reset }: ErrorComponentProps) {
	const router = useRouter();
	return (
		<div className="flex flex-col items-center justify-center py-24 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
				<TriangleAlert className="size-6" />
			</div>
			<h2 className="mt-4 text-lg font-semibold tracking-tight">Something went wrong on this screen</h2>
			<p className="mt-1.5 max-w-md text-sm text-muted-foreground">Your work is safe. Try again, or go to another screen.</p>
			<pre data-selectable className="mt-4 max-w-xl overflow-x-auto rounded-lg border bg-subtle px-3 py-2 text-left font-mono text-[12px] text-muted-foreground">
				{error instanceof Error ? error.message : String(error)}
			</pre>
			<Button
				className="mt-6"
				variant="outline"
				onClick={() => {
					reset();
					void router.invalidate();
				}}
			>
				<RotateCcw />
				Try again
			</Button>
		</div>
	);
}
