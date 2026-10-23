import { join } from "node:path";
import { appFolders } from "../app/folders";
import { db } from "../db/connection";
import { repos } from "../db/repos";
import { keystore } from "../security/safe-storage";
import { createPriceBook, type PriceBook } from "./pricing";
import { createAiService, type AiService } from "./service";
import { createAiStore } from "./store";

/** The app's AI store and service. Built on first use, after boot has opened the database and folders. */
export const aiStore = createAiStore({ repos, keystore, getDb: db });

let prices: PriceBook | null = null;
let service: AiService | null = null;

export function priceBook(): PriceBook {
	prices ??= createPriceBook({ cacheFile: join(appFolders().cache, "model-prices.json") });
	return prices;
}

export function ai(): AiService {
	service ??= createAiService({ store: aiStore, prices: priceBook() });
	return service;
}
