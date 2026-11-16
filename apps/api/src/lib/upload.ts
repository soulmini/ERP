import crypto from 'node:crypto';
import multer from 'multer';
import { badRequest } from './http';
import { putObject } from './storage';

/** Multer in-memory upload (default 5 MB). Use as route middleware: upload.single('file'). */
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const DOC_TYPES = [...IMAGE_TYPES, 'application/pdf'];

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Store an uploaded file in object storage under schools/{schoolId}/{folder}/ and return its key.
 * Save the key in the DB; serve it with signedUrl(key) from lib/storage.
 */
export async function storeUpload(
  file: Express.Multer.File | undefined,
  schoolId: string,
  folder: string,
  allowed: string[] = DOC_TYPES,
): Promise<{ key: string; fileName: string; contentType: string; size: number }> {
  if (!file) throw badRequest('Choose a file to upload');
  if (!allowed.includes(file.mimetype)) {
    throw badRequest(`File type not allowed. Allowed: ${allowed.map((t) => EXT[t] ?? t).join(', ')}`);
  }
  const key = `schools/${schoolId}/${folder}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${EXT[file.mimetype] ?? 'bin'}`;
  await putObject(key, file.buffer, file.mimetype);
  return { key, fileName: file.originalname.slice(0, 200), contentType: file.mimetype, size: file.size };
}
