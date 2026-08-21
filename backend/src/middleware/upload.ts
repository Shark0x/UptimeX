import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';

const uploadsDir = path.join(__dirname, '../../uploads/empresas');
const uploadsAvatarDir = path.join(__dirname, '../../uploads/usuarios');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(uploadsAvatarDir, { recursive: true });

const MIMETYPES_PERMITIDOS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function criarStorage(destino: string) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destino),
    filename: (_req, file, cb) => {
      const ext = MIMETYPES_PERMITIDOS[file.mimetype] || path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  });
}

const opcoesMulter = {
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (!MIMETYPES_PERMITIDOS[file.mimetype]) {
      return cb(new Error('Tipo de arquivo não permitido. Use JPEG, PNG ou WebP.'));
    }
    cb(null, true);
  },
};

export const uploadFotoEmpresa = multer({ storage: criarStorage(uploadsDir), ...opcoesMulter });
export const uploadAvatarUsuario = multer({ storage: criarStorage(uploadsAvatarDir), ...opcoesMulter });

function assinaturaCorresponde(buffer: Buffer, mimetype: string): boolean {
  if (mimetype === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === 'image/png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimetype === 'image/webp') {
    return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

export async function descartarUploadFoto(req: Request): Promise<void> {
  if (!req.file?.path) return;
  await fs.promises.unlink(req.file.path).catch(() => undefined);
  req.file = undefined;
}

/** Nao confia apenas no Content-Type informado pelo navegador. */
export async function validarConteudoFotoEmpresa(req: Request, res: Response, next: NextFunction) {
  if (!req.file) return next();
  try {
    const handle = await fs.promises.open(req.file.path, 'r');
    const cabecalho = Buffer.alloc(12);
    const { bytesRead } = await handle.read(cabecalho, 0, cabecalho.length, 0);
    await handle.close();
    if (!assinaturaCorresponde(cabecalho.subarray(0, bytesRead), req.file.mimetype)) {
      await descartarUploadFoto(req);
      return res.status(400).json({ erro: 'Conteudo do arquivo nao corresponde a uma imagem JPEG, PNG ou WebP valida.' });
    }
    next();
  } catch (erro) {
    await descartarUploadFoto(req);
    next(erro);
  }
}
