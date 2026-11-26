#!/usr/bin/env python3
"""PAdES-Siegel mit RFC-3161-Zeitstempel (E-10).

Liest ein PDF von stdin, schreibt das versiegelte PDF nach stdout und Metadaten (JSON) nach stderr (letzte Zeile).

Konfiguration über Umgebungsvariablen:
  SEAL_P12_PATH, SEAL_P12_PASSWORD   Siegelzertifikat (PKCS#12)
  TSA_URL                            Zeitstempeldienst (RFC 3161); leer → interner Test-TSA
  SEAL_DEV_TSA_KEY, SEAL_DEV_TSA_CERT  Schlüssel/Zertifikat des internen Test-TSA (PEM), nur ohne TSA_URL
  SEAL_REASON, SEAL_LOCATION
"""
import io
import json
import os
import sys

from pyhanko.keys import load_cert_from_pemder, load_private_key_from_pemder
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import fields, signers, timestamps
from pyhanko.sign.timestamps.dummy_client import DummyTimeStamper


def main() -> None:
    p12 = os.environ["SEAL_P12_PATH"]
    pw = os.environ.get("SEAL_P12_PASSWORD", "").encode() or None
    signer = signers.SimpleSigner.load_pkcs12(p12, passphrase=pw)
    if signer is None:
        raise SystemExit("Siegelzertifikat konnte nicht geladen werden")

    tsa_url = os.environ.get("TSA_URL", "").strip()
    if tsa_url:
        stamper = timestamps.HTTPTimeStamper(tsa_url)
        tsa_label = tsa_url
    else:
        tsa_cert = load_cert_from_pemder(os.environ["SEAL_DEV_TSA_CERT"])
        stamper = DummyTimeStamper(
            tsa_cert=tsa_cert,
            tsa_key=load_private_key_from_pemder(os.environ["SEAL_DEV_TSA_KEY"], passphrase=None),
            certs_to_embed=[tsa_cert],
        )
        tsa_label = "interner Test-TSA (nicht qualifiziert)"

    meta = signers.PdfSignatureMetadata(
        field_name="Siegel",
        reason=os.environ.get("SEAL_REASON", "Nachweis Unterweisung"),
        location=os.environ.get("SEAL_LOCATION", "Schulungsnachweis"),
        subfilter=fields.SigSeedSubFilter.PADES,
        md_algorithm="sha256",
    )
    writer = IncrementalPdfFileWriter(io.BytesIO(sys.stdin.buffer.read()))
    out = signers.PdfSigner(meta, signer=signer, timestamper=stamper).sign_pdf(writer)
    sys.stdout.buffer.write(out.getbuffer())
    sys.stdout.flush()
    subject = signer.signing_cert.subject.human_friendly
    sys.stderr.write(json.dumps({"level": "PAdES-B-T", "signer": subject, "tsa": tsa_label}) + "\n")


if __name__ == "__main__":
    main()
