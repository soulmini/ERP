import { Router } from 'express';
import multer from 'multer';
import { schoolSchema } from '@erp/shared';
import { prisma } from '../db';
import { badRequest, parse } from '../lib/http';
import { putObject, signedUrl } from '../lib/storage';
import { audit } from '../lib/audit';
import { authOf, can } from '../middleware/auth';

export const schoolRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

schoolRouter.get('/', async (req, res) => {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: authOf(req).sid } });
  res.json({ ...school, logoUrl: await signedUrl(school.logoKey) });
});

schoolRouter.put('/', can('school.manage'), async (req, res) => {
  const data = parse(schoolSchema, req.body);
  const school = await prisma.school.update({ where: { id: authOf(req).sid }, data });
  audit(req, 'school.update', 'School', school.id);
  res.json({ ...school, logoUrl: await signedUrl(school.logoKey) });
});

schoolRouter.post('/logo', can('school.manage'), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest('Choose an image file');
  const ext = IMAGE_TYPES[file.mimetype];
  if (!ext) throw badRequest('Logo must be PNG, JPG or WEBP');
  const { sid } = authOf(req);
  const key = `schools/${sid}/logo-${Date.now()}.${ext}`;
  await putObject(key, file.buffer, file.mimetype);
  await prisma.school.update({ where: { id: sid }, data: { logoKey: key } });
  audit(req, 'school.logo', 'School', sid);
  res.json({ logoUrl: await signedUrl(key) });
});
