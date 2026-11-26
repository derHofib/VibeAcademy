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

## Betrieb mit Docker Compose

```bash
cp .env.example .env   # alle Passwörter/Secrets setzen, SITE_ADDRESS = Domain
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
```

- **Siegel und Zeitstempel sind optional und standardmäßig aus** (`SEAL_MODE=none`, E-45). Nachweise werden unveränderbar gespeichert (Object Lock), Echtheit über QR-Code/Prüfcode und SHA-256 (`/verify/:code`).
  Zum Einschalten: `SEAL_MODE=pyhanko`, Zertifikat (PKCS#12) per Volume einbinden und `SEAL_P12_PATH`/`SEAL_P12_PASSWORD` setzen, optional `TSA_URL` (RFC 3161).
- **Mail**: `MAIL_PROVIDER=smtp` und `SMTP_URL` setzen, sobald ein Anbieter feststeht (E-12).
- **Objektspeicher**: MinIO mit Object Lock (Bucket `sn-evidence`, Compliance-Modus, 3 Jahre Standardfrist).
- **Backups**: täglich verschlüsselt (Postgres-Dump + MinIO-Replikation) – Betriebsaufgabe, nicht Teil der Anwendung.
- **Rate-Limits**: in der API (Login, Registrierung, OTP, Links, Prüfseite). Caddy terminiert TLS.
