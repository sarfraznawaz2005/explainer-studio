import { toast } from "sonner";
import { create } from "zustand";
import { z } from "zod";
import { StarterStatus } from "@shared/assets";
import { assetChannels, assetEvents } from "@shared/ipc/assets";
import { call, on } from "@renderer/lib/ipc";

type AssetStore = {
	starter: StarterStatus | null;
	/** Bumped whenever the library changes, so lists reload. */
	version: number;
	refreshStarter: () => Promise<void>;
};

export const useAssets = create<AssetStore>((set) => ({
	starter: null,
	version: 0,
	refreshStarter: async () => set({ starter: await call(assetChannels.starterStatus) }),
}));

on(assetEvents.starter, StarterStatus, (s) => {
	const was = useAssets.getState().starter?.state;
	useAssets.setState({ starter: s });
	if (was === "installing" && s.state === "installed") toast.success("Starter pack installed", { description: `${s.total} free music tracks and sound effects are ready in Assets.` });
	else if (was === "installing" && s.state === "failed") toast.error("Starter pack failed", { description: s.error });
});

on(assetEvents.changed, z.object({ at: z.number() }), () => useAssets.setState((s) => ({ version: s.version + 1 })));

/* ---------- One shared audio player for previews ---------- */

type PlayerStore = { url: string | null; play: (url: string) => void; stop: () => void };

let el: HTMLAudioElement | null = null;

export const usePreviewAudio = create<PlayerStore>((set, get) => ({
	url: null,
	play: (url) => {
		if (get().url === url) return get().stop();
		el?.pause();
		el = new Audio(url);
		el.volume = 0.9;
		el.onended = () => set({ url: null });
		el.onerror = () => {
			set({ url: null });
			toast.error("This file could not be played.");
		};
		void el.play().catch(() => set({ url: null }));
		set({ url });
	},
	stop: () => {
		el?.pause();
		el = null;
		set({ url: null });
	},
}));
