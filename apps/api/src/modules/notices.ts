import { Router, type Request } from 'express';
import { holidaySchema, noticeSchema, noticeUpdateSchema } from '@erp/shared';
import { prisma } from '../db';
import type { Prisma } from '../generated/prisma/client';
import { badRequest, notFound, optStr, parse, str } from '../lib/http';
import { dateOnly, toDateStr, todayStr } from '../lib/dates';
import { DOC_TYPES, storeUpload, upload } from '../lib/upload';
import { signedUrl } from '../lib/storage';
import { audit } from '../lib/audit';
import { SMS_PURPOSE, SMS_TEXT, sendSmsMany } from '../lib/sms';
import type { AuthPayload } from '../lib/tokens';
import { authOf, can, hasPerm } from '../middleware/auth';
import { currentSession } from './academic';
import { parentChildren, sectionLabel, teacherSectionIds } from './scope';

/** Notices, holidays and SMS log. */
export const noticesRouter = Router();

const bodyData = (req: Request) => (typeof req.body?.data === 'string' ? JSON.parse(req.body.data) : req.body);
const canManage = (a: AuthPayload) => a.view === 'admin' && hasPerm(a, 'notices.manage');

/** Where-clause for notices this user is meant to see. */
async function visibleWhere(a: AuthPayload): Promise<Prisma.NoticeWhereInput> {
  if (canManage(a)) return {};
  if (a.view === 'parent') {
    const sections = (await parentChildren(a)).map((c) => c.sectionId!);
    return { OR: [{ audience: { in: ['ALL', 'PARENTS'] } }, { audience: 'SECTIONS', sectionIds: { hasSome: sections } }] };
  }
  const sections = [...(await teacherSectionIds(a))];
  return { OR: [{ audience: { in: ['ALL', 'STAFF'] } }, { audience: 'SECTIONS', sectionIds: { hasSome: sections } }] };
}

async function sectionLabels(schoolId: string) {
  const sections = await prisma.section.findMany({ where: { class: { schoolId } }, include: { class: true } });
  return new Map(sections.map((s) => [s.id, sectionLabel(s)]));
}

// ───────── Notices ─────────

noticesRouter.get('/', async (req, res) => {
  const a = authOf(req);
  const showAll = canManage(a) && req.query.all === '1';
  const today = dateOnly(todayStr());
  const notices = await prisma.notice.findMany({
    where: {
      schoolId: a.sid,
      AND: [await visibleWhere(a), ...(showAll ? [] : [{ OR: [{ expiresAt: null }, { expiresAt: { gte: today } }] }])],
    },
    orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
    take: 100,
    include: { createdBy: { select: { name: true } } },
  });
  const labels = await sectionLabels(a.sid);
  res.json(
    await Promise.all(
      notices.map(async (n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        audience: n.audience,
        sectionIds: n.sectionIds,
        sections: n.sectionIds.map((id) => labels.get(id)).filter(Boolean),
        pinned: n.pinned,
        publishedAt: n.publishedAt,
        expiresOn: n.expiresAt ? toDateStr(n.expiresAt) : null,
        expired: !!n.expiresAt && n.expiresAt < today,
        sendSms: n.sendSms,
        postedBy: n.createdBy?.name ?? null,
        attachment: n.attachmentKey ? { name: n.attachmentName, url: await signedUrl(n.attachmentKey) } : null,
      })),
    ),
  );
});

async function validSections(schoolId: string, ids: string[]) {
  if (!ids.length) return [];
  const found = await prisma.section.count({ where: { id: { in: ids }, class: { schoolId } } });
  if (found !== new Set(ids).size) throw badRequest('Unknown class selected');
  return [...new Set(ids)];
}

/** Primary-guardian phones of active students in the notice's audience (current session). */
async function parentPhones(schoolId: string, audience: string, sectionIds: string[]) {
  if (audience === 'STAFF') return [];
  const session = await currentSession(schoolId);
  const links = await prisma.studentGuardian.findMany({
    where: {
      student: {
        schoolId,
        status: 'ACTIVE',
        enrollments: { some: { sessionId: session.id, ...(audience === 'SECTIONS' ? { sectionId: { in: sectionIds } } : {}) } },
      },
    },
    select: { isPrimary: true, studentId: true, guardian: { select: { phone: true } } },
  });
  // one guardian per student (primary first), then de-duplicate phones (siblings)
  const byStudent = new Map<string, string>();
  for (const l of links.sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary))) {
    if (!byStudent.has(l.studentId)) byStudent.set(l.studentId, l.guardian.phone);
  }
  return [...new Set(byStudent.values())];
}

noticesRouter.post('/', can('notices.manage'), upload.single('file'), async (req, res) => {
  const a = authOf(req);
  const input = parse(noticeSchema, bodyData(req));
  const sectionIds = input.audience === 'SECTIONS' ? await validSections(a.sid, input.sectionIds) : [];
  const file = req.file ? await storeUpload(req.file, a.sid, 'notices', DOC_TYPES) : null;
  const notice = await prisma.notice.create({
    data: {
      schoolId: a.sid,
      title: input.title,
      body: input.body,
      audience: input.audience,
      sectionIds,
      pinned: input.pinned,
      expiresAt: input.expiresOn ? dateOnly(input.expiresOn) : null,
      attachmentKey: file?.key ?? null,
      attachmentName: file?.fileName ?? null,
      sendSms: input.sendSms,
      createdById: a.sub,
    },
  });
  audit(req, 'notice.create', 'Notice', notice.id, { audience: notice.audience });

  let smsQueued = 0;
  if (input.sendSms) {
    const phones = await parentPhones(a.sid, input.audience, sectionIds);
    smsQueued = phones.length;
    const school = await prisma.school.findUnique({ where: { id: a.sid }, select: { name: true } });
    const { message, vars } = SMS_TEXT.notice(notice.title, school?.name ?? 'School');
    const templateId = process.env.SMS_TEMPLATE_NOTICE?.trim() || undefined;
    // Send in the background; results are visible in the SMS log.
    void sendSmsMany(
      phones.map((to) => ({ schoolId: a.sid, to, message, vars, templateId, purpose: SMS_PURPOSE.notice, refId: notice.id })),
    ).catch((e) => console.error('[notices] sms failed', e));
  }
  res.status(201).json({ id: notice.id, smsQueued });
});

noticesRouter.put('/:id', can('notices.manage'), upload.single('file'), async (req, res) => {
  const a = authOf(req);
  const existing = await prisma.notice.findFirst({ where: { id: str(req.params.id), schoolId: a.sid } });
  if (!existing) throw notFound('Notice not found');
  const input = parse(noticeUpdateSchema, bodyData(req));
  const sectionIds = input.audience === 'SECTIONS' ? await validSections(a.sid, input.sectionIds) : [];
  const file = req.file ? await storeUpload(req.file, a.sid, 'notices', DOC_TYPES) : null;
  await prisma.notice.update({
    where: { id: existing.id },
    data: {
      title: input.title,
      body: input.body,
      audience: input.audience,
      sectionIds,
      pinned: input.pinned,
      expiresAt: input.expiresOn ? dateOnly(input.expiresOn) : null,
      ...(file
        ? { attachmentKey: file.key, attachmentName: file.fileName }
        : input.removeAttachment
          ? { attachmentKey: null, attachmentName: null }
          : {}),
    },
  });
  audit(req, 'notice.update', 'Notice', existing.id);
  res.json({ ok: true });
});

noticesRouter.delete('/:id', can('notices.manage'), async (req, res) => {
  const a = authOf(req);
  const r = await prisma.notice.deleteMany({ where: { id: str(req.params.id), schoolId: a.sid } });
  if (!r.count) throw notFound('Notice not found');
  audit(req, 'notice.delete', 'Notice', str(req.params.id));
  res.json({ ok: true });
});

// ───────── Holidays ─────────

noticesRouter.get('/holidays', async (req, res) => {
  const a = authOf(req);
  const session = await prisma.academicSession.findFirst({ where: { schoolId: a.sid, isCurrent: true } });
  const holidays = await prisma.holiday.findMany({
    where: {
      schoolId: a.sid,
      ...(session ? { date: { gte: session.startDate, lte: session.endDate } } : {}),
    },
    orderBy: { date: 'asc' },
  });
  res.json(
    holidays.map((h) => ({
      id: h.id,
      name: h.name,
      date: toDateStr(h.date),
      endDate: h.endDate ? toDateStr(h.endDate) : null,
      days: h.endDate ? Math.round((h.endDate.getTime() - h.date.getTime()) / 86_400_000) + 1 : 1,
    })),
  );
});

noticesRouter.post('/holidays', can('notices.manage'), async (req, res) => {
  const a = authOf(req);
  const input = parse(holidaySchema, req.body);
  const session = await prisma.academicSession.findFirst({ where: { schoolId: a.sid, isCurrent: true } });
  const h = await prisma.holiday.create({
    data: {
      schoolId: a.sid,
      sessionId: session?.id ?? null,
      name: input.name,
      date: dateOnly(input.date),
      endDate: input.endDate && input.endDate !== input.date ? dateOnly(input.endDate) : null,
    },
  });
  audit(req, 'holiday.create', 'Holiday', h.id);
  res.status(201).json(h);
});

noticesRouter.put('/holidays/:id', can('notices.manage'), async (req, res) => {
  const a = authOf(req);
  const input = parse(holidaySchema, req.body);
  const r = await prisma.holiday.updateMany({
    where: { id: str(req.params.id), schoolId: a.sid },
    data: {
      name: input.name,
      date: dateOnly(input.date),
      endDate: input.endDate && input.endDate !== input.date ? dateOnly(input.endDate) : null,
    },
  });
  if (!r.count) throw notFound('Holiday not found');
  res.json({ ok: true });
});

noticesRouter.delete('/holidays/:id', can('notices.manage'), async (req, res) => {
  const a = authOf(req);
  const r = await prisma.holiday.deleteMany({ where: { id: str(req.params.id), schoolId: a.sid } });
  if (!r.count) throw notFound('Holiday not found');
  res.json({ ok: true });
});

// ───────── SMS log ─────────

noticesRouter.get('/sms-log', can('notices.manage'), async (req, res) => {
  const a = authOf(req);
  const purpose = optStr(req.query.purpose);
  const status = optStr(req.query.status);
  const page = Math.max(1, Number(req.query.page) || 1);
  const where: Prisma.SmsLogWhereInput = {
    schoolId: a.sid,
    ...(purpose ? { purpose } : {}),
    ...(status ? { status: status as Prisma.SmsLogWhereInput['status'] } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.smsLog.count({ where }),
    prisma.smsLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 50, take: 50 }),
  ]);
  res.json({ total, page, pageSize: 50, provider: process.env.SMS_PROVIDER ?? 'log', items });
});
