# Auditoria de seguranca — uptimeX / NetMonitor

Data: 20/08/2026  
Escopo: backend Node.js/TypeScript, API Express, Socket.IO, MySQL, frontend React/Vite, Nginx, Docker e schema PostgreSQL paralelo.  
Status: achados de codigo corrigidos; pendencias operacionais listadas ao final.

## Resumo executivo

Foram identificados 18 achados: 4 criticos, 7 altos, 5 medios e 2 baixos. Os 18 controles de codigo foram implementados. Nao permanece achado critico conhecido no codigo revisado.

As tres prioridades anteriores a qualquer exposicao multi-cliente eram:

1. retirar a identidade/autorizacao do cliente e impedir IDOR HTTP/Socket entre empresas;
2. proteger e rotacionar sessoes, comunidades SNMP, token Telegram e chaves MCP;
3. limitar destinos de monitoramento, abuso de endpoints e privilegios de infraestrutura.

Essas prioridades foram tratadas. Ainda e obrigatorio concluir TLS e rotacao de credenciais reais no ambiente de producao.

## Achados criticos

### S-01 — Identidade e sessao controladas pelo cliente

- **Severidade:** Critica
- **Local anterior:** `frontend/src/auth/AuthContext.tsx`, `frontend/src/api.ts`, `backend/src/middleware/auth.ts`, `backend/src/routes/auth.ts`
- **Problema:** identidade/token persistidos no `localStorage` e sessao sem revogacao forte permitiam adulteracao no cliente, roubo por XSS e autorizacao desatualizada.
- **Exploracao:** um atacante com script no navegador copiaria a credencial; uma conta desativada ou rebaixada continuaria usando o estado antigo ate expirar.
- **Correcao aplicada:** sessao opaca aleatoria, somente hash no MySQL, cookie `HttpOnly`, expiracao, limite de sessoes, revogacao no logout/troca de senha e reidratacao de papel/vinculos no banco a cada requisicao. JWT legado foi removido.
- **Status:** Resolvido em `backend/src/services/sessionService.ts`, `backend/src/middleware/auth.ts`, `backend/src/routes/auth.ts` e `frontend/src/auth/AuthContext.tsx`.

### S-02 — IDOR entre empresas nas rotas HTTP

- **Severidade:** Critica
- **Local anterior:** rotas em `backend/src/routes/empresas.ts`, `dispositivos.ts`, `topologia.ts`, `links.ts`, `auditoria.ts` e `pingHistory.ts`
- **Problema:** IDs informados na URL/body podiam selecionar registros de outra empresa sem provar o vinculo do usuario.
- **Exploracao:** trocar `empresaId`, `deviceId`, `nodeId` ou `edgeId` permitia ler ou alterar outro tenant.
- **Correcao aplicada:** escopo SQL por empresa, resolucao do tenant pelo recurso pai, `404` para recurso fora do escopo e separacao entre papel global e vinculo ativo.
- **Status:** Resolvido em `backend/src/security/tenantAccess.ts` e nos routers citados.

### S-03 — Rooms Socket.IO sem fronteira de autorizacao equivalente a API

- **Severidade:** Critica
- **Local anterior:** `backend/src/index.ts`
- **Problema:** esconder eventos no frontend ou aceitar `entrar_empresa` sem revalidacao nao isola dados em tempo real.
- **Exploracao:** um cliente Socket.IO proprio pediria a room de outra empresa e receberia seus eventos.
- **Correcao aplicada:** handshake por sessao de banco, rooms iniciais derivadas de vinculos, reconsulta do vinculo ao entrar, remocao ativa em revogacoes, expiracao da conexao, limite de conexoes e flood.
- **Status:** Resolvido em `backend/src/index.ts` e `backend/src/routes/usuarios.ts`.

### S-04 — Segredos SNMP/MCP reversiveis ou expostos

- **Severidade:** Critica
- **Local anterior:** `backend/src/routes/dispositivos.ts`, `backend/src/services/configService.ts`, configuracoes MCP no banco e respostas de dispositivos
- **Problema:** community strings e chaves tecnicas podiam ser armazenadas/retornadas sem protecao adequada.
- **Exploracao:** leitura do banco, log ou resposta da API entregaria acesso SNMP ou acesso global da integracao.
- **Correcao aplicada:** AES-256-GCM para SNMP/Telegram, chave de criptografia externa, migracao automatica de plaintext, respostas sem a comunidade, MCP com hash, expiracao e revogacao. A chave MCP antiga foi invalidada.
- **Status:** Resolvido em `backend/src/security/secretCrypto.ts`, `configService.ts`, `mcpKeyService.ts` e migrations `20260820_security_*.sql`.

## Achados altos

### S-05 — Ausencia de protecao CSRF para autenticacao por cookie

- **Severidade:** Alta
- **Local:** middleware HTTP e cliente da API.
- **Exploracao:** uma pagina maliciosa faria o navegador autenticado enviar operacoes mutaveis.
- **Correcao aplicada:** double-submit cookie com comparacao constante e header `X-CSRF-Token` em todas as mutacoes autenticadas.
- **Status:** Resolvido em `backend/src/middleware/csrf.ts` e `frontend/src/api.ts`.

### S-06 — Modulo global de Antenas acessivel por papel insuficiente

- **Severidade:** Alta
- **Local anterior:** `backend/src/routes/antenas.ts`, room `antenas_noc` e navegacao do frontend.
- **Exploracao:** conta de tenant observaria infraestrutura do provedor ou executaria diagnosticos globais.
- **Correcao aplicada:** router, room e telas de Antenas restritos a `admin`.
- **Status:** Resolvido.

### S-07 — Monitoramento de destinos arbitrarios

- **Severidade:** Alta
- **Local anterior:** cadastro/edicao de dispositivos e execucao ICMP/SNMP.
- **Exploracao:** a aplicacao seria usada para sondar loopback, metadata cloud, rede interna nao autorizada, multicast ou portas SNMP inesperadas.
- **Correcao aplicada:** somente IP literal; bloqueio absoluto de loopback/link-local/reservados/multicast/mapped/NAT64; redes privadas e CGNAT exigem allowlist; allowlist configurada vira fronteira total; portas SNMP explicitamente permitidas; revalidacao no momento da execucao.
- **Status:** Resolvido em `backend/src/security/monitorTarget.ts` e nos motores de monitoramento.

### S-08 — Chave MCP global, sem tenant e sem expiracao

- **Severidade:** Alta
- **Local anterior:** `/api/mcp`, `backend/src/mcp/uptimexMcp.ts`, configuracoes administrativas.
- **Exploracao:** vazamento de uma chave entregaria consultas a todas as empresas indefinidamente.
- **Correcao aplicada:** chave hasheada, prefixo apenas para identificacao, validade maxima, tenant obrigatorio ou escopo global explicitamente selecionado e filtro aplicado a todas as ferramentas.
- **Status:** Resolvido.

### S-09 — Flood e consultas pesadas sem limites suficientes

- **Severidade:** Alta
- **Local anterior:** login, Socket.IO, historicos, metricas e ping em lote.
- **Exploracao:** brute force, excesso de sockets/eventos ou ranges grandes esgotariam CPU, banco e rede.
- **Correcao aplicada:** limites global/login/usuario/MCP/Socket, payload de socket de 64 KiB, maximo de conexoes, ranges fechados, agregacao, paginacao, concorrencia de ping e fila MySQL limitada.
- **Status:** Resolvido.

### S-10 — Upload baseado apenas em MIME informado pelo cliente

- **Severidade:** Alta
- **Local anterior:** `backend/src/middleware/upload.ts` e entrega de fotos.
- **Exploracao:** arquivo arbitrario seria salvo como imagem e potencialmente servido como conteudo ativo.
- **Correcao aplicada:** tamanho de 4 MiB, tipos fechados, assinatura real JPEG/PNG/WebP, nomes UUID, exclusao de upload invalido e entrega autenticada por tenant com `nosniff`.
- **Status:** Resolvido.

### S-11 — Backend/containers/banco com privilegios excessivos

- **Severidade:** Alta
- **Local anterior:** Dockerfiles, `docker-compose.yml`, migration MySQL.
- **Exploracao:** comprometimento da API teria impacto ampliado por usuario root, filesystem gravavel ou capabilities desnecessarias.
- **Correcao aplicada:** processos sem root, filesystem read-only, `no-new-privileges`, capabilities removidas salvo `NET_RAW`, usuario MySQL CRUD separado e credencial administrativa removida antes de iniciar a API.
- **Status:** Resolvido no codigo; build Docker precisa ser repetido em host com Docker.

## Achados medios

### S-12 — CORS, proxy e headers permissivos/incompletos

- **Severidade:** Media
- **Exploracao:** origem nao autorizada consumiria a API; headers falsificados burlariam rate limit; ausencia de headers ampliaria XSS/clickjacking.
- **Correcao aplicada:** origens exatas com credenciais, rede privada de desenvolvimento opt-in, `trust proxy` desativado no acesso direto e limitado a um salto no compose, Helmet e headers Nginx CSP/HSTS/DENY/nosniff.
- **Status:** Resolvido no codigo.

### S-13 — Erros e logs com detalhes internos

- **Severidade:** Media
- **Exploracao:** respostas ou logs revelariam SQL, stack, destinos de rede, tokens ou respostas de terceiros.
- **Correcao aplicada:** handler central com ID aleatorio, respostas genericas, logs sem stack/SQL em producao e sem IP/nome de dispositivos em falhas de polling.
- **Status:** Resolvido.

### S-14 — Auditoria sem contexto/retencao e IP preservado indefinidamente

- **Severidade:** Media
- **Exploracao:** investigacoes nao conseguiriam provar tenant/ator; copia antiga do banco manteria dados pessoais alem do necessario.
- **Correcao aplicada:** `usuario_id`, `empresa_id`, IP e timestamp; rota tenant sem expor IP/geolocalizacao; anonimização de IP e prune configuraveis.
- **Status:** Resolvido.

### S-15 — Dependencias com vulnerabilidades conhecidas

- **Severidade:** Media
- **Local anterior:** manifests backend/frontend.
- **Exploracao:** cadeia de dependencias vulneravel atingiria build ou runtime.
- **Correcao aplicada:** remocao de pacotes desnecessarios/legados, atualizacao do Vite e lockfiles.
- **Status:** Resolvido; `npm audit` retorna zero nos dois projetos em 20/08/2026.

### S-16 — Vazamento de endereco do cliente para servicos de mapa

- **Severidade:** Media
- **Exploracao:** o browser enviaria enderecos/telemetria diretamente a terceiros.
- **Correcao aplicada:** geocodificacao autenticada no backend e desativada por padrao; tiles passam por proxy autenticado com timeout e limite de tamanho.
- **Status:** Resolvido no codigo; habilitar geocodificacao exige decisao de privacidade.

## Achados baixos

### S-17 — Configuracao e documentacao de seguranca divergentes

- **Severidade:** Baixa
- **Exploracao:** operacao baseada em comentario antigo poderia reintroduzir JWT ou acesso amplo de Antenas.
- **Correcao aplicada:** exemplos de ambiente e documentos alinhados a sessao opaca, CSRF, roles e proxy confiavel.
- **Status:** Resolvido.

### S-18 — Backups locais sem regra de exclusao do Git

- **Severidade:** Baixa
- **Exploracao:** dump poderia ser adicionado por engano a um commit ou pacote de deploy.
- **Correcao aplicada:** padroes de dumps/tarballs no `.gitignore` e orientacao para armazenamento cifrado/retencao.
- **Status:** Resolvido para novos commits; arquivos existentes nao foram apagados.

## Pendencias operacionais

Estas acoes dependem do ambiente e nao podem ser concluidas apenas alterando o repositorio:

1. **Alta — TLS real:** instalar dominio/certificado, manter banco/backend sem exposicao direta e usar `COOKIE_SECURE=true`.
2. **Alta — rotacao e custodia:** rotacionar senhas reais, token Telegram e qualquer credencial historicamente compartilhada; mover backups existentes para armazenamento cifrado e aplicar retencao.
3. **Media — validacao de imagem:** executar `docker compose config --quiet`, build limpo e smoke test em uma maquina com Docker; o CLI Docker nao estava instalado no host desta auditoria.

## Evidencias de verificacao

- backend: TypeScript/build e 12 testes de seguranca aprovados;
- frontend: TypeScript/Vite build aprovado e 6 testes Playwright desktop/mobile aprovados;
- dependencias: zero vulnerabilidades reportadas por `npm audit` no backend e frontend;
- API ativa: health `200`, headers Helmet, CORS restrito, endpoint `teste-antigravity` em `404`;
- banco local: migrations de sessoes, segredos e MCP aplicadas; communities SNMP legadas recifradas; chave MCP legada removida;
- teste transiente real: login criou cookie sem token no body, tenant nao vinculado ficou vazio, Antenas retornou `403`, mutacao sem CSRF retornou `403`, logout revogou a sessao.

Consulte tambem `docs/SECURITY-HARDENING.md` para o runbook operacional.
