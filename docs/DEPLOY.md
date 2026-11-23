# Deploy runbook

One VM in Russia runs everything with `infra/compose.yaml`: Caddy (static site + automatic HTTPS), the API, Postgres. Personal data stays in Russian infrastructure (152-ФЗ), so the VM must be with a Russian provider in a Russian region.

## 1. What you need

| | |
|---|---|
| VM | Ubuntu 24.04, 2 vCPU, 2–4 GB RAM, 30 GB SSD, public IPv4. Yandex Cloud, Selectel or Timeweb Cloud, Russian region. ≈ 1 000–1 500 ₽/month. |
| Domain | Any `.ru` registrar. An `A` record for the domain → the VM's IP. |
| Mail | A mailbox on the domain for login codes (Yandex 360: SMTP `smtp.yandex.ru:465`, app password). Without it sign-in codes only appear in the API log. |
| Tutor model | Production: vLLM (GPU host) and/or DeepSeek key. **Never** a free dev tier (OpenRouter `:free`, Google AI Studio) with real students. Without any model the tutor answers «Репетитор сейчас недоступен»; everything else works. |

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

Once key login works for both `root` and `deploy`, turn off SSH passwords (a file early in `sshd_config.d/` wins over cloud-init's `50-cloud-init.conf`), and reboot if `/var/run/reboot-required` exists:

```bash
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/01-hardening.conf
sshd -t && systemctl reload ssh
```

Email: any Russian SMTP mailbox works (152-ФЗ: the provider sees students' addresses). A free `@mail.ru`/`@yandex.ru` box with an app password is fine to start (`smtp.mail.ru:465`, `MAIL_FROM` = that same address, or it lands in spam); it has daily sending limits, so move to a mailbox on the domain as users grow.

### vLLM on a private network (SSH tunnel)

When the GPU host is only reachable through a jump host, the VPS keeps an SSH tunnel to it. The VPS key may only forward to the vLLM port, so a compromised VPS cannot reach anything else behind the jump host.

On the VPS (root): `ssh-keygen -t ed25519 -N "" -C pp-vps-tunnel -f /root/.ssh/pp_tunnel`; add the jump host's key to `/root/.ssh/known_hosts` after checking its fingerprint.

On the jump host (root), with the public key from above:

```bash
adduser --system --group --shell /usr/sbin/nologin --home /home/pptunnel pptunnel
mkdir -p /home/pptunnel/.ssh
echo 'restrict,port-forwarding,permitopen="<gpu-ip>:8010",command="/bin/false" ssh-ed25519 AAAA... pp-vps-tunnel' > /home/pptunnel/.ssh/authorized_keys
chown -R pptunnel: /home/pptunnel/.ssh && chmod 700 /home/pptunnel/.ssh && chmod 600 /home/pptunnel/.ssh/authorized_keys
cat >> /etc/ssh/sshd_config <<'EOF'

Match User pptunnel
    AllowTcpForwarding local
    PermitOpen <gpu-ip>:8010
    PermitTTY no
    X11Forwarding no
    AllowAgentForwarding no
    ForceCommand /bin/false
EOF
sshd -t && systemctl reload ssh
```

The `Match` block must stay last in `sshd_config`: anything appended after it applies only to `pptunnel`.

On the VPS, `/etc/systemd/system/pp-tunnel.service` (`systemctl enable --now pp-tunnel`), listening only on the docker bridge:

```ini
[Unit]
Description=SSH tunnel to vLLM for the tutor
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
ExecStart=/usr/bin/ssh -N -i /root/.ssh/pp_tunnel -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 172.17.0.1:8010:<gpu-ip>:8010 pptunnel@<jump-host>
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

ufw blocks containers → host by default: `ufw allow in from 172.16.0.0/12 to 172.17.0.1 port 8010 proto tcp`. Then in `infra/.env`: `LLM_BASE_URL=http://host.docker.internal:8010/v1` and `LLM_MODEL=<served model id>` (compose maps `host.docker.internal` to the host). If the tunnel is down the tutor answers «недоступен»; `journalctl -u pp-tunnel` shows why.

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
crontab -e   # as deploy; the server clock is UTC, so 00:30 = 03:30 MSK
30 0 * * * /opt/physics-platform/infra/backup.sh >> /var/backups/physics-platform/backup.log 2>&1
chmod 700 /var/backups/physics-platform   # dumps hold personal data
```

Nightly `pg_dump`, gzip, 14 days kept in `/var/backups/physics-platform` (files are owner-only). Copy them off the VM too (the provider's object storage, e.g. Yandex Object Storage with `rclone`); a backup on the same disk does not survive losing the VM.

Restore (replaces the database; the API is stopped meanwhile):

```bash
infra/backup.sh --restore /var/backups/physics-platform/physics-YYYYMMDDTHHMMSSZ.sql.gz
```

Tested 2026-10-28 on a local stack: dump → wipe → restore brought users, attempts and variant runs back. On the server (2026-11-19) the drill restores the latest dump into a scratch database (`CREATE DATABASE restore_drill`, load, compare per-table row counts with `physics`, drop it), which checks the dump without touching live data. Repeat it after schema changes and once real data exists.

## 5. Day to day

```bash
cd /opt/physics-platform
docker compose -f infra/compose.yaml ps
docker compose -f infra/compose.yaml logs -f api        # JSON logs; login codes if no SMTP
docker compose -f infra/compose.yaml exec db psql -U physics
```

## 6. Robokassa and the legal pages

Passes are one-off payments (no recurring charges). The seller is a самозанятый: Robokassa
registers each receipt in «Мой налог» and emails it to the buyer.

**Shop settings** (Robokassa cabinet → the shop → «Технические настройки»):

| Setting | Value |
|---|---|
| Result URL | `https://<domain>/api/billing/robokassa/result`, method **POST** |
| Success URL | `https://<domain>/pay/success/`, method **GET** (Caddy serves static pages on GET only) |
| Fail URL | `https://<domain>/pay/fail/`, method **GET** |
| Hash algorithm | the same as `ROBOKASSA_HASH` (default MD5) |
| Passwords #1 and #2 | into `ROBOKASSA_PASSWORD1/2`; test and live passwords differ |

Then in `infra/.env`: `ROBOKASSA_LOGIN`, the passwords, `SELLER_NAME`, `SELLER_INN`,
`CONTACT_EMAIL` (the seller block is baked into the static site: rebuild the web image after
changing it). Apply the settings with
`docker compose --env-file infra/.env -f infra/compose.yaml up -d --build`.

**«Мой налог».** Connect Robokassa as a partner in «Мой налог» (Прочее → Партнёры) and turn on
receipts for самозанятые («Робочеки СМЗ») in the Robokassa cabinet. The checkout sends one
`Receipt` item with `payment_object: service` and `tax: none`. Check the line item on the
payment form and verify receipt delivery on the first live payment. See the
[Robokassa fiscalization guide](https://docs.robokassa.ru/ru/fiscalization).

**Test mode.** Use `ROBOKASSA_TEST=true` and the test passwords in a deployment with a separate
database. Test callbacks grant access there so you can check the full flow. Sign in, choose a
pass at `/pricing/`, and complete a test payment. Check that `/pay/success/` confirms that
invoice and shows the access date, and that the tutor shows «из 100». Repeat while the account
already has paid access. The new invoice should show as pending until its own callback arrives.
For the live deployment, set `ROBOKASSA_TEST=false` with the live passwords. See the
[Robokassa guide to notifications and redirects](https://docs.robokassa.ru/ru/notifications-and-redirects).

**Faking the callback locally** (the Result URL must be reachable from the internet, so on a
laptop run the checkout, take `InvId` from the redirect URL and post the callback yourself):

```bash
INV=1; SUM=690.000000; PASS2=<password #2>
SIG=$(printf '%s' "$SUM:$INV:$PASS2" | md5sum | cut -d' ' -f1)
curl -d "OutSum=$SUM&InvId=$INV&SignatureValue=$SIG" http://localhost:8000/api/billing/robokassa/result
# → OK1
```

**Refunds** (offer §5: unused full days, within 10 days). Refund in the Robokassa cabinet,
annul the receipt in «Мой налог», then shorten the access:
`UPDATE entitlements SET valid_until = now() WHERE user_id = …;` (`docker compose exec db psql -U physics`).

**Who paid:** `SELECT id, user_id, plan, amount_kop, status, paid_at FROM payments ORDER BY id DESC LIMIT 20;`
A `pending` row is a checkout that was opened but not paid; it is never charged.

**Legal pages** (`/legal/offer/`, `/legal/privacy/`, `/legal/consent/`) are drafts written
without a lawyer: have them reviewed before the first real payment. When a text changes, bump
`LEGAL_VERSION`/`LEGAL_DATE` in `web/src/lib/seller.ts` and `OFFER_VERSION` in
`api/src/platform_api/payments.py`; payments and sign-ups record the version they accepted.

**Roskomnadzor.** Before collecting personal data from real users, file the operator
notification at pd.rkn.gov.ru (a manual step, no code). Keep its number with these notes.

**Income cap.** Самозанятый income is capped at 2.4 M ₽ a year (ARCHITECTURE §14): watch
`SELECT sum(amount_kop)/100 FROM payments WHERE status = 'paid' AND paid_at >= date_trunc('year', now());`

## 7. Before real students

- Legal pages reviewed by a lawyer, Roskomnadzor notification filed (§6).
- Robokassa in live mode, a real payment and a refund tried end to end (§6).
- SMTP configured, so codes are emailed instead of logged.
- A production tutor model (vLLM / DeepSeek), not the dev free tier.
- Backups copied off the VM; restore drill done on the server.
