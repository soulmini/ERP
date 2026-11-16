import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env';

/** Neon object storage (S3-compatible). Works with any S3 provider (R2, AWS ...). */
const s3 = new S3Client({
  endpoint: env.s3.endpoint,
  region: env.s3.region,
  forcePathStyle: true,
  credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
});

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: body, ContentType: contentType }),
  );
  return key;
}

/** Short-lived download URL for a stored file (files are private by default). */
export async function signedUrl(key: string | null | undefined, expiresIn = 3600) {
  if (!key) return null;
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }), { expiresIn });
}
