import { z } from "zod";

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;

export const VoiceId = z.string().regex(/^[a-z]{2}_[a-z0-9]{1,24}$/, "Not a voice name");
export const Speed = z.number().min(SPEED_MIN).max(SPEED_MAX);
