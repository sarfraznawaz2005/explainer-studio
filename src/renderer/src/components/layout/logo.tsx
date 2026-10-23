import { useId } from "react";

/** App mark: a rounded tile with a play shape and a spark — "a video that explains". */
export function Logo({ size = 24 }: { size?: number }) {
	const id = useId();
	return (
		<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
			<defs>
				<linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="oklch(0.62 0.21 285)" />
					<stop offset="1" stopColor="oklch(0.5 0.22 262)" />
				</linearGradient>
			</defs>
			<rect width="32" height="32" rx="8" fill={`url(#${id}-g)`} />
			<path d="M12.5 9.8c0-.9 1-1.5 1.8-1l8.6 5.2c.8.5.8 1.6 0 2.1l-8.6 5.2c-.8.5-1.8-.1-1.8-1V9.8z" fill="#fff" />
			<path d="M24.5 21.5l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" fill="#fff" opacity=".9" />
		</svg>
	);
}
