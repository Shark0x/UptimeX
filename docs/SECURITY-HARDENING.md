# uptimeX / NetMonitor — hardening aplicado

Atualizado em 20/08/2026. Este documento descreve controles que fazem parte do codigo e os passos operacionais necessarios para uma instalacao segura.

## Controles implementados

- Autenticacao por sessao opaca armazenada no MySQL. O navegador recebe somente um cookie `HttpOnly`; identidade e credenciais nao ficam em `localStorage`.
- Protecao CSRF double-submit para todos os metodos mutaveis autenticados por cookie.
- Expiracao, limite de sessoes, revogacao no logout, troca/redefinicao de senha e desconexao do Socket correspondente.
- Autorizacao multiempresa revalidada no banco em cada requisicao e ao entrar em rooms Socket.io.
- Board global de Antenas restrito a administradores, inclusive a room `antenas_noc`.
- Chaves MCP hasheadas, expiram em no maximo 365 dias e possuem escopo por empresa ou escopo global explicitamente selecionado.
- Comunidades SNMP e token do Telegram cifrados com AES-256-GCM. A API informa somente se a comunidade existe; nunca devolve o valor.
- Destinos ICMP/SNMP limitados a IP literal e a `MONITOR_ALLOWED_CIDRS`. Loopback, link-local, multicast e enderecos reservados permanecem bloqueados.
- Porta SNMP limitada por `SNMP_ALLOWED_PORTS` (padrao: `161`).
- Validacao Zod nos corpos mutaveis, validacao da assinatura real de uploads e limites para historicos/sondagens em lote.
- Rate limits para API, login por IP/usuario, MCP e Socket.io; fila do pool MySQL limitada.
- Erros HTTP sanitizados e logs de producao sem stack, SQL, IP de dispositivo ou credenciais.
- Retencao de auditoria configuravel; IPs de origem sao anonimizados antes da exclusao dos eventos.
- Nginx com CSP, HSTS, anti-frame, MIME sniffing desativado e demais headers defensivos.
- Backend e Nginx rodam sem root nos containers; a API usa um usuario MySQL CRUD, separado do usuario de migrations.
- Backend local escuta somente `127.0.0.1` e nao confia em headers encaminhados; no compose, `BIND_HOST=0.0.0.0` e `TRUST_PROXY_HOPS=1` ficam restritos a rede interna do Nginx.
- Dependencias auditadas sem vulnerabilidades conhecidas no momento desta atualizacao.

## Variaveis obrigatorias

Copie `.env.docker.example` para `.env` e substitua todos os valores de exemplo. Nunca reutilize senhas entre os itens abaixo.

- `MYSQL_ROOT_PASSWORD`: usada apenas por migration/bootstrap.
- `MYSQL_APP_PASSWORD`: usada pelo pool da API; minimo de 16 caracteres.
- `DATA_ENCRYPTION_KEY`: chave aleatoria com 32+ caracteres. Nao a troque sem antes planejar a recifragem dos segredos existentes.
- `SEED_ADMIN_PASSWORD`: usada somente se o banco ainda nao possui usuarios; deve ter 12+ caracteres, maiuscula, minuscula e numero.
- Senhas do PostgreSQL paralelo, enquanto ele permanecer no compose.

Comandos sugeridos para gerar valores:

```sh
openssl rand -base64 48
```

## Allowlist de monitoramento

Se `MONITOR_ALLOWED_CIDRS` estiver vazia, somente IPs publicos unicast sao aceitos. Redes privadas e CGNAT exigem inclusao explicita. Se a variavel tiver qualquer valor, ela passa a ser a fronteira completa e ate IPs publicos fora dela serao recusados.

Exemplo:

```env
MONITOR_ALLOWED_CIDRS=10.20.0.0/16,100.64.10.0/24,200.150.10.0/24
SNMP_ALLOWED_PORTS=161,1161
```

Use os menores blocos possiveis. Alterar essa lista requer reiniciar o backend.

## HTTPS obrigatorio em producao

O compose publica HTTP na porta configurada para facilitar teste local. Antes de expor a instalacao, coloque um reverse proxy TLS (Caddy, Traefik, Nginx ou load balancer) na frente do frontend e:

1. Aponte o dominio publico somente para o proxy TLS.
2. Nao exponha diretamente as portas do MySQL, PostgreSQL ou backend.
3. Encaminhe `X-Forwarded-Proto: https` pelo proxy confiavel.
4. Use `COOKIE_SECURE=true` (ou `auto` com o header acima).
5. Restrinja firewall para que a porta HTTP interna seja acessivel apenas pelo proxy/rede administrativa.

Para disponibilizar o backend de desenvolvimento diretamente na LAN, defina conscientemente `BIND_HOST=0.0.0.0`. Mantenha `TRUST_PROXY_HOPS=0` quando nao existir um proxy confiavel imediatamente a frente.

Sem dominio e certificado reais, o repositorio nao pode concluir essa etapa operacional sozinho.

## Mudancas que exigem acao do administrador

- A chave MCP antiga foi revogada durante a migration porque era global e reversivel. Gere outra em **Administracao > Integracao IA**, escolhendo uma empresa ou marcando explicitamente o escopo global.
- A geocodificacao por endereco esta desativada por padrao. Habilitar `EXTERNAL_GEOCODING_ENABLED=true` envia o endereco ao Nominatim pelo backend; avalie a politica de privacidade antes.
- Backups existentes nao foram apagados. Eles agora estao ignorados pelo Git, mas devem ser movidos para armazenamento cifrado fora da pasta do projeto e submetidos a uma politica de retencao.
- Rotacione senhas de banco, token do Telegram e qualquer credencial que possa ter sido compartilhada ou copiada antes deste hardening.

## Verificacao

```sh
cd backend
npm test
npm audit

cd ../frontend
npm run build
npm run test:e2e
npm audit
```

O deploy Docker tambem deve ser validado com `docker compose config --quiet` e um build limpo em uma maquina com Docker instalado.
