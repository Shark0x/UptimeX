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

# ---- 2. .env com senhas geradas ----
if (-not (Test-Path '.env')) {
  function Gerar($n) { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }
  $mysqlPass = Gerar 24
  $jwt = Gerar 48
  (Get-Content '.env.docker.example') `
    -replace '^MYSQL_ROOT_PASSWORD=.*', "MYSQL_ROOT_PASSWORD=$mysqlPass" `
    -replace '^JWT_SECRET=.*', "JWT_SECRET=$jwt" |
    Out-File -Encoding ascii '.env'
  Verde ".env criado com senhas aleatorias (MYSQL_ROOT_PASSWORD e JWT_SECRET)."
  Write-Host "   Quer alertas no Telegram? Edite o .env depois e rode: docker compose restart backend"
} else {
  Write-Host ".env ja existe - mantendo o atual."
}

# ---- 3. build + subir ----
Verde "Construindo e subindo os containers (a primeira vez demora alguns minutos)..."
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Falha "docker compose up falhou - veja as mensagens acima." }

# ---- 4. aguardar o backend (que tambem cria/migra o banco) ----
Write-Host 'Aguardando backend e banco' -NoNewline
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  $logs = docker compose logs backend 2>$null | Out-String
  if ($logs -match 'rodando na porta 4000') { $ok = $true; break }
  Write-Host '.' -NoNewline
  Start-Sleep -Seconds 2
}
Write-Host ''
if (-not $ok) { Falha "Backend nao subiu em 120s. Investigue com: docker compose logs backend" }
Verde "Backend no ar - banco criado e migrado."

# ---- 5. restaurar dados trazidos de casa (opcional) ----
if (Test-Path 'backup-netmonitor.sql') {
  $resp = Read-Host 'Restaurar os dados do backup-netmonitor.sql (empresas, dispositivos, usuarios)? [S/n]'
  if ($resp -notin @('n', 'N')) {
    cmd /c 'docker compose exec -T mysql sh -c "mysql -uroot -p\"$MYSQL_ROOT_PASSWORD\" netmonitor" < backup-netmonitor.sql'
    if ($LASTEXITCODE -ne 0) { Falha "Restauracao falhou - veja as mensagens acima." }
    docker compose restart backend *> $null
    Verde "Dados restaurados! Use os mesmos logins de casa."
    if ((Test-Path 'backend/uploads') -and (Get-ChildItem 'backend/uploads' -Recurse -File -ErrorAction SilentlyContinue)) {
      docker compose cp backend/uploads/. backend:/app/uploads/ *> $null
      Verde "Fotos das empresas copiadas."
    }
  } else {
    Write-Host 'Backup ignorado - banco comeca vazio.'
  }
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
$logsAdmin = docker compose logs backend 2>$null | Out-String
if ($logsAdmin -match 'CONTA ADMIN') {
  Write-Host ' Senha inicial do admin (anote, aparece so uma vez):'
  ($logsAdmin -split "`n") | Select-String -Context 1, 3 'CONTA ADMIN' | ForEach-Object { $_.Line; $_.Context.PostContext }
}
Verde '============================================'
