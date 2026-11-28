export type ImageContentType = "image/jpeg" | "image/png" | "image/webp";

export interface StoredImage {
  key: string;
  url: string;
  contentType: ImageContentType;
  sizeBytes: number;
}

export interface ImageStorage {
  uploadImage(input: { data: Uint8Array; contentType: ImageContentType }): Promise<StoredImage>;
  deleteImage(key: string): Promise<void>;
  close(): void;
}
