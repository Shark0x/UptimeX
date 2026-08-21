import crypto from 'crypto';

const PREFIX = 'enc:v1:';

function encryptionKey(): Buffer {
  const secret = String(process.env.DATA_ENCRYPTION_KEY || '');
  if (secret.length < 32) {
    throw new Error('DATA_ENCRYPTION_KEY deve ter pelo menos 32 caracteres.');
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

export function segredoEstaCifrado(valor: string | null | undefined): boolean {
  return typeof valor === 'string' && valor.startsWith(PREFIX);
}

export function criptografarSegredo(valor: string): string {
  if (!valor) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(valor, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function descriptografarSegredo(valor: string | null | undefined): string {
  if (!valor) return '';
  if (!segredoEstaCifrado(valor)) return valor; // compatibilidade durante a migracao
  const partes = valor.split(':');
  if (partes.length !== 5 || partes[0] !== 'enc' || partes[1] !== 'v1') {
    throw new Error('Segredo cifrado em formato invalido.');
  }
  const iv = Buffer.from(partes[2], 'base64url');
  const tag = Buffer.from(partes[3], 'base64url');
  const ciphertext = Buffer.from(partes[4], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function chaveCriptografiaConfigurada(): boolean {
  return String(process.env.DATA_ENCRYPTION_KEY || '').length >= 32;
}
