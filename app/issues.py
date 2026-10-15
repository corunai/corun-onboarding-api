"""Rule-based issue detector over a carrier profile."""
from datetime import date
from .util import parse_date, months_between

OOS_MULTIPLIER = 1.25  # flag when carrier OOS rate exceeds national avg by 25%+
MIN_INSPECTIONS = 3


def detect(profile: dict, today: date | None = None, renewal_window_days: int = 90) -> list[dict]:
    today = today or date.today()
    out = []
    add = lambda code, sev, title, detail, estimated=False: out.append(
        {"code": code, "severity": sev, "title": title, "detail": detail, "estimated": estimated})

    if profile["identity"]["usdot_status"] != "ACTIVE":
        add("usdot_inactive", "high", "USDOT number not active", f"Status: {profile['identity']['usdot_status']}")

    m = parse_date(profile["mcs150"]["date"])
    if not m:
        add("mcs150_missing", "medium", "No MCS-150 date on file", "Biennial update may be required.")
    elif months_between(m, today) > 24:
        add("mcs150_overdue", "medium", "MCS-150 update overdue",
            f"Last MCS-150 {m.isoformat()} ({months_between(m, today):.0f} months ago; biennial update required).")

    auth = profile["authority"]
    if auth["has_operating_authority"]:
        if not auth["any_active"]:
            add("authority_inactive", "high", "No active operating authority",
                "; ".join(f"{r['docket']} {r['type']}: {r['status']}" for r in auth["records"]))
        if not profile["boc3"]["on_file"]:
            add("boc3_missing", "high", "No BOC-3 process agent on file", "Required for operating authority.")
        if not profile["insurance"]["active_or_pending"]:
            add("insurance_missing", "high", "No active/pending insurance filing on file",
                "Carrier has operating authority but no insurance filing in FMCSA Motus Insur.")
    for c in profile["insurance"]["recent_cancellations_12mo"]:
        add("insurance_cancelled", "medium", "Insurance filing cancelled in last 12 months",
            f"{c['insurer']} policy {c['policy_no']} cancel effective {c['cancel_effective_date']} ({c['reason']})")

    for r in profile["revocations"]:
        d = parse_date(r.get("served") or r.get("effective"))
        if d and months_between(d, today) <= 24:
            add("revocation", "high", "Revocation/suspension order in last 24 months",
                f"{r['docket']} {r['authority_type']}: {r['order']} (served {r['served']}, effective {r['effective']})")

    insp = profile["inspections_24mo"]
    for kind in ("vehicle", "driver"):
        b = insp[kind]
        if b["inspections"] >= MIN_INSPECTIONS and b["oos_rate"] is not None and b["oos_rate"] > OOS_MULTIPLIER * b["national_avg"]:
            add(f"high_{kind}_oos", "medium", f"{kind.title()} OOS rate well above national average",
                f"{b['oos_rate']}% vs national {b['national_avg']}% ({b['oos']}/{b['inspections']} inspections, 24 mo)")

    for p in profile["insurance"]["active_or_pending"]:
        r = p.get("estimated_renewal")
        if r and r["days_until"] <= renewal_window_days:
            add("renewal_estimated", "high" if r["days_until"] <= 30 else "medium",
                f"Estimated renewal in {r['days_until']} days",
                f"{p['insurer']} {p['form']} policy {p['policy_no']}: effective {p['effective_date']} -> estimated renewal {r['date']} "
                "(ESTIMATE: assumes 12-month term; FMCSA does not publish expiration dates)", estimated=True)
    return out
