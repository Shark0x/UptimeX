import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const uploadsDir = path.join(__dirname, '../../uploads/empresas');
fs.mkdirSync(uploadsDir, { recursive: true });

const MIMETYPES_PERMITIDOS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = MIMETYPES_PERMITIDOS[file.mimetype] || path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

export const uploadFotoEmpresa = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!MIMETYPES_PERMITIDOS[file.mimetype]) {
      return cb(new Error('Tipo de arquivo não permitido. Use JPEG, PNG ou WebP.'));
    }
    cb(null, true);
  },
});
