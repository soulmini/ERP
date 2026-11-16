/** Verifies object-storage credentials and lists buckets: npx tsx scripts/check-storage.ts */
import 'dotenv/config';
import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({ endpoint: process.env.AWS_ENDPOINT_URL_S3, region: process.env.AWS_REGION, forcePathStyle: true });
try {
  const r = await s3.send(new ListBucketsCommand({}));
  console.log('Buckets:', r.Buckets?.map((b) => b.Name) ?? []);
  console.log('Configured S3_BUCKET:', process.env.S3_BUCKET);
} catch (e) {
  console.log('Storage check failed:', (e as Error).name, (e as Error).message);
}
