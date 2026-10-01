import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture(autouse=True)
def isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("PIPELINE_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("PIPELINE_SECRETS", "file")
    import pipeline_server.secrets_store as ss
    ss._private = None
    yield tmp_path
