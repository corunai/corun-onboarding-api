"""Offline tests with a fake Socrata client (no network)."""
from datetime import date
import pytest
from app.fmcsa import FMCSAService
from app.scoring import fleet_health
from app.issues import detect
from app.util import parse_identifier, parse_date

TODAY = date(2026, 10, 14)


class FakeSocrata:
    def __init__(self, data):
        self.data = data
        self.cache = None

    def query(self, dataset, params):
        return self.data.get(dataset, [])


class NoQC:
    enabled = False


def base_data(**over):
    d = {
        "census": [{"dot_number": "123", "legal_name": "TEST CARRIER LLC", "status_code": "A", "power_units": "10",
                    "total_drivers": "12", "mcs150_date": "20250101", "crgo_genfreight": "X", "docket1prefix": "MC",
                    "docket1": "999", "docket1_status_code": "A"}],
        "authority": [{"docket_number": "MC999", "usdot_number": "123", "op_auth_type": "Motor Carrier of Property",
                       "op_auth_status": "Active", "min_cov_amount": "750000"}],
        "insurance": [{"usdot_number": "123", "insurance_company_name": "SAMPLE INS CO", "policy_no": "P1",
                       "ins_form_code": "BMC-91X", "max_cov_amount": "1000000", "effective_date": "20251101"}] * 2,
        "insurance_history": [],
        "boc3": [{"usdot_number": "123", "co_name": "AGENT INC", "state_code": "TX"}],
        "revocations": [],
        "inspections": [{"inspection_id": str(i), "insp_level_id": "1", "vehicle_oos_total": "1" if i < 2 else "0",
                         "driver_oos_total": "0"} for i in range(10)],
        "crashes": [],
    }
    d.update(over)
    return d


def svc(**over):
    return FMCSAService(socrata=FakeSocrata(base_data(**over)), qc=NoQC(), today=TODAY)


def test_profile_basics_and_dedupe():
    p = svc().profile("123")
    assert p["identity"]["legal_name"] == "TEST CARRIER LLC"
    assert len(p["insurance"]["active_or_pending"]) == 1  # duplicate rows collapsed
    assert p["inspections_24mo"]["vehicle"] == {"inspections": 10, "oos": 2, "oos_rate": 20.0, "national_avg": 22.26}
    assert p["fleet"]["cargo_carried"] == ["genfreight"]


def test_estimated_renewal_labeled():
    r = svc().profile("123")["insurance"]["active_or_pending"][0]["estimated_renewal"]
    assert r == {"date": "2026-11-01", "days_until": 18, "estimated": True,
                 "method": "next anniversary of FMCSA filing effective date (assumes 12-month policy term)"}


def test_score_clean_carrier_in_range():
    p = svc().profile("123")
    s = fleet_health(p, TODAY)
    assert 0 <= s["score"] <= 100 and s["version"] == "v0-draft"
    assert sum(f["max"] for f in s["factors"]) == 100
    assert next(f for f in s["factors"] if f["factor"] == "compliance")["points"] == 20


def test_issues_detected():
    p = svc(boc3=[], insurance=[], census=[{**base_data()["census"][0], "mcs150_date": "20230101"}],
            revocations=[{"docket_number": "MC999", "op_auth_type": "Common", "order1_type_desc": "REVOKED",
                          "order1_serve_date": "20260301"}]).profile("123")
    codes = {i["code"] for i in detect(p, TODAY)}
    assert {"boc3_missing", "insurance_missing", "mcs150_overdue", "revocation"} <= codes
    assert fleet_health(p, TODAY)["score"] < fleet_health(svc().profile("123"), TODAY)["score"]


def test_high_oos_flag_and_renewal_issue():
    insp = [{"inspection_id": str(i), "insp_level_id": "1", "vehicle_oos_total": "1" if i < 5 else "0",
             "driver_oos_total": "0"} for i in range(10)]
    issues = detect(svc(inspections=insp).profile("123"), TODAY)
    codes = {i["code"]: i for i in issues}
    assert "high_vehicle_oos" in codes
    assert codes["renewal_estimated"]["estimated"] is True


def test_insufficient_inspections_neutral():
    s = fleet_health(svc(inspections=[]).profile("123"), TODAY)
    v = next(f for f in s["factors"] if f["factor"] == "vehicle_oos")
    assert v["points"] == 12.5 and "insufficient" in v["detail"]


@pytest.mark.parametrize("raw,exp", [("44110", ("dot", "44110")), ("USDOT 44110", ("dot", "44110")),
                                     ("MC-1515", ("mc", "1515")), ("mc001515", ("mc", "1515")), ("abc", (None, None))])
def test_parse_identifier(raw, exp):
    assert parse_identifier(raw) == exp


def test_parse_date_formats():
    assert parse_date("20261031") == date(2026, 10, 31)
    assert parse_date("10/31/2026") == date(2026, 10, 31)
    assert parse_date("") is None
