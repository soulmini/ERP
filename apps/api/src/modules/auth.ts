import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { changePasswordSchema, loginSchema } from '@erp/shared';
import { prisma } from '../db';
import { badRequest, parse, unauthorized } from '../lib/http';
import { buildAuthPayload, hashToken, issueRefreshToken, signAccess } from '../lib/tokens';
import { signedUrl } from '../lib/storage';
import { authOf, requireAuth } from '../middleware/auth';

export const authRouter = Router();

/** Profile returned to the app after login / on /me. */
async function profile(userId: string) {
  const auth = await buildAuthPayload(userId);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      school: { select: { id: true, name: true, city: true, logoKey: true } },
      staff: { select: { id: true, designation: true, employeeCode: true } },
    },
  });
  const { logoKey, ...school } = user.school;
  return {
    auth,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      kinds: auth.kinds,
      permissions: auth.perms,
      view: auth.view,
      staff: user.staff,
      guardianId: auth.guardianId,
      school: { ...school, logoUrl: await signedUrl(logoKey) },
    },
  };
}

async function sessionResponse(userId: string, userAgent?: string) {
  const { auth, user } = await profile(userId);
  return {
    accessToken: signAccess(auth),
    refreshToken: await issueRefreshToken(userId, userAgent),
    user,
  };
}

authRouter.post('/login', async (req, res) => {
  const { identifier, password } = parse(loginSchema, req.body);
  const id = identifier.toLowerCase();
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: id }, { phone: identifier.replace(/\D/g, '').slice(-10) }] },
  });
  // Same message for unknown user and wrong password (no account enumeration).
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw unauthorized('Wrong mobile/email or password');
  }
  if (!user.isActive) throw unauthorized('This account has been disabled. Contact the school office.');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  res.json(await sessionResponse(user.id, req.headers['user-agent']));
});

/** Rotate refresh token → new access + refresh token. */
authRouter.post('/refresh', async (req, res) => {
  const { refreshToken } = parse(z.object({ refreshToken: z.string().min(10) }), req.body);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
  if (!row || row.revokedAt || row.expiresAt < new Date()) {
    // Reuse of a revoked token = likely theft → revoke all of this user's sessions.
    if (row?.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    throw unauthorized('Session expired, please log in again');
  }
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  res.json(await sessionResponse(row.userId, req.headers['user-agent']));
});

authRouter.post('/logout', async (req, res) => {
  const token = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  if (token) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json((await profile(authOf(req).sub)).user);
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: authOf(req).sub } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw badRequest('Current password is wrong');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 10) },
  });
  res.json({ ok: true });
});
