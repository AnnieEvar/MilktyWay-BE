import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Config } from "../../../config/env.js";
import { AppError } from "../../application/errors.js";
import type { ImageContentType, ImageStorage } from "../../application/image-storage.js";

type R2Config = Pick<
  Config,
  | "R2_ENDPOINT"
  | "R2_BUCKET"
  | "R2_ACCESS_KEY_ID"
  | "R2_SECRET_ACCESS_KEY"
  | "R2_PUBLIC_BASE_URL"
  | "R2_MAX_IMAGE_BYTES"
>;
const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const imageKey =
  /^images\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/;

function hasImageSignature(data: Uint8Array, contentType: ImageContentType): boolean {
  if (contentType === "image/jpeg") return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (contentType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => data[index] === byte,
    );
  }
  return (
    contentType === "image/webp" &&
    data.length >= 12 &&
    Buffer.from(data.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(data.subarray(8, 12)).toString("ascii") === "WEBP"
  );
}

export function createR2ImageStorage(config: R2Config): ImageStorage {
  const client = new S3Client({
    region: "auto",
    endpoint: config.R2_ENDPOINT,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 10_000 },
  });
  const publicBaseUrl = config.R2_PUBLIC_BASE_URL.replace(/\/+$/, "");

  return {
    async uploadImage({ data, contentType }) {
      if (!data.byteLength || data.byteLength > config.R2_MAX_IMAGE_BYTES) {
        throw new AppError(
          422,
          "MEDIA_INVALID_IMAGE_SIZE",
          "The image is empty or exceeds the configured size limit.",
        );
      }
      if (!extensions[contentType] || !hasImageSignature(data, contentType)) {
        throw new AppError(
          415,
          "MEDIA_UNSUPPORTED_IMAGE",
          "Use a JPEG, PNG, or WebP image matching its content type.",
        );
      }
      const key = `images/${randomUUID()}.${extensions[contentType]}`;
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.R2_BUCKET,
            Key: key,
            Body: data,
            ContentType: contentType,
            ContentLength: data.byteLength,
            CacheControl: "public, max-age=31536000, immutable",
          }),
        );
      } catch {
        throw new AppError(502, "MEDIA_UPLOAD_FAILED", "Image upload is temporarily unavailable.");
      }
      return { key, url: `${publicBaseUrl}/${key}`, contentType, sizeBytes: data.byteLength };
    },
    async deleteImage(key) {
      if (!imageKey.test(key))
        throw new AppError(422, "MEDIA_INVALID_IMAGE_KEY", "Invalid image key.");
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.R2_BUCKET, Key: key }));
      } catch {
        throw new AppError(
          502,
          "MEDIA_DELETE_FAILED",
          "Image deletion is temporarily unavailable.",
        );
      }
    },
    close: () => client.destroy(),
  };
}
