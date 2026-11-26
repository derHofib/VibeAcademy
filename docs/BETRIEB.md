# Betrieb – Schulungsnachweis

## Lokale Entwicklung (ohne Docker)

```bash
cp .env.example .env            # SESSION_SECRET / HMAC_MASTER_SECRET setzen (openssl rand -hex 32)
scripts/setup-seal.sh >> .env   # Dev-CA, Siegel- und Test-TSA-Zertifikat, pyHanko-venv
scripts/dev.sh                  # Postgres/Redis lokal, Migrationen, API :3000, Web :5173
node scripts/seed-demo.mjs      # Demo-Daten (Dozent demo@example.org / demo-passwort-1)
```

Mails landen ohne Mailanbieter im Log; in der Entwicklung zeigt `GET /api/dev/postausgang` die letzten Nachrichten,
`/api/dev/mail-vorlagen/<name>` die Vorlagen.

## Betrieb mit Docker Compose

```bash
cp .env.example .env   # alle Passwörter/Secrets setzen, SITE_ADDRESS = Domain
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
```

- **Siegelzertifikat**: PKCS#12-Datei über `SEAL_P12_FILE` (Pfad auf dem Host) als Docker-Secret, Passwort in `SEAL_P12_PASSWORD`.
  Solange kein Firmen-Siegelzertifikat vorliegt, kann eine eigene CA verwendet werden (E-10); Echtheit dann über `/verify/:code`.
- **Zeitstempel**: `TSA_URL` auf einen RFC-3161-Dienst setzen. Ohne Angabe stempelt der interne Test-TSA (im Nachweis gekennzeichnet).
- **Mail**: `MAIL_PROVIDER=smtp` und `SMTP_URL` setzen, sobald ein Anbieter feststeht (E-12).
- **Objektspeicher**: MinIO mit Object Lock (Bucket `sn-evidence`, Compliance-Modus, 3 Jahre Standardfrist).
- **Backups**: täglich verschlüsselt (Postgres-Dump + MinIO-Replikation) – Betriebsaufgabe, nicht Teil der Anwendung.
- **Rate-Limits**: in der API (Login, Registrierung, OTP, Links, Prüfseite). Caddy terminiert TLS.
