"""Offline checks for the onboarding pages. No FMCSA calls."""
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
ROOT = Path(__file__).resolve().parents[1]


def test_landing_and_flows_render():
    home = client.get("/")
    assert home.status_code == 200
    assert "I'm a carrier" in home.text
    assert "I'm an insurance agent" in home.text
    assert 'href="/onboarding"' in home.text
    assert 'href="/agency/onboarding"' in home.text

    carrier = client.get("/onboarding")
    assert carrier.status_code == 200
    assert "Account &amp; company" in carrier.text or "Account & company" in carrier.text
    assert "FMCSA carrier check" in carrier.text
    assert "You're live" in carrier.text

    agency = client.get("/agency/onboarding")
    assert agency.status_code == 200
    assert "Book risk dashboard" in agency.text
    assert "Renewal radar" in agency.text
    assert "Prospect finder" in agency.text

    demo = client.get("/demo")
    assert demo.status_code == 200
    assert "Onboarding demo" in demo.text
    logo = client.get("/static/logo.png")
    assert logo.status_code == 200
    assert logo.headers["content-type"].startswith("image/")


def test_copy_stays_inside_the_playbook():
    carrier = (ROOT / "app/static/onboarding.js").read_text()
    agency = (ROOT / "app/static/agency.js").read_text()
    ui = (ROOT / "app/static/ui.js").read_text()
    blob = carrier + agency + ui
    assert "Coming soon" in carrier
    assert "Green Miles" in carrier and "Green Miles" in agency
    assert "Demo mode" in ui
    assert "ESTIMATE" in agency
    for banned in ("Iris", "Scout", "Finn", "$2,900", "customers"):
        assert banned not in blob
    assert client.get("/health").json()["ok"] is True
