import { env } from './env';
import { createApp } from './app';
import { prisma } from './db';

const server = createApp().listen(env.port, () => {
  console.log(`School ERP API listening on http://localhost:${env.port}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
