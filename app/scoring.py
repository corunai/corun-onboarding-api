"""Fleet Health Score v0 (DRAFT). Transparent, public-data-only. See README for the formula."""
from datetime import date
from .util import parse_date, months_between

VERSION = "v0-draft"
MIN_INSPECTIONS = 3


def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def _oos_factor(name, block, max_pts):
    n, rate, nat = block["inspections"], block["oos_rate"], block["national_avg"]
    if n < MIN_INSPECTIONS or rate is None:
        return {"factor": name, "points": max_pts / 2, "max": max_pts,
                "detail": f"insufficient data ({n} inspections < {MIN_INSPECTIONS}); neutral half credit"}
    pts = max_pts * _clamp(1 - rate / (2 * nat))
    return {"factor": name, "points": round(pts, 1), "max": max_pts,
            "detail": f"OOS {rate}% vs national {nat}% (full credit at 0%, half at national avg, zero at 2x)"}


def fleet_health(profile: dict, today: date | None = None) -> dict:
    today = today or date.today()
    f = []
    insp = profile["inspections_24mo"]
    f.append(_oos_factor("vehicle_oos", insp["vehicle"], 25))
    f.append(_oos_factor("driver_oos", insp["driver"], 20))

    units = max(profile["fleet"]["power_units"], 1)
    cr = profile["crashes_24mo"]
    per10 = 10 * cr["total"] / units
    pts = 20 * _clamp(1 - per10 / 2) - (5 if cr["fatal"] else 0)
    f.append({"factor": "crashes", "points": round(max(pts, 0), 1), "max": 20,
              "detail": f"{cr['total']} crashes / {units} power units in 24 mo = {per10:.2f} per 10 units "
                        f"(full credit at 0, zero at 2 per 10 units); -5 if any fatal ({cr['fatal']})"})

    comp, notes = 0, []
    auth = profile["authority"]
    if not auth["has_operating_authority"] or auth["any_active"]:
        comp += 8; notes.append("authority active or not required (+8)")
    else:
        notes.append("operating authority not active (+0/8)")
    if not auth["has_operating_authority"] or profile["insurance"]["active_or_pending"]:
        comp += 6; notes.append("insurance on file or not required (+6)")
    else:
        notes.append("no insurance on file (+0/6)")
    if not auth["has_operating_authority"] or profile["boc3"]["on_file"]:
        comp += 3; notes.append("BOC-3 on file or not required (+3)")
    else:
        notes.append("no BOC-3 (+0/3)")
    m = parse_date(profile["mcs150"]["date"])
    if m and months_between(m, today) <= 24:
        comp += 3; notes.append("MCS-150 updated within 24 mo (+3)")
    else:
        notes.append("MCS-150 older than 24 mo or missing (+0/3)")
    f.append({"factor": "compliance", "points": comp, "max": 20, "detail": "; ".join(notes)})

    recent = [r for r in profile["revocations"]
              if (d := parse_date(r.get("served") or r.get("effective"))) and months_between(d, today) <= 24]
    status_ok = profile["identity"]["usdot_status"] == "ACTIVE"
    pts = (15 if not recent else 0) if status_ok else 0
    f.append({"factor": "standing", "points": pts, "max": 15,
              "detail": f"USDOT status {profile['identity']['usdot_status']}; {len(recent)} revocation/suspension orders in 24 mo"})

    score = round(sum(x["points"] for x in f))
    return {"score": score, "max": 100, "version": VERSION, "factors": f,
            "disclaimer": "Draft composite from public FMCSA data. Not an FMCSA rating; not underwriting advice."}
