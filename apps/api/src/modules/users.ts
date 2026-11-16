import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { PERMISSION_GROUPS, resetPasswordSchema, roleSchema, staffUserSchema } from '@erp/shared';
import { prisma } from '../db';
import { badRequest, conflict, notFound, parse, str } from '../lib/http';
import { audit } from '../lib/audit';
import { authOf, can } from '../middleware/auth';

export const usersRouter = Router();

// ───────── Roles & permissions ─────────

usersRouter.get('/permissions', can('roles.manage'), (_req, res) => {
  res.json(PERMISSION_GROUPS);
});

usersRouter.get('/roles', can('roles.manage', 'users.view', 'users.manage'), async (req, res) => {
  const roles = await prisma.role.findMany({
    where: { schoolId: authOf(req).sid },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { users: true } } },
  });
  res.json(roles.map(({ _count, ...r }) => ({ ...r, userCount: _count.users })));
});

usersRouter.post('/roles', can('roles.manage'), async (req, res) => {
  const data = parse(roleSchema, req.body);
  const role = await prisma.role.create({ data: { ...data, kind: 'STAFF', schoolId: authOf(req).sid } });
  audit(req, 'role.create', 'Role', role.id, { permissions: data.permissions });
  res.status(201).json(role);
});

usersRouter.put('/roles/:id', can('roles.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const role = await prisma.role.findFirst({ where: { id: str(req.params.id), schoolId: sid } });
  if (!role) throw notFound();
  if (role.kind === 'PRINCIPAL') throw badRequest('The Principal role always has full access');
  const data = parse(roleSchema, req.body);
  const updated = await prisma.role.update({
    where: { id: role.id },
    // System roles keep their name; only permissions can change.
    data: role.isSystem ? { permissions: data.permissions } : data,
  });
  audit(req, 'role.update', 'Role', role.id, { permissions: data.permissions });
  res.json(updated);
});

usersRouter.delete('/roles/:id', can('roles.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const role = await prisma.role.findFirst({
    where: { id: str(req.params.id), schoolId: sid },
    include: { _count: { select: { users: true } } },
  });
  if (!role) throw notFound();
  if (role.isSystem) throw badRequest('Built-in roles cannot be deleted');
  if (role._count.users) throw badRequest('Remove this role from all users first');
  await prisma.role.delete({ where: { id: role.id } });
  audit(req, 'role.delete', 'Role', role.id);
  res.json({ ok: true });
});

// ───────── Staff (each staff member has a login) ─────────

const staffInclude = {
  user: {
    select: {
      id: true,
      isActive: true,
      lastLoginAt: true,
      roles: { select: { role: { select: { id: true, name: true, kind: true } } } },
    },
  },
  classTeacherOf: { select: { id: true, name: true, class: { select: { name: true } } } },
} as const;

usersRouter.get('/staff', can('users.view', 'users.manage', 'staff-attendance.manage'), async (req, res) => {
  const staff = await prisma.staff.findMany({
    where: { schoolId: authOf(req).sid },
    orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
    include: staffInclude,
  });
  res.json(
    staff.map((s) => ({
      ...s,
      roles: s.user?.roles.map((r) => r.role) ?? [],
      classTeacherOf: s.classTeacherOf.map((sec) => ({ id: sec.id, label: `${sec.class.name}-${sec.name}` })),
    })),
  );
});

async function validRoleIds(roleIds: string[], schoolId: string) {
  const roles = await prisma.role.findMany({ where: { id: { in: roleIds }, schoolId } });
  if (roles.length !== roleIds.length) throw badRequest('Invalid role selected');
  if (roles.some((r) => r.kind === 'PARENT')) throw badRequest('Parent role is assigned automatically');
  return roles;
}

usersRouter.post('/staff', can('users.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const { roleIds, password, ...data } = parse(staffUserSchema, req.body);
  await validRoleIds(roleIds, sid);
  if (await prisma.user.findFirst({ where: { OR: [{ phone: data.phone }, ...(data.email ? [{ email: data.email.toLowerCase() }] : [])] } })) {
    throw conflict('A user with this mobile number or email already exists');
  }
  const count = await prisma.staff.count({ where: { schoolId: sid } });
  const initialPassword = password ?? data.phone;
  const staff = await prisma.staff.create({
    data: {
      ...data,
      email: data.email?.toLowerCase(),
      school: { connect: { id: sid } },
      employeeCode: `EMP${String(count + 1).padStart(3, '0')}`,
      user: {
        create: {
          schoolId: sid,
          name: [data.firstName, data.lastName].filter(Boolean).join(' '),
          phone: data.phone,
          email: data.email?.toLowerCase(),
          passwordHash: await bcrypt.hash(initialPassword, 10),
          roles: { create: roleIds.map((roleId) => ({ roleId })) },
        },
      },
    },
    include: staffInclude,
  });
  audit(req, 'staff.create', 'Staff', staff.id);
  res.status(201).json({ ...staff, initialPassword: password ? undefined : initialPassword });
});

usersRouter.put('/staff/:id', can('users.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const staff = await prisma.staff.findFirst({ where: { id: str(req.params.id), schoolId: sid } });
  if (!staff) throw notFound();
  const { roleIds, password: _p, ...data } = parse(staffUserSchema, req.body);
  await validRoleIds(roleIds, sid);
  await prisma.$transaction(async (tx) => {
    await tx.staff.update({ where: { id: staff.id }, data: { ...data, email: data.email?.toLowerCase() } });
    if (staff.userId) {
      await tx.user.update({
        where: { id: staff.userId },
        data: {
          name: [data.firstName, data.lastName].filter(Boolean).join(' '),
          phone: data.phone,
          email: data.email?.toLowerCase() ?? null,
        },
      });
      // Keep the PRINCIPAL role if the person already has it (cannot remove the last admin by accident).
      const keep = await tx.userRole.findMany({
        where: { userId: staff.userId, role: { kind: 'PRINCIPAL' } },
      });
      await tx.userRole.deleteMany({ where: { userId: staff.userId } });
      await tx.userRole.createMany({
        data: [...new Set([...roleIds, ...keep.map((k) => k.roleId)])].map((roleId) => ({
          userId: staff.userId!,
          roleId,
        })),
      });
    }
  });
  audit(req, 'staff.update', 'Staff', staff.id);
  res.json({ ok: true });
});

usersRouter.post('/staff/:id/reset-password', can('users.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const { password } = parse(resetPasswordSchema, req.body);
  const staff = await prisma.staff.findFirst({ where: { id: str(req.params.id), schoolId: sid } });
  if (!staff?.userId) throw notFound();
  await prisma.$transaction([
    prisma.user.update({ where: { id: staff.userId }, data: { passwordHash: await bcrypt.hash(password, 10) } }),
    prisma.refreshToken.updateMany({ where: { userId: staff.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  audit(req, 'staff.resetPassword', 'Staff', staff.id);
  res.json({ ok: true });
});

usersRouter.post('/staff/:id/toggle-active', can('users.manage'), async (req, res) => {
  const a = authOf(req);
  const staff = await prisma.staff.findFirst({ where: { id: str(req.params.id), schoolId: a.sid } });
  if (!staff) throw notFound();
  if (staff.userId === a.sub) throw badRequest('You cannot disable your own account');
  const isActive = !staff.isActive;
  await prisma.$transaction([
    prisma.staff.update({ where: { id: staff.id }, data: { isActive } }),
    ...(staff.userId
      ? [
          prisma.user.update({ where: { id: staff.userId }, data: { isActive } }),
          ...(!isActive
            ? [prisma.refreshToken.updateMany({ where: { userId: staff.userId, revokedAt: null }, data: { revokedAt: new Date() } })]
            : []),
        ]
      : []),
  ]);
  audit(req, isActive ? 'staff.enable' : 'staff.disable', 'Staff', staff.id);
  res.json({ isActive });
});
