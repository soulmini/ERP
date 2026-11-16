import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // Migrations use Neon's direct (non-pooled) connection; fall back to DATABASE_URL on hosts that only set one.
  // (`prisma generate` needs no database, so an empty value is fine at build time.)
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '' },
});
