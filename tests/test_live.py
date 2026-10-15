"""Live tests against data.transportation.gov. Run with: RUN_LIVE=1 pytest tests/test_live.py"""
import os
import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.skipif(not os.getenv("RUN_LIVE"), reason="set RUN_LIVE=1 for network tests")


@pytest.fixture(scope="module")
def client():
    from app.main import app
    return TestClient(app)


def test_greyhound(client):
    p = client.get("/carriers/44110").json()
    assert p["identity"]["legal_name"] == "GREYHOUND LINES INC"
    assert p["inspections_24mo"]["vehicle"]["inspections"] > 0
    assert 0 <= p["fleet_health"]["score"] <= 100


def test_mc_lookup(client):
    assert client.get("/carriers/mc/1515").json()["dot_number"] == "44110"


def test_book_and_insurers(client):
    b = client.post("/agency/book", json={"identifiers": ["44110", "MC-1515", "notanumber"]}).json()
    assert b["rollup"]["matched"] == 1 and b["duplicates"][0]["dot_number"] == "44110" and b["unmatched"] == ["notanumber"]
    assert b["rollup"]["vehicle_oos_national"] == 22.26 and b["rollup"]["vehicle_oos_n"] >= 1
    s = client.get("/insurers/search", params={"name": "progressive", "limit": 5}).json()
    assert s["count"] > 0
