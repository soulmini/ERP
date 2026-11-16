import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ALL_PERMISSIONS, type RoleKind } from '@erp/shared';
import { env } from '../env';
import { prisma } from '../db';
import { unauthorized } from './http';

/** Which of the app's layouts the user lands on. Custom staff roles use the admin layout. */
export type View = 'admin' | 'teacher' | 'parent';

export interface AuthPayload {
  sub: string; // userId
  sid: string; // schoolId
  name: string;
  kinds: RoleKind[];
  perms: string[];
  staffId: string | null;
  guardianId: string | null;
  view: View;
}

const ACCESS_TTL = '15m';
const REFRESH_DAYS = 30;

export function signAccess(p: AuthPayload): string {
  return jwt.sign(p, env.jwtAccessSecret, { expiresIn: ACCESS_TTL });
}

export function verifyAccess(token: string): AuthPayload {
  try {
    const { iat: _i, exp: _e, ...p } = jwt.verify(token, env.jwtAccessSecret) as AuthPayload & {
      iat: number;
      exp: number;
    };
    return p;
  } catch {
    throw unauthorized('Session expired, please log in again');
  }
}

export const hashToken = (t: string) =>
  crypto.createHmac('sha256', env.jwtRefreshSecret).update(t).digest('hex');

export async function issueRefreshToken(userId: string, userAgent?: string): Promise<string> {
  const token = crypto.randomBytes(48).toString('base64url');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      userAgent: userAgent?.slice(0, 250),
      expiresAt: new Date(Date.now() + REFRESH_DAYS * 86_400_000),
    },
  });
  return token;
}

function pickView(kinds: RoleKind[]): View {
  if (kinds.includes('PRINCIPAL')) return 'admin';
  if (kinds.includes('TEACHER')) return 'teacher';
  if (kinds.includes('STAFF')) return 'admin';
  return 'parent';
}

/** Build the auth context (roles, permissions, linked profiles) for a user. */
export async function buildAuthPayload(userId: string): Promise<AuthPayload> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: true } },
      staff: { select: { id: true } },
      guardian: { select: { id: true } },
    },
  });
  if (!user || !user.isActive) throw unauthorized('Account is disabled');
  const kinds = [...new Set(user.roles.map((r) => r.role.kind))] as RoleKind[];
  const perms = kinds.includes('PRINCIPAL')
    ? [...ALL_PERMISSIONS]
    : [...new Set(user.roles.flatMap((r) => r.role.permissions))];
  return {
    sub: user.id,
    sid: user.schoolId,
    name: user.name,
    kinds,
    perms,
    staffId: user.staff?.id ?? null,
    guardianId: user.guardian?.id ?? null,
    view: pickView(kinds),
  };
}
