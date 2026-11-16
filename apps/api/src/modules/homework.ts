import { Router, type Request } from 'express';
import { HOMEWORK_MAX_FILES, homeworkSchema, homeworkUpdateSchema } from '@erp/shared';
import { prisma } from '../db';
import type { Prisma } from '../generated/prisma/client';
import { badRequest, forbidden, notFound, optStr, parse, str } from '../lib/http';
import { dateOnly, toDateStr, todayStr } from '../lib/dates';
import { DOC_TYPES, storeUpload, upload } from '../lib/upload';
import { signedUrl } from '../lib/storage';
import { audit } from '../lib/audit';
import type { AuthPayload } from '../lib/tokens';
import { authOf } from '../middleware/auth';
import { currentSession } from './academic';
import { childSection, managesAll, parentChildren, sectionLabel, teacherSectionIds } from './scope';

/** Homework: teachers post per section with attachments; parents view. */
export const homeworkRouter = Router();

/** Sections this user may post homework to (null = all sections of the school). */
async function postableSections(a: AuthPayload): Promise<Set<string> | null> {
  if (managesAll(a, 'homework.manage')) return null;
  if (a.kinds.includes('TEACHER')) return teacherSectionIds(a);
  return new Set();
}

async function assertCanPost(a: AuthPayload, sectionId: string) {
  const section = await prisma.section.findFirst({ where: { id: sectionId, class: { schoolId: a.sid } }, include: { class: true } });
  if (!section) throw notFound('Section not found');
  const allowed = await postableSections(a);
  if (allowed && !allowed.has(sectionId)) throw forbidden('You can post homework only for your own classes');
  return section;
}

async function assertSubject(subjectId: string | undefined, classId: string) {
  if (!subjectId) return;
  const ok = await prisma.classSubject.findFirst({ where: { classId, subjectId } });
  if (!ok) throw badRequest('This subject is not taught in this class');
}

/** Multipart requests carry the JSON in a `data` field; plain JSON requests use the body. */
const bodyData = (req: Request) => (typeof req.body?.data === 'string' ? JSON.parse(req.body.data) : req.body);

const include = {
  section: { select: { name: true, class: { select: { name: true } } } },
  subject: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  attachments: true,
} as const;

type HomeworkRow = Prisma.HomeworkGetPayload<{ include: typeof include }>;

async function present(h: HomeworkRow, a: AuthPayload) {
  return {
    id: h.id,
    sectionId: h.sectionId,
    sectionLabel: sectionLabel(h.section),
    subject: h.subject,
    title: h.title,
    description: h.description,
    assignedDate: toDateStr(h.assignedDate),
    dueDate: h.dueDate ? toDateStr(h.dueDate) : null,
    postedBy: h.createdBy?.name ?? null,
    canEdit: managesAll(a, 'homework.manage') || h.createdById === a.sub,
    attachments: await Promise.all(
      h.attachments.map(async (f) => ({
        id: f.id,
        fileName: f.fileName,
        contentType: f.contentType,
        size: f.size,
        url: await signedUrl(f.fileKey),
      })),
    ),
  };
}

/** Sections (with their class subjects) the user can post to — for the "Post homework" form. */
homeworkRouter.get('/options', async (req, res) => {
  const a = authOf(req);
  const allowed = await postableSections(a);
  const sections = await prisma.section.findMany({
    where: { class: { schoolId: a.sid }, ...(allowed ? { id: { in: [...allowed] } } : {}) },
    orderBy: [{ class: { order: 'asc' } }, { name: 'asc' }],
    include: { class: { include: { subjects: { include: { subject: { select: { id: true, name: true } } } } } } },
  });
  res.json(
    sections.map((s) => ({
      id: s.id,
      label: sectionLabel(s),
      subjects: s.class.subjects
        .map((cs) => ({ ...cs.subject, mine: cs.teacherId === a.staffId }))
        .sort((x, y) => x.name.localeCompare(y.name)),
    })),
  );
});

/** Homework list. Parents: ?studentId= (their child). Staff: their sections (admins: all). */
homeworkRouter.get('/', async (req, res) => {
  const a = authOf(req);
  const session = await currentSession(a.sid);
  const subjectId = optStr(req.query.subjectId);
  const from = optStr(req.query.from);
  const to = optStr(req.query.to);
  let sectionIds: string[] | null = null;

  if (a.view === 'parent') {
    const studentId = optStr(req.query.studentId);
    sectionIds = studentId
      ? [(await childSection(a, studentId)).sectionId!]
      : (await parentChildren(a)).map((c) => c.sectionId!);
  } else {
    const allowed = managesAll(a, 'homework.manage') ? null : await teacherSectionIds(a);
    const requested = optStr(req.query.sectionId);
    if (requested && allowed && !allowed.has(requested)) throw forbidden();
    sectionIds = requested ? [requested] : allowed ? [...allowed] : null;
  }

  const rows = await prisma.homework.findMany({
    where: {
      schoolId: a.sid,
      sessionId: session.id,
      ...(sectionIds ? { sectionId: { in: sectionIds } } : {}),
      ...(subjectId ? { subjectId } : {}),
      ...(from || to ? { assignedDate: { ...(from ? { gte: dateOnly(from) } : {}), ...(to ? { lte: dateOnly(to) } : {}) } } : {}),
    },
    orderBy: [{ assignedDate: 'desc' }, { createdAt: 'desc' }],
    take: 150,
    include,
  });
  res.json(await Promise.all(rows.map((h) => present(h, a))));
});

homeworkRouter.post('/', upload.array('files', HOMEWORK_MAX_FILES), async (req, res) => {
  const a = authOf(req);
  const input = parse(homeworkSchema, bodyData(req));
  const section = await assertCanPost(a, input.sectionId);
  await assertSubject(input.subjectId, section.classId);
  const session = await currentSession(a.sid);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const stored = await Promise.all(files.map((f) => storeUpload(f, a.sid, 'homework', DOC_TYPES)));

  const hw = await prisma.homework.create({
    data: {
      schoolId: a.sid,
      sessionId: session.id,
      sectionId: input.sectionId,
      subjectId: input.subjectId ?? null,
      title: input.title,
      description: input.description ?? null,
      assignedDate: dateOnly(input.assignedDate ?? todayStr()),
      dueDate: input.dueDate ? dateOnly(input.dueDate) : null,
      createdById: a.sub,
      attachments: {
        create: stored.map((f) => ({ fileKey: f.key, fileName: f.fileName, contentType: f.contentType, size: f.size })),
      },
    },
    include,
  });
  audit(req, 'homework.create', 'Homework', hw.id, { sectionId: hw.sectionId });
  res.status(201).json(await present(hw, a));
});

async function ownHomework(a: AuthPayload, id: string) {
  const hw = await prisma.homework.findFirst({ where: { id, schoolId: a.sid }, include: { attachments: true } });
  if (!hw) throw notFound('Homework not found');
  if (!managesAll(a, 'homework.manage') && hw.createdById !== a.sub) throw forbidden('You can change only homework you posted');
  return hw;
}

homeworkRouter.put('/:id', upload.array('files', HOMEWORK_MAX_FILES), async (req, res) => {
  const a = authOf(req);
  const existing = await ownHomework(a, str(req.params.id));
  const input = parse(homeworkUpdateSchema, bodyData(req));
  const section = await assertCanPost(a, input.sectionId);
  await assertSubject(input.subjectId, section.classId);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const remaining = existing.attachments.filter((f) => !input.removeAttachmentIds.includes(f.id)).length;
  if (remaining + files.length > HOMEWORK_MAX_FILES) throw badRequest(`At most ${HOMEWORK_MAX_FILES} attachments`);
  const stored = await Promise.all(files.map((f) => storeUpload(f, a.sid, 'homework', DOC_TYPES)));

  const hw = await prisma.homework.update({
    where: { id: existing.id },
    data: {
      sectionId: input.sectionId,
      subjectId: input.subjectId ?? null,
      title: input.title,
      description: input.description ?? null,
      assignedDate: input.assignedDate ? dateOnly(input.assignedDate) : existing.assignedDate,
      dueDate: input.dueDate ? dateOnly(input.dueDate) : null,
      attachments: {
        deleteMany: { id: { in: input.removeAttachmentIds } },
        create: stored.map((f) => ({ fileKey: f.key, fileName: f.fileName, contentType: f.contentType, size: f.size })),
      },
    },
    include,
  });
  audit(req, 'homework.update', 'Homework', hw.id);
  res.json(await present(hw, a));
});

homeworkRouter.delete('/:id', async (req, res) => {
  const a = authOf(req);
  const hw = await ownHomework(a, str(req.params.id));
  await prisma.homework.delete({ where: { id: hw.id } });
  audit(req, 'homework.delete', 'Homework', hw.id);
  res.json({ ok: true });
});
