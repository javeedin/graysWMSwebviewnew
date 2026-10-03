import json
import shutil
import subprocess

import pytest

from pipeline_server import secrets_store


def test_roundtrip_and_fingerprint():
    pem = secrets_store.public_key()
    assert pem.startswith("-----BEGIN PUBLIC KEY-----")
    fp = secrets_store.fingerprint()
    assert len(fp.split(":")) == 12
    enc = secrets_store.encrypt_for_test("s3cret pass")
    assert enc.startswith("rsa-oaep-256:")
    assert secrets_store.decrypt(enc) == "s3cret pass"
    assert secrets_store.decrypt("plain") == "plain" and secrets_store.decrypt(None) is None


@pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
def test_password_encrypted_by_the_app_in_webcrypto(tmp_path):
    """The WMS app encrypts in the browser (fusionsql/pipeline-setup.js psEncrypt); this server must read it."""
    pem = secrets_store.public_key()
    js = tmp_path / "enc.mjs"
    js.write_text("""
const pem = process.argv[2];
const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\\s+/g, ''), 'base64');
const key = await crypto.subtle.importKey('spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
const ct = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode('Fusion#2026'));
const fp = Buffer.from(await crypto.subtle.digest('SHA-256', der)).subarray(0, 12).toString('hex').match(/../g).join(':').toUpperCase();
console.log(JSON.stringify({ enc: 'rsa-oaep-256:' + Buffer.from(ct).toString('base64'), fp }));
""")
    out = json.loads(subprocess.check_output(["node", str(js), pem], text=True))
    assert secrets_store.decrypt(out["enc"]) == "Fusion#2026"
    assert out["fp"] == secrets_store.fingerprint()
