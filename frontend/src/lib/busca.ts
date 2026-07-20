/** Normaliza pra busca: minusculas e sem acentos ("Terreo" casa com "terreo"). */
const ACENTOS = new RegExp('[' + String.fromCharCode(768) + '-' + String.fromCharCode(879) + ']', 'g');

export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(ACENTOS, '').toLowerCase();
}

export function combinaBusca(nome: string, busca: string): boolean {
  const b = normalizar(busca.trim());
  return b === '' || normalizar(nome).includes(b);
}

