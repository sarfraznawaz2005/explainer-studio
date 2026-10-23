import { create } from "zustand";
import { aiChannels as ch, type ProviderView, type Slots } from "@shared/ipc/ai";
import { call } from "@renderer/lib/ipc";

type AiState = {
	providers: ProviderView[];
	slots: Slots;
	loaded: boolean;
	/** Provider ids with a connection test running. */
	testing: Record<string, boolean>;
	load: () => Promise<void>;
};

export const useAi = create<AiState>((set) => ({
	providers: [],
	slots: { planner: null, vision: null, cheap: null },
	loaded: false,
	testing: {},
	load: async () => {
		const [providers, slots] = await Promise.all([call(ch.list), call(ch.getSlots)]);
		set({ providers, slots, loaded: true });
	},
}));

/** Model lists per saved provider, shared by the slot pickers. Main caches them too. */
const modelLists = new Map<string, Promise<string[]>>();

export function providerModels(id: string, refresh = false): Promise<string[]> {
	if (refresh || !modelLists.has(id)) {
		const p = call(ch.models, { id, refresh });
		p.catch(() => modelLists.delete(id));
		modelLists.set(id, p);
	}
	return modelLists.get(id)!;
}

export function forgetModels(id: string): void {
	modelLists.delete(id);
}
