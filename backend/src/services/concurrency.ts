// Primitivas de concorrência usadas pelo polling (motor ICMP e engine SNMP).
// Puras e sem dependências — testáveis isoladamente.

/**
 * Limitador de concorrência (estilo p-limit, sem dependência externa). Garante
 * que no máximo `maxConcorrentes` tarefas rodem ao mesmo tempo; o excedente
 * aguarda em fila. Essencial para o polling SNMP não saturar o Event Loop do
 * Node nem a rede quando há muitos dispositivos/interfaces.
 */
export function criarLimitadorConcorrencia(maxConcorrentes: number) {
  const limite = Math.max(1, Math.trunc(maxConcorrentes));
  let emExecucao = 0;
  const fila: Array<() => void> = [];

  const liberarProxima = () => {
    emExecucao -= 1;
    const proxima = fila.shift();
    if (proxima) proxima();
  };

  function limitar<T>(tarefa: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const executar = () => {
        emExecucao += 1;
        tarefa().then(
          (valor) => {
            liberarProxima();
            resolve(valor);
          },
          (erro) => {
            liberarProxima();
            reject(erro);
          }
        );
      };
      if (emExecucao < limite) executar();
      else fila.push(executar);
    });
  }

  limitar.emExecucao = () => emExecucao;
  limitar.naFila = () => fila.length;
  return limitar;
}

/**
 * Mutex por chave: serializa as execuções que compartilham a mesma chave
 * (ex.: id do dispositivo). Dois ciclos de coleta do MESMO dispositivo nunca
 * rodam concorrentes — elimina leituras sobrepostas ao editar o dispositivo,
 * reiniciar o serviço ou disparar um diagnóstico manual. Chaves diferentes
 * continuam paralelas.
 */
export function criarMutexPorChave<K = number>() {
  const cadeias = new Map<K, Promise<unknown>>();

  function exclusivo<T>(chave: K, fn: () => Promise<T>): Promise<T> {
    const anterior = cadeias.get(chave) ?? Promise.resolve();
    const proxima = anterior.then(fn, fn);
    // A cauda nunca rejeita, para o erro de uma tarefa não "envenenar" a fila.
    // O conjunto de chaves é limitado (um id por dispositivo), então não cresce
    // sem limite; manter a cadeia viva preserva a ordem entre chamadas tardias.
    cadeias.set(chave, proxima.then(() => undefined, () => undefined));
    return proxima;
  }

  exclusivo.tamanho = () => cadeias.size;
  return exclusivo;
}
