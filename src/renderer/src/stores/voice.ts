import { toast } from "sonner";
import { create } from "zustand";
import { InstallProgress, voiceChannels as ch, voiceEvents, type VoiceStatus } from "@shared/ipc/voice";
import { call, on } from "@renderer/lib/ipc";

type VoiceStore = {
	status: VoiceStatus | null;
	checking: boolean;
	refresh: () => Promise<void>;
};

export const useVoice = create<VoiceStore>((set) => ({
	status: null,
	checking: false,
	refresh: async () => {
		set({ checking: true });
		try {
			set({ status: await call(ch.status) });
		} finally {
			set({ checking: false });
		}
	},
}));

// One app-wide subscription: install progress keeps updating while the user is on other screens.
on(voiceEvents.progress, InstallProgress, (p) => {
	const s = useVoice.getState().status;
	if (s) useVoice.setState({ status: { ...s, state: "installing", install: p } });
	if (p.step === "done") {
		toast.success("Voice engine installed", { description: "You can now preview voices." });
		void useVoice.getState().refresh();
	} else if (p.step === "error") {
		toast.error("Voice install failed", { description: p.error });
		void useVoice.getState().refresh();
	} else if (p.step === "cancelled") void useVoice.getState().refresh();
});
