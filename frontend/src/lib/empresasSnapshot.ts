import { api, Empresa, ResumoStatusEmpresa } from '../api';

let empresas: Empresa[] | null = null;
let resumos: ResumoStatusEmpresa[] | null = null;
let requisicaoEmpresas: Promise<Empresa[]> | null = null;
let requisicaoResumos: Promise<ResumoStatusEmpresa[]> | null = null;
let geracao = 0;

export function empresasEmCache(): Empresa[] | null {
  return empresas;
}

export function resumosEmCache(): ResumoStatusEmpresa[] | null {
  return resumos;
}

/**
 * Busca um snapshot novo, mas compartilha a mesma Promise quando duas telas
 * pedem os dados ao mesmo tempo. O snapshot anterior continua disponível
 * durante a atualização para que a navegação não volte ao estado vazio.
 */
export function atualizarEmpresas(): Promise<Empresa[]> {
  if (requisicaoEmpresas) return requisicaoEmpresas;

  const geracaoDaRequisicao = geracao;
  const requisicao = api.listarEmpresas().then((dados) => {
    if (geracaoDaRequisicao === geracao) empresas = dados;
    return dados;
  });
  requisicaoEmpresas = requisicao;
  requisicao.then(
    () => {
      if (requisicaoEmpresas === requisicao) requisicaoEmpresas = null;
    },
    () => {
      if (requisicaoEmpresas === requisicao) requisicaoEmpresas = null;
    }
  );
  return requisicao;
}

export function atualizarResumos(): Promise<ResumoStatusEmpresa[]> {
  if (requisicaoResumos) return requisicaoResumos;

  const geracaoDaRequisicao = geracao;
  const requisicao = api.resumoStatusEmpresas().then((dados) => {
    if (geracaoDaRequisicao === geracao) resumos = dados;
    return dados;
  });
  requisicaoResumos = requisicao;
  requisicao.then(
    () => {
      if (requisicaoResumos === requisicao) requisicaoResumos = null;
    },
    () => {
      if (requisicaoResumos === requisicao) requisicaoResumos = null;
    }
  );
  return requisicao;
}

export function atualizarSnapshotEmpresas(): Promise<[Empresa[], ResumoStatusEmpresa[]]> {
  return Promise.all([atualizarEmpresas(), atualizarResumos()]);
}

/** Evita reaproveitar dados de uma sessão depois de logout ou expiração. */
export function limparSnapshotEmpresas() {
  geracao++;
  empresas = null;
  resumos = null;
  requisicaoEmpresas = null;
  requisicaoResumos = null;
}
