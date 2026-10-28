# Deploy runbook

One VM in Russia runs everything with `infra/compose.yaml`: Caddy (static site + automatic HTTPS), the API, Postgres. Personal data stays in Russian infrastructure (152-ФЗ), so the VM must be with a Russian provider in a Russian region.

## 1. What you need

| | |
|---|---|
| VM | Ubuntu 24.04, 2 vCPU, 2–4 GB RAM, 30 GB SSD, public IPv4. Yandex Cloud, Selectel or Timeweb Cloud, Russian region. ≈ 1 000–1 500 ₽/month. |
| Domain | Any `.ru` registrar. An `A` record for the domain → the VM's IP. |
| Mail | A mailbox on the domain for login codes (Yandex 360: SMTP `smtp.yandex.ru:465`, app password). Without it sign-in codes only appear in the API log. |
| Tutor model | Production: vLLM (GPU host) and/or DeepSeek key. **Never** Google AI Studio's free tier with real students. Without any model the tutor answers «Репетитор сейчас недоступен»; everything else works. |

## 2. One-time server setup

As root on the new VM:

```bash
apt-get update && apt-get -y upgrade
curl -fsSL https://get.docker.com | sh            # Docker Engine + compose plugin
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy: /home/deploy/.ssh
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
mkdir -p /opt/physics-platform /var/backups/physics-platform && chown deploy: /opt/physics-platform /var/backups/physics-platform
```

As `deploy`: give the server read access to the repository (a GitHub *deploy key*: `ssh-keygen -t ed25519`, add the public key under repo Settings → Deploy keys, read-only), then:

```bash
git clone git@github.com:gkami1/physics-platform.git /opt/physics-platform
cd /opt/physics-platform
cp infra/.env.example infra/.env
nano infra/.env      # SITE_ADDRESS=your-domain.ru, a long random POSTGRES_PASSWORD, SMTP, LLM_*
chmod 600 infra/.env
```

`POSTGRES_PASSWORD` is used when the database volume is first created; changing it later needs `ALTER USER` inside Postgres.

## 3. Deploy

From your machine (SSH access as `deploy`):

```bash
infra/deploy.sh deploy@your-domain.ru          # origin/main
infra/deploy.sh deploy@your-domain.ru feat/x   # a branch, tag or commit
```

It checks out the ref, rebuilds the images on the server, starts the stack (the API migrates the database on start), and waits for `https://<domain>/api/health`. The first start takes a minute longer while Caddy gets the certificate; DNS must already point at the VM.

Rollback = deploy the previous commit. Migrations are written to be backward compatible within a release; check before rolling back across a migration.

## 4. Backups

```bash
crontab -e   # as deploy
30 3 * * * /opt/physics-platform/infra/backup.sh >> /var/backups/physics-platform/backup.log 2>&1
```

Nightly `pg_dump`, gzip, 14 days kept in `/var/backups/physics-platform`. Copy them off the VM too (the provider's object storage, e.g. Yandex Object Storage with `rclone`); a backup on the same disk does not survive losing the VM.

Restore (replaces the database; the API is stopped meanwhile):

```bash
infra/backup.sh --restore /var/backups/physics-platform/physics-YYYYMMDDTHHMMSSZ.sql.gz
```

Tested 2026-10-28 on a local stack: dump → wipe → restore brought users, attempts and variant runs back. Repeat the drill on the server after the first deploy (M8).

## 5. Day to day

```bash
cd /opt/physics-platform
docker compose -f infra/compose.yaml ps
docker compose -f infra/compose.yaml logs -f api        # JSON logs; login codes if no SMTP
docker compose -f infra/compose.yaml exec db psql -U physics
```

## 6. Before real students

- Legal pages, consent texts, Roskomnadzor notification (M7).
- SMTP configured, so codes are emailed instead of logged.
- A production tutor model (vLLM / DeepSeek), not the dev free tier.
- Backups copied off the VM; restore drill done on the server.
