/// <reference types="vite/client" />
import type { StudioApi } from "../../preload";

declare global {
	interface Window {
		studio: StudioApi;
	}
}
