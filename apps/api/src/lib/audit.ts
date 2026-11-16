import type { Request } from 'express';
import { prisma } from '../db';

/** Record who did what. Fire-and-forget: auditing must never break the request. */
export function audit(req: Request, action: string, entity: string, entityId?: string, meta?: object) {
  const a = req.auth;
  if (!a) return;
  prisma.auditLog
    .create({
      data: { schoolId: a.sid, userId: a.sub, action, entity, entityId, meta: meta ?? undefined },
    })
    .catch((e) => console.error('audit failed', e));
}
