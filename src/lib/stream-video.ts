import "server-only";
import { StreamClient } from '@stream-io/node-sdk';
import { env } from "./env";
import { publicEnv } from "./env.public";

export const streamVideo = new StreamClient(
    publicEnv.NEXT_PUBLIC_STREAM_VIDEO_API_KEY,
    env.STREAM_VIDEO_SECRET_KEY,
);