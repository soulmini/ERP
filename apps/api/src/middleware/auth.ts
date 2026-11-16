import type { NextFunction, Request, Response } from 'express';
import type { Permission, RoleKind } from '@erp/shared';
import { forbidden, unauthorized } from '../lib/http';
import { verifyAccess, type AuthPayload } from '../lib/tokens';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw unauthorized();
  req.auth = verifyAccess(h.slice(7));
  next();
}

/** Passes if the user has ANY of the given permissions (Principal always passes). */
export const can =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const a = authOf(req);
    if (isPrincipal(a) || perms.some((p) => a.perms.includes(p))) return next();
    throw forbidden();
  };

export const requireKind =
  (...kinds: RoleKind[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (authOf(req).kinds.some((k) => kinds.includes(k))) return next();
    throw forbidden();
  };

export function authOf(req: Request): AuthPayload {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export const isPrincipal = (a: AuthPayload) => a.kinds.includes('PRINCIPAL');
export const hasPerm = (a: AuthPayload, p: Permission) => isPrincipal(a) || a.perms.includes(p);
