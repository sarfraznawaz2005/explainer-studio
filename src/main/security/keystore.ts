import { registerSecret } from "./redact";

/**
 * API keys at rest. The sealer is Electron safeStorage in the app (Windows DPAPI,
 * bound to the user account) and a fake in unit tests.
 * Plain keys never go to logs or the database. They go to the renderer only when
 * the user clicks a "show key" button (assets:freesound:key:reveal).
 */
export type Sealer = {
	available(): Promise<boolean>;
	seal(plain: string): Promise<Uint8Array>;
	open(sealed: Uint8Array): Promise<string>;
};

export function createKeystore(sealer: Sealer) {
	return {
		async seal(plain: string): Promise<Uint8Array> {
			if (!(await sealer.available())) throw new Error("Secure storage is not available on this system");
			registerSecret(plain);
			return sealer.seal(plain);
		},
		/** Opens a sealed key and registers it for log redaction. Empty input gives "". */
		async open(sealed: Uint8Array | null | undefined): Promise<string> {
			if (!sealed || sealed.length === 0) return "";
			const plain = await sealer.open(sealed);
			registerSecret(plain);
			return plain;
		},
	};
}

export type Keystore = ReturnType<typeof createKeystore>;
