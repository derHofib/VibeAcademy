#!/usr/bin/env bash
# Richtet das Siegel-Werkzeug für die Entwicklung ein (E-10):
#  - Python-venv mit pyHanko unter .local/seal-venv
#  - Dev-CA, Siegelzertifikat (PKCS#12) und Test-TSA-Zertifikat unter .local/certs
# NICHT für den Betrieb: dort ein echtes Siegelzertifikat und einen TSA konfigurieren.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/.local/seal-venv"
CERTS="$ROOT/.local/certs"
mkdir -p "$CERTS"

if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q "pyhanko==0.29.*" "pyhanko-certvalidator"
fi

if [ ! -f "$CERTS/seal.p12" ]; then
  cd "$CERTS"
  openssl req -x509 -newkey rsa:3072 -nodes -keyout ca.key -out ca.pem -days 3650 -sha256 \
    -subj "/C=DE/O=Schulungsnachweis Dev/CN=Schulungsnachweis Dev-CA" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  openssl req -newkey rsa:3072 -nodes -keyout seal.key -out seal.csr -sha256 \
    -subj "/C=DE/O=Schulungsnachweis Dev/CN=Schulungsnachweis Siegel (Entwicklung)" 2>/dev/null
  printf "basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,nonRepudiation\n" > seal.ext
  openssl x509 -req -in seal.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out seal.pem -days 1825 -sha256 -extfile seal.ext 2>/dev/null
  openssl pkcs12 -export -inkey seal.key -in seal.pem -certfile ca.pem -out seal.p12 -passout pass:dev-seal 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -keyout tsa.key -out tsa.csr -sha256 \
    -subj "/C=DE/O=Schulungsnachweis Dev/CN=Schulungsnachweis Test-TSA" 2>/dev/null
  printf "basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,timeStamping\n" > tsa.ext
  openssl x509 -req -in tsa.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out tsa.pem -days 1825 -sha256 -extfile tsa.ext 2>/dev/null
  rm -f ./*.csr ./*.ext
fi
echo "SEAL_PYTHON=$VENV/bin/python"
echo "SEAL_P12_PATH=$CERTS/seal.p12"
echo "SEAL_P12_PASSWORD=dev-seal"
echo "SEAL_DEV_TSA_KEY=$CERTS/tsa.key"
echo "SEAL_DEV_TSA_CERT=$CERTS/tsa.pem"
echo "SEAL_TRUST_ROOT=$CERTS/ca.pem"
