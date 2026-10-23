import type { Voice } from "@shared/ipc/voice";
import type { Pinned } from "./download";

/** Kokoro's best-rated English voices (VOICES.md grades A to B-). Shown first. */
const RECOMMENDED = new Set(["af_heart", "af_bella", "af_nicole", "am_michael", "am_fenrir", "am_puck", "bf_emma", "bm_george", "bm_fable"]);

/**
 * Kokoro names voices <accent><gender>_<name>. Only accents whose words espeak can
 * read without extra packs are offered (Japanese and Chinese need more packages).
 * `lang` is the espeak language, `language` the plan language code.
 */
const KOKORO_ACCENTS: Record<string, { accent: string; group: string; lang: string; language: string }> = {
	a: { accent: "American", group: "American English", lang: "en-us", language: "en" },
	b: { accent: "British", group: "British English", lang: "en-gb", language: "en" },
	e: { accent: "Spanish", group: "Spanish", lang: "es", language: "es" },
	f: { accent: "French", group: "French", lang: "fr-fr", language: "fr" },
	h: { accent: "Hindi", group: "Hindi", lang: "hi", language: "hi" },
	p: { accent: "Brazilian", group: "Portuguese", lang: "pt-br", language: "pt" },
};

const PIPER_REV = "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd";

/**
 * Piper voices for languages Kokoro does not speak (MIT, from rhasspy/piper-voices at a fixed
 * commit; hashes measured once and pinned). Each is downloaded the first time it is used.
 */
export const PIPER_VOICES: Record<string, { name: string; gender: "female" | "male"; language: string; accent: string; key: string; model: Pinned; config: Pinned }> = {
	ur_fasih: {
		name: "Fasih",
		gender: "male",
		language: "ur",
		accent: "Urdu",
		key: "ur_PK-fasih-medium",
		model: { url: `${PIPER_REV}/ur/ur_PK/fasih/medium/ur_PK-fasih-medium.onnx`, bytes: 63_532_015, sha256: "46d590b90fbb41e4d4f2c54ded44874917f8b11b6e0500de2a89e5d3731b5917" },
		config: { url: `${PIPER_REV}/ur/ur_PK/fasih/medium/ur_PK-fasih-medium.onnx.json`, bytes: 3_146, sha256: "cfcf484a50b4036cb55675b6bbcdb9ddb9061ac10a51cfb2b3ce8391213205ec" },
	},
	ur_aegis: {
		name: "Aegis",
		gender: "female",
		language: "ur",
		accent: "Urdu",
		key: "ur_PK-aegis_female-medium",
		model: { url: `${PIPER_REV}/ur/ur_PK/aegis_female/medium/ur_PK-aegis_female-medium.onnx`, bytes: 63_515_589, sha256: "3ec306035cfd0bbc22342fee5890450708a16dd231809522731678aa583c961f" },
		config: { url: `${PIPER_REV}/ur/ur_PK/aegis_female/medium/ur_PK-aegis_female-medium.onnx.json`, bytes: 5_236, sha256: "a8385c217a7e276acf5234bf01dbd0adb007a57c32ffbcc57d2db7eac3979bb6" },
	},
};

export const piperVoice = (id: string) => (Object.hasOwn(PIPER_VOICES, id) ? PIPER_VOICES[id]! : null);

/**
 * The voices the app offers: Kokoro voices (from the installed voices file) plus the Piper voices.
 * `downloaded` tells which Piper voices are already on disk.
 */
export function describeVoices(ids: string[], downloaded: (id: string) => boolean = () => true): Voice[] {
	const out: Voice[] = [];
	for (const id of ids) {
		const m = /^([a-z])([fm])_([a-z0-9]+)$/.exec(id);
		const a = m ? KOKORO_ACCENTS[m[1]!] : undefined;
		if (!m || !a) continue;
		const name = m[3]!;
		out.push({
			id,
			name: name.charAt(0).toUpperCase() + name.slice(1),
			accent: a.accent,
			group: a.group,
			language: a.language,
			gender: m[2] === "f" ? "female" : "male",
			recommended: RECOMMENDED.has(id),
			engine: "kokoro",
			downloadBytes: 0,
		});
	}
	for (const [id, p] of Object.entries(PIPER_VOICES))
		out.push({
			id,
			name: p.name,
			accent: p.accent,
			group: p.accent,
			language: p.language,
			gender: p.gender,
			recommended: false,
			engine: "piper",
			downloadBytes: downloaded(id) ? 0 : p.model.bytes + p.config.bytes,
		});
	// English first (top picks first), then the other languages by name.
	const en = (v: Voice) => (v.language === "en" ? 0 : 1);
	return out.sort(
		(a, b) => en(a) - en(b) || (en(a) ? a.group.localeCompare(b.group) : 0) || Number(b.recommended) - Number(a.recommended) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name),
	);
}

/** espeak language for a Kokoro voice, from its first letter. */
export const langOf = (voice: string) => KOKORO_ACCENTS[voice.charAt(0)]?.lang ?? "en-us";

/** A short sample in the voice's own language. */
export function sampleSentence(v: Pick<Voice, "name" | "language">): string {
	switch (v.language) {
		case "es":
			return `Hola, soy ${v.name}. Veamos paso a paso cómo se dobla la luz cuando pasa por el agua.`;
		case "fr":
			return `Bonjour, je suis ${v.name}. Voyons pas à pas comment la lumière se courbe dans l'eau.`;
		case "pt":
			return `Olá, eu sou ${v.name}. Vamos ver, passo a passo, como a luz se curva ao passar pela água.`;
		case "hi":
			return `नमस्ते, मैं ${v.name} हूँ। आइए एक-एक कदम में समझें कि पानी में रोशनी कैसे मुड़ती है।`;
		case "ur":
			return `السلام علیکم، میں ${v.name} ہوں۔ آئیے قدم بہ قدم دیکھیں کہ پانی میں روشنی کیسے مڑتی ہے۔`;
		default:
			return `Hi, I'm ${v.name}. Let's explore how light bends when it passes through water, one simple step at a time.`;
	}
}
