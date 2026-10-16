import pytest


@pytest.fixture(autouse=True)
def hub_home(tmp_path, monkeypatch):
    monkeypatch.setenv("AIHUB_HOME", str(tmp_path))
    monkeypatch.setenv("AIHUB_SECRETS", "file")
    return tmp_path
