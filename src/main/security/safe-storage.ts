import { safeStorage } from "electron";
import { createKeystore } from "./keystore";

/** The app keystore, backed by Electron safeStorage (async API only; the sync one is deprecated). */
export const keystore = createKeystore({
	available: () => safeStorage.isAsyncEncryptionAvailable(),
	seal: async (plain) => new Uint8Array(await safeStorage.encryptStringAsync(plain)),
	open: async (sealed) => (await safeStorage.decryptStringAsync(Buffer.from(sealed))).result,
});
