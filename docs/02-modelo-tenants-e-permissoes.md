# Modelo de tenants e permissões

Status: implementado no backend MySQL  
Data: 2026-08-20  
Escopo: autenticação, autorização, banco de dados, API HTTP e Socket.IO

## 1. Decisão

O sistema adota o seguinte modelo:

- Cada registro de `empresas` representa um tenant.
- Um usuário pode acessar zero, uma ou várias empresas por meio de `usuario_empresas`.
- O papel global do usuário define o que ele pode fazer.
- O vínculo em `usuario_empresas` define em quais tenants ele pode agir.
- `admin` possui acesso global explícito e não depende de vínculo para acessar empresas.
- Antenas representam a infraestrutura wireless do provedor e não pertencem às empresas monitoradas.
- Toda autorização é feita no backend. Ocultar opções no frontend é apenas uma medida de interface.
- A política padrão é negar. Uma operação só é permitida quando papel e escopo estiverem autorizados.

Este modelo assume que as contas da aplicação pertencem à equipe interna do provedor/NOC. Se clientes externos passarem a receber contas, a leitura do board global de Antenas deverá ser revista antes da liberação.

Não há uma tabela `tenants` separada nesta versão. `empresa_id` é a chave de tenant já presente no domínio.

## 2. Situação anterior e controles aplicados

Antes do hardening, o backend ativo em MySQL possuía estas lacunas:

- `usuarios` possuía apenas `admin` e `visualizador`.
- Não existia vínculo entre usuário e empresa no MySQL.
- Um usuário autenticado conseguia informar qualquer `empresaId` nas rotas de leitura.
- Consultas por ID de dispositivo, nó, enlace ou métrica não validavam a empresa do usuário.
- O Socket.IO autenticava o token, mas aceitava entrada em qualquer sala `empresa_<id>`.
- O papel presente no JWT era usado diretamente durante até 12 horas, mesmo que a conta fosse desativada ou rebaixada.
- A auditoria MySQL não registrava `usuario_id` nem `empresa_id`.

Essas lacunas foram tratadas no MySQL e na API ativa. O PostgreSQL paralelo contém o modelo equivalente e políticas RLS, mas ainda não está ligado ao backend. O módulo `teste_antigravity` foi removido e Antenas permanece um domínio global do provedor, restrito a administradores.

## 3. Escopos de dados

### 3.1. Escopo tenant

Pertencem a uma empresa:

- cadastro e status da empresa;
- dispositivos;
- métricas de ping dos dispositivos;
- eventos de status;
- nós, enlaces e viewport da topologia interna;
- links dedicados;
- auditorias relacionadas a esses recursos.

Tabelas filhas que não possuem `empresa_id`, como métricas e eventos, herdam o tenant do dispositivo pai. A autorização deve resolver essa relação no banco, nunca confiar apenas no ID recebido.

### 3.2. Escopo global do provedor

Não pertencem a uma empresa:

- usuários e vínculos `usuario_empresas`;
- configurações de Telegram e resumos;
- chave e configuração da integração MCP;
- logs de login e segurança;
- antenas, métricas das antenas, topologia wireless e viewport do NOC;
- estado interno dos workers de monitoramento.

A integração MCP é uma identidade técnica global de somente leitura. Sua chave não representa um usuário e concede leitura transversal dos tenants; por isso deve ser gerada, rotacionada, revogada e auditada como credencial privilegiada.

O board de Antenas continua único e global. Não deve receber `empresa_id` apenas para reutilizar o modelo de empresas.

## 4. Papéis

Os papéis da aplicação serão:

- `admin`: administração global, usuários, tenants, vínculos, configurações e todos os recursos operacionais.
- `operador`: leitura e operação dos tenants vinculados, sem administração global.
- `visualizador`: somente leitura dos tenants vinculados e dos painéis globais permitidos.

O papel é global nesta versão. A associação por empresa controla apenas o alcance. Caso futuramente seja necessário que a mesma pessoa seja operadora em uma empresa e visualizadora em outra, o papel poderá migrar para a linha de `usuario_empresas` sem mudar a chave de tenant.

## 5. Matriz de permissões

| Recurso ou ação | Admin | Operador | Visualizador |
|---|---:|---:|---:|
| Listar/ver empresas | Todas | Somente vinculadas | Somente vinculadas |
| Ver status, dispositivos, métricas, topologia e links | Todas | Somente vinculadas | Somente vinculadas |
| Criar/editar dispositivos, topologia e links | Todas | Somente vinculadas | Não |
| Remover dispositivos, nós, enlaces e links | Sim | Não | Não |
| Criar/editar/remover empresas | Sim | Não | Não |
| Gerenciar usuários e vínculos | Sim | Não | Não |
| Ver board global de Antenas | Sim | Sim | Sim |
| Executar diagnóstico/ping de Antenas | Sim | Sim | Não |
| Criar/editar/remover Antenas e topologia wireless | Sim | Não | Não |
| Configurar Telegram, resumos e MCP | Sim | Não | Não |
| Ver auditoria de um tenant | Todas | Somente vinculadas | Somente vinculadas |
| Ver logs globais de login e segurança | Sim | Não | Não |
| Ver painel administrativo global | Sim | Não | Não |

Operações não existentes hoje, como reconhecer alertas, seguirão a mesma regra: `admin` em qualquer tenant, `operador` somente nos tenants vinculados e `visualizador` sem escrita.

## 6. Modelo de identidade e vínculo

Estrutura lógica mínima:

```text
usuarios
  id
  username
  senha_hash
  role: admin | operador | visualizador
  ativo
  sessao_versao

usuario_empresas
  usuario_id -> usuarios.id
  empresa_id -> empresas.id
  ativo
  criado_em
  PRIMARY KEY (usuario_id, empresa_id)
```

Regras:

- `username` continua único globalmente.
- O vínculo só concede acesso quando `ativo = true`.
- Revogar um vínculo define `ativo = false`; a revogação deve valer imediatamente.
- Usuários não administradores sem vínculos recebem listas vazias e não acessam tenants por ID.
- O administrador não precisa de linhas em `usuario_empresas`; seu bypass deve ser explícito e testado.
- Desativar o usuário ou aumentar `sessao_versao` invalida sessões existentes.

## 7. Sessão opaca

JWT foi removido. A sessão é identificada por um token opaco aleatório, armazenado no navegador somente em cookie `HttpOnly`; no banco permanece apenas o hash SHA-256 do token.

Estado persistido da sessão:

```text
usuario_id
token_hash
sessao_versao
expires_at / revoked_at / last_used_at
```

O backend carrega do banco, em cada requisição, o estado atual do usuário, o papel e os vínculos. A lista de empresas não é gravada no cookie. Assim, desativação, mudança de papel, troca de senha ou remoção de vínculo têm efeito imediato. Requisições mutáveis autenticadas por cookie também exigem o token CSRF double-submit.

## 8. Regras de autorização da API

O backend terá helpers equivalentes a:

```text
requireAuth()
requireGlobalRole(...roles)
requireEmpresaAccess(empresaId, ...roles)
requireResourceEmpresa(resourceType, resourceId, ...roles)
```

Regras obrigatórias:

1. Rotas de lista filtram os resultados no SQL; não carregam tudo para filtrar em memória.
2. Rotas com `:empresaId` validam o vínculo antes da consulta.
3. Rotas com apenas `:id` resolvem o `empresa_id` do recurso no mesmo SQL da operação.
4. `empresa_id` enviado no body nunca concede acesso; ele é validado contra os vínculos do usuário.
5. Updates e deletes usam predicado de tenant, por exemplo `WHERE id = ? AND empresa_id IN (...)`.
6. Métricas e históricos usam join com o recurso pai para verificar o tenant.
7. Recurso pertencente a outro tenant responde `404`, evitando confirmar sua existência.
8. Usuário do tenant com papel insuficiente responde `403`.
9. Toda escrita registra `usuario_id`, ação, entidade, ID, IP e timestamp. Ações tenant exigem o `empresa_id` correspondente; ações globais registram `empresa_id = NULL`.

### 8.1. Inventário de superfícies

| Superfície atual | Escopo e regra-alvo |
|---|---|
| `/api/auth` | Login público com rate limit; demais dados de sessão autenticados |
| `/api/empresas` | Lista filtrada por vínculo; criação, edição e remoção somente admin |
| `/api/dispositivos` | Tenant pelo dispositivo/`empresa_id`; leitura para vinculados, escrita conforme matriz |
| `/api/topologia` | Tenant pela empresa, nó ou enlace; nunca confiar no `empresa_id` do body |
| `/api/links` | Tenant pela empresa ou link; leitura para vinculados, escrita conforme matriz |
| `/api/auditoria` | Tenant pelo `empresa_id` da auditoria; admin pode ver todas |
| `/api/antenas` | Global do provedor; leitura autenticada, diagnóstico admin/operador, administração somente admin |
| `/api/usuarios` | Global, somente admin |
| `/api/admin` | Global, somente admin |
| `/api/alertas` | Configuração global, somente admin |
| `/api/integracao` | Estado e gestão da credencial MCP, somente admin |
| `/api/mcp` | Endpoint técnico autenticado por chave própria, global e somente leitura |
| `/api/empresas/:id/foto` | Imagem protegida pelo mesmo vínculo da empresa |
| `/uploads/empresas` | Diretório legado; deixará de ser servido anonimamente |
| `/socket.io` | Mesmas regras de vínculo das APIs tenant; Antenas em sala global autenticada |
| `/api/health` | Pode permanecer público, retornando apenas estado mínimo sem detalhes internos |

### 8.2. Política por método das rotas atuais

| Rota/operação | Política-alvo |
|---|---|
| `POST /api/auth/login` | Público com rate limit |
| `GET /api/empresas`, `/resumo-status`, `/:id` | Admin vê todas; demais veem somente vinculadas |
| `POST /api/empresas`, `PUT/DELETE /:id` | Somente admin |
| `GET /api/empresas/:id/foto` | Admin ou usuário vinculado; outro tenant recebe `404` |
| `GET /api/dispositivos/empresa/:empresaId`, `/:id/historico`, `/:id/metricas` | Admin ou usuário vinculado |
| `POST /api/dispositivos`, `PUT /:id` | Admin ou operador vinculado |
| `DELETE /api/dispositivos/:id` | Somente admin |
| `GET /api/topologia/empresa/:empresaId` | Admin ou usuário vinculado |
| `PUT .../viewport`, `POST .../nodes|edges`, `PUT .../nodes/:id/posicao` | Admin ou operador vinculado |
| `DELETE /api/topologia/nodes|edges/:id` | Somente admin |
| `GET /api/links/empresa/:empresaId` | Admin ou usuário vinculado |
| `POST /api/links` | Admin ou operador vinculado |
| `DELETE /api/links/:id` | Somente admin |
| `GET /api/auditoria` | Admin vê todas; demais somente auditoria dos tenants vinculados |
| `GET /api/antenas`, `/topologia`, `/:id/metricas` | Somente admin |
| `POST /api/antenas/:id/ping`, `/ping-todos` | Somente admin |
| Demais `POST/PUT/DELETE /api/antenas` | Somente admin |
| `/api/usuarios`, `/api/admin`, `/api/alertas`, `/api/integracao` | Somente admin |
| `POST /api/mcp` | Chave técnica válida; ferramentas disponíveis permanecem somente leitura |

As fotos são entregues por `GET /api/empresas/:id/foto`, usando a sessão HttpOnly e a autorização tenant. O frontend exibe o blob por URL de objeto; não existe URL pública permanente.

## 9. Socket.IO

A autorização HTTP e a autorização de eventos em tempo real são equivalentes.

- O handshake carrega a sessão e o usuário atual do banco, não confia em identidade enviada pelo cliente.
- `entrar_empresa(empresaId)` só permite a sala quando o usuário é admin ou possui vínculo ativo.
- Tentativas negadas não entram na sala e são auditadas ou registradas no log de segurança.
- Toda conexão entra também em `usuario_<id>`. Ao revogar um vínculo, o servidor executa a remoção das conexões desse usuário da sala `empresa_<id>`; em implantação com mais de uma instância, isso exige adapter/pub-sub compartilhado.
- Além da remoção ativa da sala, eventos de entrada e reconexão sempre consultam o vínculo atual.
- A sala global `antenas_noc` só pode ser lida por administradores.
- Eventos administrativos de Antenas não serão controlados somente por sala; a ação HTTP também exige o papel correto.

A primeira implementação suportará uma única instância do backend, como no compose atual. Antes de adicionar réplicas, será obrigatório configurar Redis Adapter (ou equivalente compartilhado) e testar revogação entre instâncias; escalar sem esse mecanismo não é permitido.

## 10. Telas de TV do NOC

Mapa TV e Antena TV continuam autenticados.

- Para mostrar todas as empresas, deve ser usada uma conta `visualizador` dedicada à TV e vinculada explicitamente a todas elas.
- A conta de TV não recebe permissão de escrita.
- Não será criado endpoint público ou token permanente embutido no frontend.
- A lista exibida na TV respeita os mesmos vínculos da API normal.
- O board global de Antenas exige uma conta administrativa dedicada; a conta visualizadora do Mapa TV de empresas não recebe esse acesso.

## 11. Banco de dados

### 11.1. MySQL durante a transição

Como o MySQL não oferece RLS equivalente ao PostgreSQL, o isolamento será aplicado no backend e em todos os SQLs. A aplicação não deve depender do frontend para ocultar dados.

O usuário de banco usado pelo backend não deve ser `root` em produção. Ele receberá somente os privilégios necessários sobre o schema da aplicação.

Até o cutover, o MySQL permanece a única fonte oficial de escrita. O PostgreSQL paralelo é ambiente de migração/validação; não haverá dual-write implícito entre os dois bancos. O procedimento de cutover terá runbook próprio, com janela, rollback e conferência de contagens.

### 11.2. PostgreSQL

O PostgreSQL será a segunda barreira de isolamento:

- `uptimex_app` usa RLS e não possui `SUPERUSER` nem `BYPASSRLS`.
- Cada requisição da API usa uma única conexão e transação, executando `SET LOCAL app.user_id` antes das consultas protegidas. Não será usado `SET` de sessão que possa vazar contexto entre conexões do pool.
- Políticas de tabelas tenant usam `app_can_access_empresa(empresa_id)`.
- Métricas e eventos validam acesso por join com o recurso pai.
- Tabelas globais de Antenas não usam `empresa_id`.
- Leitura global de Antenas exige usuário autenticado ativo; escrita global exige `admin`.
- O ping solicitado por `operador` é um comando autorizado ao serviço de monitoramento. O operador não recebe permissão SQL de escrita nas tabelas globais; o worker registra o resultado com sua credencial técnica limitada.
- `uptimex_worker` é uma identidade técnica separada, limitada às tabelas necessárias para polling e métricas.
- O worker não representa um usuário da aplicação e nunca recebe cookie de sessão.
- A identidade da aplicação pode inserir auditoria e consultar o que sua política permite, mas não atualizar ou apagar registros de auditoria.

## 12. Sequência de implementação

1. Adicionar `operador`, `sessao_versao`, `usuario_empresas`, `usuario_id` e `empresa_id` de auditoria ao MySQL.
2. Migrar administradores existentes sem perda de acesso e exigir vínculos explícitos para não administradores.
3. Reidratar usuário, papel e vínculos no middleware de autenticação.
4. Criar helpers de autorização e aplicá-los a todas as rotas tenant.
5. Restringir ações globais e separar leitura, diagnóstico e administração de Antenas.
6. Substituir o diretório público de fotos pela rota autenticada da empresa.
7. Validar salas do Socket.IO.
8. Adicionar gestão de vínculos na administração, coordenada com o frontend.
9. Alinhar o schema/RLS PostgreSQL ao módulo global atual de Antenas.
10. Trocar a credencial MySQL `root` por usuário de aplicação com menor privilégio.
11. Executar testes automatizados de isolamento antes de habilitar o modelo em produção.

## 13. Critérios de aceitação

O modelo estará implementado quando os seguintes testes passarem:

- Visualizador vinculado apenas à empresa A lista A e não lista B.
- Acesso direto do mesmo visualizador a um ID da empresa B retorna `404`.
- Operador da empresa A consegue alterar recurso operacional de A e não de B.
- Operador não consegue remover dispositivos, nós, enlaces ou links.
- Visualizador não consegue executar ações de escrita ou diagnóstico.
- Admin acessa e administra todas as empresas.
- Usuário desativado ou com sessão revogada perde acesso imediatamente.
- Remover um vínculo impede HTTP e Socket.IO sem aguardar a expiração da sessão.
- Eventos da empresa B não chegam à conexão vinculada apenas à empresa A.
- Somente admin observa, altera ou executa diagnósticos no board global de Antenas.
- Auditoria de ação tenant contém `usuario_id` e `empresa_id` corretos.
- Foto da empresa B não pode ser obtida por usuário vinculado apenas à empresa A.
- Conta de TV visualizadora não possui nenhuma operação de escrita.
- Testes tentam trocar IDs em URL e body para provar que não há IDOR entre tenants.

## 14. Fora de escopo desta decisão

- Permissões personalizadas por usuário.
- Papel diferente por empresa.
- Autenticação externa por LDAP, OIDC ou SAML.
- Federação de identidade e renovação silenciosa de sessão além do prazo configurado.
- Retenção, exportação e armazenamento imutável de longo prazo da auditoria.
- Acesso público anônimo aos mapas de TV.
- Transformar Antenas em recursos pertencentes a empresas.

Esses itens exigirão decisão separada caso passem a ser necessários.
