import { Link } from "@tanstack/react-router";
import { CircleCheck, ExternalLink, FolderOpen, KeyRound, Layers, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { assetChannels } from "@shared/ipc/assets";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@renderer/components/ui/primitives";
import { call, errorText } from "@renderer/lib/ipc";

function FreesoundCard() {
	const [set, setSet] = useState<boolean | null>(null);
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		void call(assetChannels.freesoundKey).then((k) => setSet(k.set));
	}, []);
	const valid = /^[A-Za-z0-9]{8,200}$/.test(key.trim());

	const save = async () => {
		setBusy(true);
		try {
			const r = await call(assetChannels.freesoundSetKey, { key: key.trim() });
			setSet(r.set);
			setKey("");
			toast.success("Freesound key saved", { description: "The key worked. It is stored encrypted on this PC." });
		} catch (err) {
			toast.error("The key was not saved", { description: errorText(err) });
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		const ok = await confirm({ title: "Remove the Freesound key?", description: "You can no longer search Freesound until you add a key again. Sounds you already added stay in your library.", tone: "danger", confirmLabel: "Remove key" });
		if (!ok) return;
		await call(assetChannels.freesoundSetKey, { key: null });
		setSet(false);
		toast.success("Freesound key removed");
	};

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<CardTitle>Freesound</CardTitle>
					{set ? (
						<Badge tone="success">
							<CircleCheck className="size-3" />
							Key saved
						</Badge>
					) : set === false ? (
						<Badge>No key</Badge>
					) : null}
				</div>
				<CardDescription>Search more than 600,000 sounds. Only CC0 and CC BY sounds are shown; NonCommercial sounds are always hidden.</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<form
					className="flex items-end gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (valid) void save();
					}}
				>
					<div className="flex-1 space-y-1.5">
						<Label htmlFor="fs-key">{set ? "Replace API key" : "API key"}</Label>
						<Input id="fs-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder={set ? "••••••••••••••••" : "Paste your Freesound API key"} aria-invalid={!!key && !valid} />
					</div>
					<Button type="submit" disabled={!valid} loading={busy}>
						{busy ? null : <KeyRound />}
						Test and save
					</Button>
					{set ? (
						<Button type="button" variant="danger-ghost" onClick={() => void remove()}>
							Remove
						</Button>
					) : null}
				</form>
				<p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
					<ShieldCheck className="size-3.5 text-success" />
					Stored with Windows encryption. It is never shown again, logged, or sent anywhere except freesound.org.
					<a href="https://freesound.org/apiv2/apply/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
						Get a free key
						<ExternalLink className="size-3" />
					</a>
				</p>
			</CardContent>
		</Card>
	);
}

export function AssetSettings() {
	return (
		<div className="space-y-5">
			<FreesoundCard />
			<Card>
				<CardHeader className="flex-row items-center justify-between gap-4 space-y-0 pb-5">
					<div>
						<CardTitle>Licenses</CardTitle>
						<CardDescription className="mt-1">Every asset keeps its license, author and source. License files for the starter pack are kept in one folder.</CardDescription>
					</div>
					<div className="flex shrink-0 gap-2">
						<Button variant="outline" onClick={() => void call(assetChannels.revealLicenses).catch((err) => toast.error("Could not open the folder", { description: errorText(err) }))}>
							<FolderOpen />
							Open folder
						</Button>
						<Button variant="ghost" asChild>
							<Link to="/assets">
								<Layers />
								Assets
							</Link>
						</Button>
					</div>
				</CardHeader>
			</Card>
		</div>
	);
}
