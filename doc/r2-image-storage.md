# Cloudflare R2 Image Storage

## Current scope

The backend has a reusable `ImageStorage` port and an R2 adapter using `@aws-sdk/client-s3`. The composition root exposes `imageStorage` when `R2_ENABLED=true`, or null when disabled. Existing AU/BR flows do not require R2 credentials.

This is the preparation stage: application modules can inject the adapter to upload/delete images. HTTP upload endpoints, multipart parsing, frontend integration, and image fields on business records will be added with the consuming module. There are no database schema changes in this stage.

The intended first flow is frontend → authenticated Express upload endpoint → R2 → return an image key and public URL. Upload bytes pass through the backend. R2 credentials stay on the server; the frontend only receives the public image URL.

## Cloudflare setup

1. Create an R2 bucket, for example `milktyway-images`.
2. Create R2 S3 credentials with **Object Read & Write** scoped to that bucket. Use the generated **Access Key ID** and **Secret Access Key**, rather than a general Cloudflare API token.
3. Copy the bucket's S3 endpoint from Cloudflare. A default-jurisdiction endpoint looks like `https://ACCOUNT_ID.r2.cloudflarestorage.com`; jurisdiction-specific buckets use the endpoint shown by Cloudflare. The adapter uses region `auto`.
4. Enable a public development URL for the project demo, or connect a custom domain for public images. Set that URL as `R2_PUBLIC_BASE_URL`. The S3 API endpoint is used for authenticated storage operations and is not the public image base URL.
5. Add the values to the backend's ignored local `.env`. Keep `R2_ENABLED=false` until all required values are ready. No real credentials belong in `.env.example`, frontend variables, or Git.

Example configuration with placeholders:

```dotenv
R2_ENABLED=true
R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_BUCKET=milktyway-images
R2_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY
R2_PUBLIC_BASE_URL=https://pub-YOUR_BUCKET_ID.r2.dev
R2_MAX_IMAGE_BYTES=5242880
```

Public URLs expose uploaded images to anyone with the URL; use this bucket for public product/branch images. Private documents need a separate access design. The adapter does not change bucket visibility or create cloud resources. Server-side uploads do not require browser PUT permissions on the R2 bucket; a future direct-to-R2 browser flow would require signed upload URLs and bucket CORS configuration.

## Adapter use

Inject `ImageStorage` from `src/shared/application/image-storage.ts` into the consuming service. Wire it from the existing composition root; services should not instantiate the AWS SDK client.

```ts
const image = await imageStorage.uploadImage({
  data: fileBytes,
  contentType: "image/png",
});
// image: { key, url, contentType, sizeBytes }

// After the business service has authorized deletion:
await imageStorage.deleteImage(image.key);
```

Store the returned key alongside the URL so replacing/deleting an image does not depend on parsing a public URL. Keys are generated as `images/<uuid>.jpg`, `.png`, or `.webp`; original filenames are not used. A replacement gets a new key and URL. Delete the old object after the business update succeeds.

Uploads allow JPEG, PNG, and WebP and enforce the configured byte limit (default 5 MiB, configurable up to 10 MiB). The adapter checks file signatures against the requested content type; it does not fully decode, resize, or scan images. Reject unsupported files and enforce a matching parser size limit in the future HTTP upload endpoint before buffering the entire request. Authorization to upload or delete belongs to the consuming module.

SDK failures become `MEDIA_UPLOAD_FAILED` or `MEDIA_DELETE_FAILED` errors. Invalid image sizes, signatures, and object keys are rejected before storage requests. The server destroys the storage client during graceful shutdown.

## Validation and next work

Run `npm test`, `npm run lint`, and `npm run build`. Unit tests exercise request construction, file guards, deletion keys, config validation, and provider-error mapping without contacting a real bucket. A real upload/read/delete check remains necessary after configuring Cloudflare credentials and public access.

Next, add a small authenticated upload endpoint for the first consuming module, connect its image key/URL fields, and test image display from the frontend. Keep R2 disabled in environments that are not using image storage yet.

References: [Cloudflare's AWS SDK v3 example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/), [R2 credentials](https://developers.cloudflare.com/r2/api/tokens/), [public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/), and [AWS checksum configuration](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html). The client limits automatic request checksums to operations that require them for S3-compatible operation.
