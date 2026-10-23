/**
 * Composition metadata shared by the Remotion bundle (Root.tsx) and the in-app Player.
 * Keep both in step by importing from here, never by repeating numbers.
 */
export const TEST_CARD = {
	id: "TestCard",
	fps: 30,
	durationInFrames: 300,
	width: 1920,
	height: 1080,
} as const;

export type TestCardProps = {
	title: string;
	subtitle: string;
};

export const testCardDefaults: TestCardProps = {
	title: "Explainer Studio",
	subtitle: "Render engine test",
};
