import type { CHARACTER_LOOKS } from "../../../src/shared/plan/schema";

/**
 * Simple flat characters for the dialogue scene (young audiences). Drawn in a
 * 200×300 box. `mouth` 0..1 opens the mouth while the character speaks;
 * `blink` closes the eyes for a few frames.
 */
export type Look = (typeof CHARACTER_LOOKS)[number];

const INK = "#1f1d2b";

function Eyes({ y, blink, gap = 26, r = 7, color = INK }: { y: number; blink: boolean; gap?: number; r?: number; color?: string }) {
	return (
		<g fill={color}>
			<ellipse cx={100 - gap} cy={y} rx={r} ry={blink ? 1.2 : r} />
			<ellipse cx={100 + gap} cy={y} rx={r} ry={blink ? 1.2 : r} />
		</g>
	);
}

function Mouth({ y, open, color = "#7a2e2e", w = 18 }: { y: number; open: number; color?: string; w?: number }) {
	return open > 0.05 ? <ellipse cx={100} cy={y} rx={w * (0.7 + 0.3 * open)} ry={2 + open * 10} fill={color} stroke={INK} strokeWidth={3} /> : <path d={`M ${100 - w} ${y - 2} Q 100 ${y + 10} ${100 + w} ${y - 2}`} fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />;
}

function Glasses({ y }: { y: number }) {
	return (
		<g fill="none" stroke={INK} strokeWidth={4}>
			<circle cx={74} cy={y} r={16} />
			<circle cx={126} cy={y} r={16} />
			<path d={`M 90 ${y} H 110`} />
		</g>
	);
}

function Person({ skin, shirt, hair, mouth, blink, extra, coat }: { skin: string; shirt: string; hair: React.ReactNode; mouth: number; blink: boolean; extra?: React.ReactNode; coat?: boolean }) {
	return (
		<g stroke={INK} strokeWidth={4} strokeLinejoin="round">
			{/* Body */}
			<path d="M 30 300 Q 30 200 100 196 Q 170 200 170 300 Z" fill={coat ? "#f7f7fb" : shirt} />
			{coat ? <path d="M 100 198 L 82 300 M 100 198 L 118 300 M 86 206 L 100 236 L 114 206" fill="none" /> : null}
			{coat ? <path d="M 100 214 L 94 250 L 100 262 L 106 250 Z" fill={shirt} /> : null}
			<rect x={88} y={170} width={24} height={32} fill={skin} />
			{/* Head */}
			<circle cx={100} cy={112} r={64} fill={skin} />
			<ellipse cx={36} cy={118} rx={10} ry={14} fill={skin} />
			<ellipse cx={164} cy={118} rx={10} ry={14} fill={skin} />
			{hair}
			<g stroke="none">
				<Eyes y={112} blink={blink} />
				<circle cx={66} cy={134} r={9} fill="#ff8f8f" opacity={0.45} />
				<circle cx={134} cy={134} r={9} fill="#ff8f8f" opacity={0.45} />
			</g>
			<Mouth y={146} open={mouth} />
			{extra}
		</g>
	);
}

export function Character({ look, mouth, blink }: { look: Look; mouth: number; blink: boolean }) {
	switch (look) {
		case "kid":
			return <Person skin="#f2c29b" shirt="#ff8a3d" mouth={mouth} blink={blink} hair={<path d="M 38 104 Q 40 44 100 44 Q 160 44 162 104 Q 150 70 120 78 Q 96 60 70 80 Q 50 78 38 104 Z" fill="#5a3a22" />} />;
		case "kid2":
			return (
				<Person
					skin="#c98b5e"
					shirt="#2bb6a8"
					mouth={mouth}
					blink={blink}
					hair={
						<g fill="#1d1a1a">
							<path d="M 36 112 Q 34 46 100 44 Q 166 46 164 112 Q 150 76 100 74 Q 50 76 36 112 Z" />
							<circle cx={30} cy={84} r={20} />
							<circle cx={170} cy={84} r={20} />
						</g>
					}
				/>
			);
		case "teacher":
			return (
				<Person
					skin="#e8b48f"
					shirt="#7c5cbf"
					mouth={mouth}
					blink={blink}
					hair={
						<g fill="#8a8a96">
							<circle cx={100} cy={40} r={22} />
							<path d="M 38 108 Q 38 50 100 50 Q 162 50 162 108 Q 140 70 100 72 Q 60 70 38 108 Z" />
						</g>
					}
					extra={<Glasses y={112} />}
				/>
			);
		case "scientist":
			return (
				<Person
					skin="#f0c7a5"
					shirt="#e04848"
					coat
					mouth={mouth}
					blink={blink}
					hair={<path d="M 34 110 L 30 70 L 50 80 L 52 48 L 74 64 L 88 38 L 104 60 L 122 38 L 132 62 L 154 50 L 152 80 L 172 72 L 166 110 Q 150 78 100 76 Q 50 78 34 110 Z" fill="#f4f4f8" />}
					extra={<Glasses y={112} />}
				/>
			);
		case "robot":
			return (
				<g stroke={INK} strokeWidth={4} strokeLinejoin="round">
					<rect x={40} y={200} width={120} height={100} rx={18} fill="#b8c4d6" />
					<circle cx={100} cy={246} r={14} fill="#ffd166" />
					<rect x={88} y={172} width={24} height={30} fill="#8e9bb0" />
					<path d="M 100 46 V 22" />
					<circle cx={100} cy={18} r={9} fill="#ff6b6b" />
					<rect x={36} y={46} width={128} height={130} rx={26} fill="#cfd8e6" />
					<rect x={56} y={86} width={88} height={44} rx={14} fill="#1f2433" />
					<g stroke="none" fill="#5ef1ff">
						<rect x={70} y={blink ? 106 : 98} width={18} height={blink ? 4 : 20} rx={4} />
						<rect x={112} y={blink ? 106 : 98} width={18} height={blink ? 4 : 20} rx={4} />
					</g>
					<rect x={72} y={144} width={56} height={8 + mouth * 14} rx={4} fill="#1f2433" />
					<path d="M 36 110 H 24 M 164 110 H 176" />
				</g>
			);
		case "cat":
			return (
				<g stroke={INK} strokeWidth={4} strokeLinejoin="round">
					<path d="M 40 300 Q 40 206 100 200 Q 160 206 160 300 Z" fill="#f4a259" />
					<path d="M 50 92 L 46 30 L 92 62 Z M 150 92 L 154 30 L 108 62 Z" fill="#f4a259" />
					<path d="M 56 80 L 54 46 L 80 64 Z M 144 80 L 146 46 L 120 64 Z" fill="#ffcfb0" stroke="none" />
					<ellipse cx={100} cy={118} rx={70} ry={62} fill="#f4a259" />
					<g stroke="none">
						<Eyes y={110} blink={blink} gap={28} r={8} />
					</g>
					<path d="M 92 132 L 108 132 L 100 140 Z" fill="#ff7b8a" />
					<Mouth y={150} open={mouth} w={12} />
					<path d="M 70 136 L 30 128 M 70 142 L 32 148 M 130 136 L 170 128 M 130 142 L 168 148" strokeWidth={2.5} />
				</g>
			);
		case "owl":
			return (
				<g stroke={INK} strokeWidth={4} strokeLinejoin="round">
					<ellipse cx={100} cy={190} rx={78} ry={106} fill="#8d6748" />
					<ellipse cx={100} cy={222} rx={50} ry={66} fill="#d8b98f" />
					<path d="M 26 170 Q 6 230 40 270 Q 40 220 52 186 Z M 174 170 Q 194 230 160 270 Q 160 220 148 186 Z" fill="#6f4f36" />
					<path d="M 44 96 L 40 60 L 74 84 Z M 156 96 L 160 60 L 126 84 Z" fill="#8d6748" />
					<circle cx={70} cy={120} r={28} fill="#ffffff" />
					<circle cx={130} cy={120} r={28} fill="#ffffff" />
					<g stroke="none" fill={INK}>
						<ellipse cx={72} cy={122} rx={12} ry={blink ? 2 : 12} />
						<ellipse cx={128} cy={122} rx={12} ry={blink ? 2 : 12} />
					</g>
					<path d={`M 90 146 L 110 146 L 100 ${160 + mouth * 8} Z`} fill="#f6a623" />
				</g>
			);
	}
}
