from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from .fmcsa import FMCSAService
from .scoring import fleet_health
from .issues import detect
from .util import parse_identifier
from . import config

app = FastAPI(title="CoRun Onboarding API", version="0.1.0")
svc = FMCSAService()


def full_profile(dot):
    p = svc.profile(dot)
    if not p:
        return None
    p["fleet_health"] = fleet_health(p, svc.today)
    p["issues"] = detect(p, svc.today)
    return p


@app.get("/health")
def health():
    return {"ok": True, "qcmobile_enabled": svc.qc.enabled, "socrata_token": bool(config.SOCRATA_APP_TOKEN)}


@app.get("/carriers/{dot}")
def carrier(dot: str):
    if not dot.isdigit():
        raise HTTPException(400, "DOT must be numeric; use /carriers/mc/{number} for MC lookups")
    p = full_profile(dot)
    if not p:
        raise HTTPException(404, f"USDOT {dot} not found in FMCSA Company Census")
    return p


@app.get("/carriers/mc/{mc}")
def carrier_by_mc(mc: str):
    kind, num = parse_identifier(mc if not mc.isdigit() else f"MC{mc}")
    dot = svc.dot_for_docket(kind or "mc", num or mc)
    if not dot:
        raise HTTPException(404, f"Docket {mc} not found in FMCSA Motus Carrier")
    return carrier(dot)


class Book(BaseModel):
    identifiers: list[str] = Field(..., description="USDOT numbers or MC-/MX-/FF- docket numbers", max_length=200)
    renewal_window_days: int = 90


def _resolve(ident):
    kind, num = parse_identifier(ident)
    if kind == "dot":
        return num
    if kind:
        return svc.dot_for_docket(kind, num)
    return None


@app.post("/agency/book")
def agency_book(book: Book):
    matched, unmatched, duplicates, seen = [], [], [], set()
    for ident in book.identifiers:
        dot = _resolve(ident)
        if dot and dot in seen:
            duplicates.append({"input": ident, "dot_number": dot})
            continue
        seen.add(dot)
        p = full_profile(dot) if dot else None
        if not p:
            unmatched.append(ident)
            continue
        matched.append({"input": ident, "dot_number": dot, "legal_name": p["identity"]["legal_name"],
                        "power_units": p["fleet"]["power_units"], "drivers": p["fleet"]["total_drivers"],
                        "fleet_health": p["fleet_health"]["score"], "issues": p["issues"],
                        "vehicle_oos_rate": p["inspections_24mo"]["vehicle"]["oos_rate"],
                        "driver_oos_rate": p["inspections_24mo"]["driver"]["oos_rate"]})
    scores = [m["fleet_health"] for m in matched]
    rollup = {
        "carriers_submitted": len(book.identifiers), "matched": len(matched), "unmatched": len(unmatched),
        "total_power_units": sum(m["power_units"] for m in matched),
        "total_drivers": sum(m["drivers"] for m in matched),
        "avg_fleet_health": round(sum(scores) / len(scores), 1) if scores else None,
        "carriers_with_high_issues": sum(1 for m in matched if any(i["severity"] == "high" for i in m["issues"])),
        "health_distribution": {b: sum(1 for s in scores if lo <= s < hi) for b, lo, hi in
                                [("<50", 0, 50), ("50-69", 50, 70), ("70-84", 70, 85), ("85+", 85, 101)]},
    }
    matched.sort(key=lambda m: m["fleet_health"])
    return {"rollup": rollup, "carriers_by_risk": matched, "unmatched": unmatched, "duplicates": duplicates}


@app.post("/agency/renewals")
def renewal_radar(book: Book):
    items = []
    for ident in book.identifiers:
        dot = _resolve(ident)
        p = svc.profile(dot) if dot else None
        if not p:
            continue
        for pol in p["insurance"]["active_or_pending"]:
            r = pol.get("estimated_renewal")
            if r and r["days_until"] <= book.renewal_window_days:
                items.append({"dot_number": dot, "legal_name": p["identity"]["legal_name"], "insurer": pol["insurer"],
                              "policy_no": pol["policy_no"], "form": pol["form"], "max_coverage": pol["max_coverage"],
                              "effective_date": pol["effective_date"], "estimated_renewal": r["date"],
                              "days_until": r["days_until"], "estimated": True})
    items.sort(key=lambda x: x["days_until"])
    buckets = {k: sum(1 for i in items if lo <= i["days_until"] <= hi) for k, lo, hi in
               [("0-30", 0, 30), ("31-60", 31, 60), ("61-90", 61, 90), ("91+", 91, 10**6)]}
    return {"estimated": True, "method": "next anniversary of FMCSA filing effective date (12-month term assumed)",
            "buckets": buckets, "renewals": items}


@app.get("/insurers/search")
def insurer_search(name: str = Query(..., min_length=3), limit: int = Query(100, le=1000)):
    safe = name.upper().replace("'", "''")
    rows = svc.s.query("insurance", {
        "$select": "usdot_number,docket_number,insurance_company_name,ins_form_code,max_cov_amount,effective_date,policy_no",
        "$where": f"upper(insurance_company_name) like '%{safe}%'", "$order": "effective_date DESC", "$limit": limit * 3})
    by_dot, seen = {}, set()
    for r in rows:
        k = (r.get("usdot_number"), r.get("policy_no"), r.get("ins_form_code"), r.get("effective_date"))
        if k in seen:
            continue
        seen.add(k)
        by_dot.setdefault(r["usdot_number"], {"dot_number": r["usdot_number"], "docket": r.get("docket_number"),
                                              "filings": []})["filings"].append(
            {"insurer": r.get("insurance_company_name"), "form": r.get("ins_form_code"), "policy_no": r.get("policy_no"),
             "max_coverage": r.get("max_cov_amount"), "effective_date": r.get("effective_date")})
    carriers = list(by_dot.values())[:limit]
    return {"query": name, "carriers": carriers, "count": len(carriers),
            "source": "FMCSA Motus Insur (active/pending filings)"}


# ---- demo page ----
from pathlib import Path
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

_static = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=_static), name="static")


@app.get("/", include_in_schema=False)
def demo_page():
    return FileResponse(_static / "index.html")
