# Betrieb – Schulungsnachweis

## Lokale Entwicklung (ohne Docker)

```bash
cp .env.example .env            # SESSION_SECRET / HMAC_MASTER_SECRET setzen (openssl rand -hex 32)
# optional: scripts/setup-seal.sh >> .env und SEAL_MODE=pyhanko (Dev-Siegel zum Ausprobieren)
scripts/dev.sh                  # Postgres/Redis lokal, Migrationen, API :3000, Web :5173
node scripts/seed-demo.mjs      # Demo-Daten (Dozent demo@example.org / demo-passwort-1)
```

Mails landen ohne Mailanbieter im Log; in der Entwicklung zeigt `GET /api/dev/postausgang` die letzten Nachrichten,
`/api/dev/mail-vorlagen/<name>` die Vorlagen.

## Betrieb mit Docker Compose (z. B. Homeserver)

Voraussetzungen: Linux-Rechner oder NAS mit Docker und Docker Compose v2, ca. 4 GB RAM, 20 GB frei. Der Stack besteht aus Postgres, Redis, Gotenberg (PDF), der API und Caddy (Webserver mit HTTPS). Keine Cloud-Dienste nötig.

### 1. Einrichten

```bash
git clone <repo> schulungsnachweis && cd schulungsnachweis
cp .env.example .env
```

In `.env` setzen (Secrets z. B. mit `openssl rand -base64 48` erzeugen):

| Variable | Wert |
| --- | --- |
| `POSTGRES_PASSWORD`, `DB_MIGRATOR_PASSWORD`, `DB_APP_PASSWORD` | je ein eigenes, langes Passwort |
| `SESSION_SECRET`, `HMAC_MASTER_SECRET` | je 48 zufällige Bytes; **nie wieder ändern** (Einladungslinks, verschlüsselte SSO-/Webhook-Geheimnisse hängen daran) |
| `SITE_ADDRESS` | Adresse, unter der die Seite erreichbar ist (siehe Variante A/B) |
| `PUBLIC_BASE_URL` | dieselbe Adresse mit `https://`, steht in Mails und QR-Codes |
| `MAIL_PROVIDER`, `SMTP_URL`, `MAIL_FROM` | `log` (Mails nur im Log) oder `smtp` mit dem Postfach-Anbieter |

Starten:

```bash
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
```

Beim Start laufen die Datenbank-Migrationen automatisch (Dienst `migrate`). Danach im Browser `PUBLIC_BASE_URL` öffnen und „Konto anlegen“ (erster Dozent/Verantwortlicher).

### 2. Erreichbarkeit: Variante A oder B

**HTTPS ist Pflicht**: Ohne HTTPS dürfen Browser die Kamera nicht nutzen (QR-Check-in, Belegfoto) und keine Push-Mitteilungen anzeigen.

- **A – nur im Heimnetz/Firmennetz**: `SITE_ADDRESS=schulung.lan` (oder die IP des Servers), `PUBLIC_BASE_URL=https://schulung.lan`, `CADDY_TLS="tls internal"`.
  Caddy erzeugt eine eigene Zertifizierungsstelle. Deren Stammzertifikat einmal auf den Geräten als vertrauenswürdig installieren, sonst warnt der Browser und die Kamera bleibt gesperrt:
  ```bash
  docker compose -f infra/docker-compose.yml --env-file .env cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
  ```
  Den Namen `schulung.lan` im Router (lokaler DNS) auf die IP des Servers zeigen lassen. Teilnehmer ohne Zugang zum Netz (Mail-Links von unterwegs) erreichen die Seite in dieser Variante nicht.
- **B – aus dem Internet erreichbar**: eigene (Sub-)Domain, z. B. `schulung.meinefirma.de`, per DNS-Eintrag (A/AAAA) oder DynDNS auf die öffentliche IP zeigen lassen; im Router Port 80 und 443 an den Server weiterleiten. `SITE_ADDRESS=schulung.meinefirma.de`, `CADDY_TLS` leer lassen – Caddy holt das Zertifikat (Let’s Encrypt) automatisch.
  Ohne öffentliche IPv4 (DS-Lite/CGNAT) stattdessen einen Tunnel nutzen (z. B. Cloudflare Tunnel oder Tailscale Funnel) und ihn auf Caddy zeigen lassen.

### 3. Updates

```bash
scripts/backup.sh     # vorher sichern
scripts/update.sh     # git pull, neu bauen, starten; Migrationen laufen automatisch
```

### 4. Datensicherung (wichtig – auf dem Homeserver gibt es sonst keine)

`scripts/backup.sh` sichert Datenbank, Rollen und Dateiablage (Nachweis-PDFs, Belege, Schulungs-PDFs), verschlüsselt mit `BACKUP_PASSPHRASE` (AES-256, `openssl`), und löscht Sicherungen älter als `BACKUP_KEEP_DAYS` (Standard 30).

```bash
# in .env: BACKUP_PASSPHRASE=…  BACKUP_DIR=/mnt/usb/schulung-backup
crontab -e
30 3 * * * cd /pfad/zu/schulungsnachweis && scripts/backup.sh >> backups.log 2>&1
```

- **3-2-1-Regel**: mindestens eine Kopie außer Haus (USB-Platte im Wechsel, NAS bei jemand anderem oder per `rclone` in einen Cloud-Speicher – die Dateien sind bereits verschlüsselt).
- Passphrase getrennt aufbewahren (Passwortmanager/Tresor). Ohne sie ist keine Wiederherstellung möglich.
- **Wiederherstellung** (überschreibt alles; Prüfsummen werden vorher kontrolliert):
  ```bash
  scripts/restore.sh /mnt/usb/schulung-backup 2026-11-26_0330
  ```
  Mindestens einmal im Jahr auf einem Testrechner üben.
- Ein Ausfall des Homeservers bedeutet: keine Anmeldung, keine Check-ins, bis er wieder läuft. Nachweise gehen nicht verloren, solange die Sicherung aktuell ist.

### 5. Weitere Einstellungen

- **Dateiablage**: Standard `STORAGE_DRIVER=fs` – Docker-Volume `storage` auf dem Server. Nachweis-PDFs werden nur einmal geschrieben und danach schreibgeschützt (die Anwendung verweigert jedes Überschreiben). Echte Unveränderbarkeit auf Speicherebene (Object Lock) gibt es nur mit `STORAGE_DRIVER=s3` und einem S3-Speicher mit Object Lock (z. B. IONOS) – dann `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` setzen.
- **Siegel und Zeitstempel sind optional und standardmäßig aus** (`SEAL_MODE=none`, E-45). Echtheit über QR-Code/Prüfcode und SHA-256 (`/verify/:code`).
  Zum Einschalten: `SEAL_MODE=pyhanko`, Zertifikat (PKCS#12) per Volume einbinden und `SEAL_P12_PATH`/`SEAL_P12_PASSWORD` setzen, optional `TSA_URL` (RFC 3161).
- **Mail**: `MAIL_PROVIDER=smtp` und `SMTP_URL` setzen, sobald ein Anbieter feststeht (E-12). Zum Ausprobieren: `docker compose … --profile dev up -d mailpit`, Postfach unter Port 8025.
- **Web-Push**: VAPID-Schlüssel erzeugen und in `.env` eintragen (siehe `.env.example`).
- **Rate-Limits**: in der API (Login, Registrierung, OTP, Links, Prüfseite). Caddy terminiert TLS.
- **Logs/Status**: `docker compose -f infra/docker-compose.yml --env-file .env ps` bzw. `… logs -f api`. Gesundheit: `https://<SITE_ADDRESS>/api/health`.
