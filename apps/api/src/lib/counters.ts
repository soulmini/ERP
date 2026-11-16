import { prisma } from '../db';

type Db = Pick<typeof prisma, 'counter'>;

/**
 * Next sequential number for a school-scoped key — atomic, safe under concurrency.
 * Keys: "receipt:2026-27", "tc", "cc", "dob", "bonafide", "gatepass", "admission:2026-27" ...
 * Pass a transaction client (tx) to make the number part of the same transaction.
 *
 *   const n = await nextNumber(tx, schoolId, `receipt:${session.name}`); // 1, 2, 3 ...
 */
export async function nextNumber(db: Db, schoolId: string, key: string): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const c = await db.counter.upsert({
        where: { schoolId_key: { schoolId, key } },
        create: { schoolId, key, value: 1 },
        update: { value: { increment: 1 } },
      });
      return c.value;
    } catch (e) {
      // Two first-ever upserts can race on create → unique violation; retry takes the update path.
      if ((e as { code?: string }).code !== 'P2002' || attempt === 2) throw e;
    }
  }
  throw new Error('unreachable');
}

/** Formats e.g. ("RCT", 42, 5) → "RCT00042". */
export const formatSerial = (prefix: string, n: number, pad = 4) => `${prefix}${String(n).padStart(pad, '0')}`;
