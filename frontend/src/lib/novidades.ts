import { APP_VERSION } from '../data/changelog';

// Controle LOCAL (por navegador) de qual versão o usuário já viu no pop-up de
// novidades. Nada vai pro servidor — é só pra não repetir o aviso até a próxima
// release. Ver [[alarme-popup-fluxo]] para outro estado LOCAL do mapa.
const CHAVE = 'uptimex_novidades_vista';

/** Última versão que o usuário marcou como vista, ou null se nunca viu. */
export function versaoVista(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

/** Marca a versão atual como vista — o pop-up não reaparece até a próxima release. */
export function marcarNovidadesVistas(): void {
  try {
    localStorage.setItem(CHAVE, APP_VERSION);
  } catch {
    /* localStorage indisponível (modo privado): sem persistência, tudo bem */
  }
}

/** Há uma versão nova que o usuário ainda não viu? */
export function temNovidade(): boolean {
  return versaoVista() !== APP_VERSION;
}
