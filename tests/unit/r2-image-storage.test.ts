import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadConfig } from "../../src/config/env.js";
import { createR2ImageStorage } from "../../src/shared/infrastructure/storage/r2-image-storage.js";

const baseEnvironment = {
  DATABASE_URL: "postgresql://localhost/test",
  ACCESS_TOKEN_SECRET: "a".repeat(64),
  OTP_HMAC_SECRET: "b".repeat(64),
  OTP_PROVIDER: "development",
};
const r2Environment = {
  ...baseEnvironment,
  R2_ENABLED: "true",
  R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
  R2_BUCKET: "milktyway-images-test",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
  R2_PUBLIC_BASE_URL: "https://images.example.test/media/",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=",
  "base64",
);
afterEach(() => vi.restoreAllMocks());

describe("R2 configuration", () => {
  it("keeps storage optional and fails clearly when enabled without credentials", () => {
    expect(loadConfig(baseEnvironment).R2_ENABLED).toBe(false);
    expect(() => loadConfig({ ...baseEnvironment, R2_ENABLED: "true" })).toThrow(/R2_ENDPOINT/);
    expect(loadConfig(r2Environment).R2_MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });

  it("requires distinct HTTPS S3/public URLs and rejects credentials or query strings in URLs", () => {
    for (const patch of [
      { R2_ENDPOINT: "https://example.test" },
      { R2_PUBLIC_BASE_URL: "http://images.example.test" },
      { R2_PUBLIC_BASE_URL: r2Environment.R2_ENDPOINT },
      { R2_PUBLIC_BASE_URL: "https://images.example.test?token=secret" },
      { R2_PUBLIC_BASE_URL: "https://user:secret@images.example.test" },
    ]) {
      expect(() => loadConfig({ ...r2Environment, ...patch })).toThrow(/R2 requires/);
    }
  });
});

describe("R2 image storage adapter", () => {
  it("uploads image bytes with their content type and returns a durable key and public URL", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => undefined);
    const storage = createR2ImageStorage(loadConfig(r2Environment));
    try {
      const image = await storage.uploadImage({ data: png, contentType: "image/png" });
      expect(image.key).toMatch(/^images\/[a-f0-9-]{36}\.png$/);
      expect(image.url).toBe(`https://images.example.test/media/${image.key}`);
      expect(image.sizeBytes).toBe(png.byteLength);
      const command = send.mock.calls[0]?.[0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      if (!(command instanceof PutObjectCommand)) throw new Error("Expected PutObject.");
      expect(command.input).toMatchObject({
        Bucket: "milktyway-images-test",
        Key: image.key,
        Body: png,
        ContentType: "image/png",
        ContentLength: png.byteLength,
      });
    } finally {
      storage.close();
    }
  });

  it("rejects empty, oversized, and mislabeled files before contacting storage", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => undefined);
    const storage = createR2ImageStorage({ ...loadConfig(r2Environment), R2_MAX_IMAGE_BYTES: 100 });
    try {
      await expect(
        storage.uploadImage({ data: new Uint8Array(), contentType: "image/png" }),
      ).rejects.toMatchObject({ code: "MEDIA_INVALID_IMAGE_SIZE" });
      await expect(
        storage.uploadImage({ data: new Uint8Array(101), contentType: "image/png" }),
      ).rejects.toMatchObject({ code: "MEDIA_INVALID_IMAGE_SIZE" });
      await expect(
        storage.uploadImage({ data: Buffer.from("not an image"), contentType: "image/png" }),
      ).rejects.toMatchObject({ code: "MEDIA_UNSUPPORTED_IMAGE" });
      await expect(
        storage.uploadImage({ data: png, contentType: "image/jpeg" }),
      ).rejects.toMatchObject({ code: "MEDIA_UNSUPPORTED_IMAGE" });
      expect(send).not.toHaveBeenCalled();
    } finally {
      storage.close();
    }
  });

  it("deletes only generated image keys and never accepts arbitrary URLs or paths", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => undefined);
    const storage = createR2ImageStorage(loadConfig(r2Environment));
    const key = "images/11111111-1111-4111-8111-111111111111.jpg";
    try {
      await storage.deleteImage(key);
      const command = send.mock.calls[0]?.[0];
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      if (!(command instanceof DeleteObjectCommand)) throw new Error("Expected DeleteObject.");
      expect(command.input).toEqual({ Bucket: "milktyway-images-test", Key: key });
      for (const invalid of [
        "../secret.png",
        "other-module/file.png",
        `https://images.example.test/${key}`,
      ]) {
        await expect(storage.deleteImage(invalid)).rejects.toMatchObject({
          code: "MEDIA_INVALID_IMAGE_KEY",
        });
      }
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      storage.close();
    }
  });

  it("maps storage failures without exposing SDK errors or credentials", async () => {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(
      new Error("Raw credential-sensitive provider error"),
    );
    const storage = createR2ImageStorage(loadConfig(r2Environment));
    try {
      await expect(
        storage.uploadImage({ data: png, contentType: "image/png" }),
      ).rejects.toMatchObject({
        status: 502,
        code: "MEDIA_UPLOAD_FAILED",
        message: "Image upload is temporarily unavailable.",
      });
      await expect(
        storage.deleteImage("images/11111111-1111-4111-8111-111111111111.png"),
      ).rejects.toMatchObject({
        status: 502,
        code: "MEDIA_DELETE_FAILED",
        message: "Image deletion is temporarily unavailable.",
      });
    } finally {
      storage.close();
    }
  });
});
