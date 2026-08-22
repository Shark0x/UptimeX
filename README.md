# uptimeX

Secure, real-time network operations platform for multi-company ICMP and SNMP monitoring.

uptimeX combines availability monitoring, latency and packet-loss history, interactive topology maps, Telegram alerts, audit trails, and tenant-aware access control in a single web interface. The production stack runs with Docker Compose, PostgreSQL 17, Node.js, React, and an unprivileged Nginx frontend.

## Highlights

- ICMP and SNMP monitoring with online, degraded, offline, and unknown states.
- Live dashboards and Socket.IO updates without manual refreshes.
- Multi-company isolation enforced in PostgreSQL with Row-Level Security (RLS).
- Per-company topology maps, dedicated links, and wireless antenna views.
- Time-series retention with raw, hourly, and daily rollups.
- Incident history, availability data, and operational audit logs.
- Telegram outage, recovery, and scheduled summary notifications.
- Role-based access for administrators, operators, and viewers.
- HttpOnly sessions, CSRF protection, login rate limits, encrypted SNMP secrets, and session revocation.
- Docker hardening with internal-only database access, dropped capabilities, read-only filesystems, and persistent volumes.
- Transactional migration path from legacy MySQL installations.

## Recommended installation: automatic Docker setup

Requirements:

- Git
- Docker Engine with the Docker Compose plugin on Linux, or Docker Desktop on Windows
- A host capable of reaching the monitored targets over ICMP and the allowed SNMP ports

### Linux

```bash
git clone https://github.com/Shark0x/UptimeX.git
cd UptimeX
bash instalar.sh
```

### Windows PowerShell

```powershell
git clone https://github.com/Shark0x/UptimeX.git
cd UptimeX
powershell -ExecutionPolicy Bypass -File .\instalar.ps1
```

The installer:

1. Verifies Docker and Docker Compose.
2. Creates a local `.env` with unique random database passwords, an encryption key, and a strong initial administrator password.
3. Builds and starts PostgreSQL, the backend, and the frontend.
4. Waits for the database and API to become healthy.
5. Prints the local access URL and the one-time initial administrator credentials.

The generated `.env` is excluded from Git. Store it securely and rotate the initial administrator password after the first login.

Open `http://HOST_IP:8080` by default. Change `APP_PORT` in `.env` before starting the stack if another host port is required.

## Manual Docker installation

```bash
git clone https://github.com/Shark0x/UptimeX.git
cd UptimeX
cp .env.docker.example .env
```

Replace every placeholder in `.env` with a unique secret. A convenient option on Linux is:

```bash
openssl rand -base64 48
```

Then start and verify the stack:

```bash
docker compose up -d --build --wait
docker compose ps
docker compose logs -f backend
```

Do not commit `.env`, database dumps, exported uploads, private keys, or production logs. The repository already ignores the standard local filenames for these artifacts.

## Updating an installation

Back up the database before a production update, pull only fast-forward changes, rebuild, and verify health:

```bash
docker compose exec -T postgres \
  pg_dump -U uptimex_owner -d uptimex > backup-uptimex.sql
git pull --ff-only
docker compose up -d --build --wait
docker compose ps
```

Persistent data remains in the `postgres_data` and `uploads_data` Docker volumes. Avoid `docker compose down -v` unless permanent data deletion is explicitly intended.

## Migrating from legacy MySQL

MySQL is not used by the normal runtime. It is available only through the `migration` profile. The migrator reads the legacy database and imports it into PostgreSQL in one transaction without modifying the MySQL source.

```bash
docker compose --profile migration up -d mysql
# Restore the legacy dump into the migration-only MySQL container.
docker compose --profile migration run --build --rm postgres-migrator
docker compose --profile migration stop mysql
docker compose restart backend
```

Always validate the migration in a separate stack first. See [DEPLOY.md](DEPLOY.md), [postgres/README.md](postgres/README.md), and [the migration validation runbook](docs/RUNBOOK-VALIDACAO-MIGRACAO.md).

## Architecture

```text
Browser :8080
   |
   v
Unprivileged Nginx frontend
   |-- /api ------> Node.js / Express API
   |-- /socket.io -> Socket.IO
                        |
                        v
                  PostgreSQL 17
                  owner / app / worker roles + RLS
```

Only the frontend port is published by default. PostgreSQL and the backend remain on the internal Compose network. Uploaded company images and user avatars are served through authenticated API routes.

## Common operations

| Task | Command |
|---|---|
| Check status | `docker compose ps` |
| Follow backend logs | `docker compose logs -f backend` |
| Restart services | `docker compose restart` |
| Stop without deleting data | `docker compose down` |
| Rebuild after an update | `docker compose up -d --build --wait` |
| Run backend tests | `npm test --prefix backend` |
| Build the frontend | `npm run build --prefix frontend` |

## Security notes

- Put the application behind HTTPS before exposing it to the public internet and set `COOKIE_SECURE=true`.
- Restrict the published application port with a firewall or trusted reverse proxy.
- Keep `MONITOR_ALLOWED_CIDRS` as narrow as possible. Private and special-use targets are denied unless explicitly allowed.
- Allow only the SNMP ports required by your environment through `SNMP_ALLOWED_PORTS`.
- Use separate, randomly generated PostgreSQL owner, API, and worker passwords.
- Keep `DATA_ENCRYPTION_KEY` stable and secret; changing or losing it can make encrypted operational credentials unreadable.
- Back up both PostgreSQL and the uploads volume, and test restoration regularly.
- Never post production `.env` files, dumps, screenshots containing credentials, or access tokens in issues.

See [docs/SECURITY-HARDENING.md](docs/SECURITY-HARDENING.md) for the applied controls and production checklist.

## Project layout

```text
backend/             TypeScript, Express, Socket.IO, monitoring engines
frontend/            React, Vite, Tailwind CSS, Nginx configuration
postgres/init/       PostgreSQL schema, roles, functions, and RLS policies
postgres/migration/  Transactional MySQL-to-PostgreSQL migrator
docs/                Security, tenancy, and deployment runbooks
instalar.sh          Automatic Linux installer
instalar.ps1         Automatic Windows installer
docker-compose.yml   Production-oriented container stack
```

## License

No open-source license has been declared yet. All rights remain with the repository owner unless a license file is added.
