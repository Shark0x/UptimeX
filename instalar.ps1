# ============================================================
#  Instalador do uptimeX (Docker) — Windows (Docker Desktop)
#  Uso: clique-direito > Executar com PowerShell,  ou:
#       powershell -ExecutionPolicy Bypass -File instalar.ps1
# ============================================================
$ErrorActionPreference = 'Stop'

function Verde($msg) { Write-Host $msg -ForegroundColor Green }
function Falha($msg) { Write-Host "ERRO: $msg" -ForegroundColor Red; exit 1 }

# ---- 1. pre-requisitos ----
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Falha "Docker nao encontrado. Instale o Docker Desktop: https://www.docker.com/products/docker-desktop/"
}
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Falha "Plugin 'docker compose' nao encontrado (atualize o Docker Desktop)." }
if (-not (Test-Path 'docker-compose.yml')) { Falha "Execute este script na raiz do projeto (onde esta o docker-compose.yml)." }

# ---- 2. .env com TODOS os segredos gerados ----
# O compose exige as 3 senhas do Postgres (owner/app/worker), a chave de
# criptografia e a senha do admin. Geramos todas aleatorias - sem placeholders.
# MYSQL_ROOT_PASSWORD so e usado na migracao opcional (profile 'migration').
if (-not (Test-Path '.env')) {
  if (-not (Test-Path '.env.docker.example')) { Falha "Falta o .env.docker.example (modelo do .env)." }
  # Get-Random com -Count exige elementos unicos; repetimos ate ter o tamanho.
  function Gerar($n) {
    $chars = (48..57) + (65..90) + (97..122)
    -join (1..$n | ForEach-Object { [char]($chars | Get-Random) })
  }
  $env_MYSQL_ROOT = Gerar 28
  $env_PG = Gerar 28
  $env_PG_APP = Gerar 28
  $env_PG_WORKER = Gerar 28
  $env_ENC = Gerar 48
  $env_ADMIN = 'Ax7' + (Gerar 21)   # garante maiuscula+minuscula+numero

  (Get-Content '.env.docker.example') `
    -replace '^MYSQL_ROOT_PASSWORD=.*', "MYSQL_ROOT_PASSWORD=$env_MYSQL_ROOT" `
    -replace '^POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$env_PG" `
    -replace '^POSTGRES_APP_PASSWORD=.*', "POSTGRES_APP_PASSWORD=$env_PG_APP" `
    -replace '^POSTGRES_WORKER_PASSWORD=.*', "POSTGRES_WORKER_PASSWORD=$env_PG_WORKER" `
    -replace '^DATA_ENCRYPTION_KEY=.*', "DATA_ENCRYPTION_KEY=$env_ENC" `
    -replace '^SEED_ADMIN_PASSWORD=.*', "SEED_ADMIN_PASSWORD=$env_ADMIN" |
    Out-File -Encoding ascii '.env'

  if (Select-String -Path '.env' -Pattern 'troque_por' -Quiet) {
    Falha "Sobrou algum placeholder no .env. Confira o .env.docker.example e rode de novo."
  }
  Verde ".env criado com TODOS os segredos aleatorios (Postgres, criptografia, admin)."
  Write-Host "   Guarde a senha do admin mostrada no final desta instalacao."
  Write-Host "   Quer alertas no Telegram? Edite o .env depois e rode: docker compose restart backend"
} else {
  Write-Host ".env ja existe - mantendo o atual (nenhum segredo foi sobrescrito)."
}

# ---- 3. build + subir ----
Verde "Construindo e subindo os containers (a primeira vez demora alguns minutos)..."
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Falha "docker compose up falhou - veja as mensagens acima." }

# ---- 4. aguardar o backend (o schema/RLS vem do container Postgres) ----
Write-Host 'Aguardando backend e banco' -NoNewline
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  $logs = docker compose logs backend 2>$null | Out-String
  if ($logs -match 'backend rodando em') { $ok = $true; break }
  Write-Host '.' -NoNewline
  Start-Sleep -Seconds 2
}
Write-Host ''
if (-not $ok) { Falha "Backend nao subiu em 120s. Investigue com: docker compose logs backend" }
Verde "Backend no ar - schema/RLS criados pelo container Postgres e admin semeado."

# ---- 5. dados de uma instalacao MySQL antiga (opcional) ----
if (Test-Path 'backup-netmonitor.sql') {
  Write-Host ''
  Verde "Encontrei backup-netmonitor.sql (dados de uma instalacao MySQL antiga)."
  Write-Host '   A migracao MySQL -> PostgreSQL roda pelo migrador dedicado (profile ''migration''),'
  Write-Host '   nao por este instalador. Passo a passo em DEPLOY.md, secao "Levando os dados atuais":'
  Write-Host '     1) preencha MYSQL_ROOT_PASSWORD no .env'
  Write-Host '     2) docker compose --profile migration up -d mysql  (e restaure o dump nele)'
  Write-Host '     3) docker compose --profile migration run --rm postgres-migrator'
}

# ---- 6. resumo ----
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.)' -and $_.InterfaceAlias -notmatch 'Loopback|WSL|vEthernet' } | Select-Object -First 1).IPAddress
$porta = (Select-String -Path '.env' -Pattern '^APP_PORT=(.+)$' -ErrorAction SilentlyContinue).Matches.Groups[1].Value
if (-not $porta) { $porta = '8080' }
Verde '============================================'
Verde ' uptimeX instalado e rodando!'
Write-Host " Acesse:  http://$(if ($ip) { $ip } else { 'IP_DA_MAQUINA' }):$porta"
Write-Host ' Status:  docker compose ps'
Write-Host ' Logs:    docker compose logs -f backend'
Write-Host ''
$logsAdmin = docker compose logs backend 2>$null | Out-String
$adminPass = (Select-String -Path '.env' -Pattern '^SEED_ADMIN_PASSWORD=(.+)$' -ErrorAction SilentlyContinue).Matches.Groups[1].Value
if ($logsAdmin -match 'admin ja existente') {
  Write-Host ' Banco ja tinha um admin - use o login de sempre.'
} else {
  Write-Host ' Login inicial:'
  Write-Host '   usuario: admin'
  Write-Host "   senha:   $(if ($adminPass) { $adminPass } else { 'veja SEED_ADMIN_PASSWORD no .env' })"
  Write-Host '   (troque a senha no menu de perfil apos o primeiro login)'
}
Verde '============================================'
