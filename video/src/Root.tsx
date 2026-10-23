import { Composition } from "remotion";
import { TEST_CARD, testCardDefaults } from "./compositions";
import { PlanVideo, planMetadata, type PlanVideoProps } from "./plan/PlanVideo";
import { SAMPLE_PLAN } from "./samples/web-page-journey";
import { TestCard } from "./TestCard";
import { THUMBNAIL, Thumbnail, type ThumbnailProps } from "./thumbnail/Thumbnail";

export function Root() {
	return (
		<>
			<Composition {...TEST_CARD} component={TestCard} defaultProps={testCardDefaults} />
			<Composition
				id="Explainer"
				component={PlanVideo}
				defaultProps={{ plan: SAMPLE_PLAN } satisfies PlanVideoProps}
				// Length, size and fps come from the plan.
				calculateMetadata={({ props }) => planMetadata(props.plan)}
				durationInFrames={30}
				fps={30}
				width={1920}
				height={1080}
			/>
			<Composition {...THUMBNAIL} component={Thumbnail} defaultProps={{ plan: SAMPLE_PLAN, variant: "a" } satisfies ThumbnailProps} />
		</>
	);
}
