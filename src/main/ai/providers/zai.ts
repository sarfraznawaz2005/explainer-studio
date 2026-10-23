import { OpenAICompatibleAdapter } from "./openai-compatible";
import type { ProviderConfig } from "./types";

const ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";

export class ZaiAdapter extends OpenAICompatibleAdapter {
	constructor(config: ProviderConfig) {
		super(config, { name: "zai", baseURL: ZAI_BASE_URL });
	}
}
