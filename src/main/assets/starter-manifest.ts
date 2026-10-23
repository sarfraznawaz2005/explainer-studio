import type { Energy, LicenseCode, Mood, SfxRole } from "@shared/assets";

/**
 * The free starter pack. Every file is pinned by size and SHA-256, so a changed
 * or tampered download is refused. All items are CC0 / public domain.
 *
 * Music: FreePD.com (public domain, by Kevin MacLeod, Bryan Teoh and others).
 * FreePD.com closed in 2025; its full catalogue is mirrored on the Internet
 * Archive (archive.org/details/freepd), which is where the files come from.
 * Sound effects: Kenney.nl audio packs (CC0). The ZIPs are pinned; only the
 * listed files are taken out, each checked against its own pinned hash.
 */

export const STARTER_VERSION = 1;

export type StarterMusic = {
	url: string;
	sha256: string;
	bytes: number;
	title: string;
	author: string;
	mood: Mood;
	energy: Energy;
	tags: string[];
};

export type StarterSfx = { entry: string; sha256: string; bytes: number; title: string; tags: string[]; role?: SfxRole };

export type StarterZip = {
	id: string;
	url: string;
	sha256: string;
	bytes: number;
	title: string;
	author: string;
	pageUrl: string;
	license: LicenseCode;
	files: StarterSfx[];
};

const IA = "https://archive.org/download/freepd/";

export const FREEPD = {
	title: "FreePD.com",
	pageUrl: "https://archive.org/details/freepd",
	license: "PD" as LicenseCode,
	note: "FreePD.com released this music into the public domain (CC0). Mirror: https://archive.org/details/freepd",
};

export const STARTER_MUSIC: StarterMusic[] = [
	{ url: `${IA}misc/Infinite%20Peace.mp3`, bytes: 2436321, sha256: "542c11bcc82828c3e494b40b07319ed75be457f66f2673dcba4e3643979b1f9f", title: "Infinite Peace", author: "Kevin MacLeod", mood: "calm", energy: "low", tags: ["piano", "gentle"] },
	{ url: `${IA}misc/Painting%20Room.mp3`, bytes: 3395954, sha256: "ddfb9a5aa5420f1894902b290b7afc421ae644f6b5f4d4d9e24e5d464d95b1d1", title: "Painting Room", author: "Kevin MacLeod", mood: "calm", energy: "low", tags: ["soft", "warm"] },
	{ url: `${IA}upbeat/From%20Page%20to%20Practice.mp3`, bytes: 2733479, sha256: "dd20cb51c948a14e45d71b9a03b9d6afc48a4b7fd7b5020da623fbd86390b519", title: "From Page to Practice", author: "Bryan Teoh", mood: "upbeat", energy: "medium", tags: ["bright", "learning"] },
	{ url: `${IA}upbeat/Inventing%20Flight.mp3`, bytes: 2840034, sha256: "916e736efa3caed4ea8534e727670dbac41af0fb44f00fa667aebaab9b2b6407", title: "Inventing Flight", author: "Bryan Teoh", mood: "upbeat", energy: "high", tags: ["bright", "positive"] },
	{ url: `${IA}featured/Mysterious%20Lights.mp3`, bytes: 3579715, sha256: "1f0fb7f9ba9611bcdb9eef077cb0662d17e50d213e1f14ddfd1f6e6c90d1125f", title: "Mysterious Lights", author: "Bryan Teoh", mood: "curious", energy: "medium", tags: ["mystery", "wonder"] },
	{ url: `${IA}scoring/Slice%20of%20Life.mp3`, bytes: 2817471, sha256: "39e0543fbeb06ced8a5f023daf7375385235238ea9063677f3ff71ab15bc04dc", title: "Slice of Life", author: "Bryan Teoh", mood: "curious", energy: "low", tags: ["light", "thoughtful"] },
	{ url: `${IA}scoring/The%20Drama.mp3`, bytes: 3885053, sha256: "ea747a7c490ac82f4396eaf709ba5eba03c9cc2929f48ddabd974c56a851b26b", title: "The Drama", author: "Rafael Krux", mood: "dramatic", energy: "high", tags: ["cinematic", "tension"] },
	{ url: `${IA}epic/Honor%20Bound.mp3`, bytes: 3413629, sha256: "d9d592d5bc2b1bb7e69aededa2364b7f5cf108daa58099bd320755bcc1861ebc", title: "Honor Bound", author: "Bryan Teoh", mood: "dramatic", energy: "medium", tags: ["epic", "orchestral"] },
	{ url: `${IA}comedy/Wakka%20Wakka.mp3`, bytes: 2434429, sha256: "de261ef809e92732806ebd51534da59b1dda8aee9c9f8bd062c4234aa30eb10c", title: "Wakka Wakka", author: "Bryan Teoh", mood: "playful", energy: "high", tags: ["funny", "kids"] },
	{ url: `${IA}comedy/Spring%20Chicken.mp3`, bytes: 3341632, sha256: "cb6e536674d7cade8631977cd7edc3c56940e3646f542502d3648756b65340e9", title: "Spring Chicken", author: "Bryan Teoh", mood: "playful", energy: "medium", tags: ["bouncy", "kids"] },
	{ url: `${IA}electronic/Meditating%20Beat.mp3`, bytes: 6291368, sha256: "e498c2015a413e6cba5ab8dbef2a60cdebf7c4d4a97f9edd84851752ff49d3b6", title: "Meditating Beat", author: "Kevin MacLeod", mood: "ambient", energy: "low", tags: ["electronic", "focus"] },
	{ url: `${IA}misc/Forest%20Night.mp3`, bytes: 2989749, sha256: "f087318d48e22ca27e4ef570e2625b7079cd092424d9b205abc77ad51aa1454c", title: "Forest Night", author: "Phase Shift", mood: "ambient", energy: "low", tags: ["atmosphere", "nature"] },
];

export const STARTER_ZIPS: StarterZip[] = [
	{
		id: "kenney-interface-sounds",
		url: "https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip",
		bytes: 834536,
		sha256: "f2193d072726d6758a5f7871b2dcc54dcce0d5c35c6f0a62f92549b327c81232",
		title: "Interface Sounds",
		author: "Kenney (kenney.nl)",
		pageUrl: "https://kenney.nl/assets/interface-sounds",
		license: "CC0-1.0",
		files: [
			{ entry: "Audio/pluck_001.ogg", bytes: 6317, sha256: "be97ec4893a02d6eccfb678daa76c83e34cb2583b834ec2593d2641def739fa4", title: "Pop", tags: ["pop", "reveal"], role: "reveal" },
			{ entry: "Audio/pluck_002.ogg", bytes: 6941, sha256: "c977fe249ff42d1c93a552b33abc13a8399df3879fa510475426e5c4bbac1da9", title: "Pop (long)", tags: ["pop", "reveal"] },
			{ entry: "Audio/maximize_006.ogg", bytes: 11618, sha256: "f050b3bb77cb0b901bc8df43d2cc1872c353aebae10b4030cf8ae681726ad343", title: "Whoosh up", tags: ["whoosh", "transition"], role: "transition" },
			{ entry: "Audio/minimize_006.ogg", bytes: 11292, sha256: "39d7c47855b9642f43548b7b132c20e20a1490c7eb13d10008c32fcb24da19f8", title: "Whoosh down", tags: ["whoosh", "transition"] },
			{ entry: "Audio/confirmation_001.ogg", bytes: 8968, sha256: "063564703b6094d70718a3e787a55cc9141611e4ecd6b6637f8828f79b4a8c3a", title: "Ding", tags: ["ding", "correct"], role: "correct" },
			{ entry: "Audio/confirmation_002.ogg", bytes: 14169, sha256: "33b17a9a9a2397c62b285c52c33a907fdffb476909c99e42dde603f6a7a8b12c", title: "Success chime", tags: ["chime", "correct"] },
			{ entry: "Audio/glass_001.ogg", bytes: 6103, sha256: "183eebee20eb0a532b0b85104d139cbf2673eb66d95c3cc733ac9ea98362e7e8", title: "Glass ding", tags: ["ding", "highlight"] },
			{ entry: "Audio/bong_001.ogg", bytes: 4848, sha256: "d21d0f0b782445db579d11e2506b24cd1ac9d664ee33aeaf807761aa7b6fd710", title: "Bong", tags: ["bong", "highlight"] },
			{ entry: "Audio/click_001.ogg", bytes: 4876, sha256: "ccfb7fa0cccdd9faec0eb16033c732b1e308d139d80f799161495d58f7adcdb9", title: "Click", tags: ["click"] },
			{ entry: "Audio/drop_002.ogg", bytes: 6411, sha256: "4ac4d1cef7e936965cbf795852ca2020300b9e2ba7daa59f2bf4f1f7bf416218", title: "Drop", tags: ["drop", "reveal"] },
			{ entry: "Audio/scroll_002.ogg", bytes: 24628, sha256: "6fbcda22bc45349c66f1ba4b56d6c211b12264e83667de4b9af1e4ffcef74be5", title: "Scroll", tags: ["scroll", "typing"] },
			{ entry: "Audio/select_001.ogg", bytes: 5468, sha256: "aec0c31ea934a35936ae0d2ab8fac8123c93aa5647f935853a58dbaf90278b7a", title: "Select", tags: ["select", "click"] },
			{ entry: "Audio/switch_002.ogg", bytes: 7097, sha256: "6fc395be2ad1f99ce318a5d28f98fb76dbeb676d83a0b28239d8c1fb90736180", title: "Switch", tags: ["switch"] },
			{ entry: "Audio/tick_001.ogg", bytes: 4497, sha256: "9d057b918024c787bbe6c00beed13a7ef72a3fa0c259add3cef36582792f4230", title: "Tick", tags: ["tick", "typing"] },
			{ entry: "Audio/toggle_001.ogg", bytes: 7369, sha256: "ca1d2dde5f0b286abac4f070e23edab8f30927c8a533665cdf2ac6492a415e49", title: "Toggle", tags: ["toggle", "click"] },
			{ entry: "Audio/error_004.ogg", bytes: 6393, sha256: "0b574cea597d96507e782ae9764f88482ce49f46e931e57054bf7150047f2d69", title: "Wrong answer", tags: ["error", "wrong"] },
			{ entry: "Audio/question_001.ogg", bytes: 11700, sha256: "abb8f9e4eb2071491b0b15f84ee302386b1847609310c1b000ae174639a6cc5a", title: "Question", tags: ["question"] },
			{ entry: "Audio/open_001.ogg", bytes: 9834, sha256: "a27c6bb0df7da1e6af5dd5937593c98bc58b6e513f42fe6a3254cd6a6949c648", title: "Open", tags: ["open", "reveal"] },
		],
	},
	{
		id: "kenney-digital-audio",
		url: "https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip",
		bytes: 990367,
		sha256: "24e6ce28b76a6d8c89cff4d331e0965ff5c3de8a73c612028e9d363cc64e4f06",
		title: "Digital Audio",
		author: "Kenney (kenney.nl)",
		pageUrl: "https://kenney.nl/assets/digital-audio",
		license: "CC0-1.0",
		files: [
			{ entry: "Audio/pepSound1.ogg", bytes: 6019, sha256: "f2f44effce087e47683f0fea05a71002bd8dca78fb10bf93d9f0b38d49f9590e", title: "Pep", tags: ["blip", "positive"] },
			{ entry: "Audio/powerUp2.ogg", bytes: 5577, sha256: "83786b43d828a399e14ac20604b63a60ca05385977f5477d00304c2adc696204", title: "Power up", tags: ["power up", "positive"] },
			{ entry: "Audio/twoTone1.ogg", bytes: 7362, sha256: "8732f14d6398407a8f1df77b986c2099cfd88f6583e1272cb60497cb2fe8da1d", title: "Two tone", tags: ["tone", "notice"] },
			{ entry: "Audio/threeTone1.ogg", bytes: 7361, sha256: "bdf21eb12e65507f091d074886fdac820e1ccae51d060caa168e5567acadb84b", title: "Three tone chime", tags: ["chime", "chapter"] },
			{ entry: "Audio/phaseJump1.ogg", bytes: 6733, sha256: "c60069ed7108678dd6a1306404d168a93cc2575cda37b06add9dd6c4d46352a3", title: "Phase jump", tags: ["sweep", "transition"] },
			{ entry: "Audio/highUp.ogg", bytes: 6135, sha256: "cbc1c3c7ccf5d7903818144a4c3f5b2ed2385095792f29d8d7c76360ba4fa559", title: "Blip up", tags: ["blip", "reveal"] },
		],
	},
];

export const STARTER_BYTES = STARTER_MUSIC.reduce((n, m) => n + m.bytes, 0) + STARTER_ZIPS.reduce((n, z) => n + z.bytes, 0);
export const STARTER_FILES = STARTER_MUSIC.length + STARTER_ZIPS.reduce((n, z) => n + z.files.length, 0);

/** Starter sound for each role, by pinned hash. */
export const STARTER_ROLES: Partial<Record<SfxRole, string>> = Object.fromEntries(
	STARTER_ZIPS.flatMap((z) => z.files.filter((f) => f.role).map((f) => [f.role!, f.sha256])),
);
