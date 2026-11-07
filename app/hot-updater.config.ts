import { s3Storage } from "@hot-updater/aws";
import { expo } from "@hot-updater/expo";
import { standaloneRepository } from "@hot-updater/standalone";
import { defineConfig } from "hot-updater";
import { config } from "dotenv";

config({ path: ".env.hotupdater" });

const updateServerUrl = process.env.HOT_UPDATER_SERVER_URL;
if (!updateServerUrl?.startsWith("https://")) {
  throw new Error("Set HOT_UPDATER_SERVER_URL to a Solana-only HTTPS update endpoint before publishing");
}

export default defineConfig({
  updateStrategy: "appVersion",
  build: expo(),
  storage: s3Storage({
    bucketName: process.env.BUCKET_NAME!,
    region: "auto",
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  }),
  database: standaloneRepository({
    baseUrl: updateServerUrl,
  }),
});
