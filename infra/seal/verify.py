#!/usr/bin/env python3
"""Prüft das Siegel eines PDFs (stdin) gegen eine Vertrauensanker-CA (Argument 1, PEM). Ausgabe: JSON."""
import io
import json
import sys

from pyhanko.keys import load_cert_from_pemder
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext


def main() -> None:
    root = load_cert_from_pemder(sys.argv[1])
    vc = ValidationContext(trust_roots=[root], allow_fetching=False)
    r = PdfFileReader(io.BytesIO(sys.stdin.buffer.read()))
    sigs = r.embedded_signatures
    if not sigs:
        print(json.dumps({"signed": False}))
        return
    st = validate_pdf_signature(sigs[0], vc, ts_validation_context=vc)
    print(json.dumps({
        "signed": True,
        "intact": st.intact,
        "valid": st.valid,
        "trusted": st.trusted,
        "coverage": str(st.coverage),
        "timestamp": st.timestamp_validity.timestamp.isoformat() if st.timestamp_validity else None,
        "signer": st.signing_cert.subject.human_friendly,
    }))


if __name__ == "__main__":
    main()
