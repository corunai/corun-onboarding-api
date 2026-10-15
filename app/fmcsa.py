"""Build a unified carrier profile from public FMCSA (Motus) datasets."""
from datetime import date, timedelta
from .clients import SocrataClient, QCMobileClient
from .util import parse_date, iso, to_int, to_float, add_years
from . import config

VEHICLE_LEVELS = {"1", "2", "5", "6"}   # SAFER convention for vehicle inspections
DRIVER_LEVELS = {"1", "2", "3", "6"}    # SAFER convention for driver inspections
CARGO_LABELS = {k: k.replace("crgo_", "") for k in [
    "crgo_genfreight", "crgo_household", "crgo_metalsheet", "crgo_motoveh", "crgo_drivetow", "crgo_logpole",
    "crgo_bldgmat", "crgo_mobilehome", "crgo_machlrg", "crgo_produce", "crgo_liqgas", "crgo_intermodal",
    "crgo_passengers", "crgo_oilfield", "crgo_livestock", "crgo_grainfeed", "crgo_coalcoke", "crgo_meat",
    "crgo_garbage", "crgo_usmail", "crgo_chem", "crgo_drybulk", "crgo_coldfood", "crgo_beverages",
    "crgo_paperprod", "crgo_utility", "crgo_farmsupp", "crgo_construct", "crgo_waterwell", "crgo_cargoothr"]}


class FMCSAService:
    def __init__(self, socrata: SocrataClient | None = None, qc: QCMobileClient | None = None, today=None):
        self.s = socrata or SocrataClient()
        self.qc = qc or QCMobileClient(cache=self.s.cache)
        self._today = today

    @property
    def today(self):
        return self._today or date.today()

    # ---------- lookups ----------
    def dot_for_docket(self, prefix: str, number: str):
        rows = self.s.query("authority", {"docket_number": f"{prefix.upper()}{int(number)}", "$limit": 5})
        return rows[0]["usdot_number"] if rows else None

    def census(self, dot):
        rows = self.s.query("census", {"dot_number": str(dot), "$limit": 1})
        return rows[0] if rows else None

    # ---------- profile ----------
    def profile(self, dot) -> dict | None:
        dot = str(int(dot))
        c = self.census(dot)
        if not c:
            return None
        q = {"usdot_number": dot, "$limit": 500}
        auth = self.s.query("authority", q)
        ins = self.s.query("insurance", q)
        hist = self.s.query("insurance_history", q)
        boc3 = self.s.query("boc3", q)
        revs = self.s.query("revocations", q)
        since = (self.today - timedelta(days=730)).strftime("%Y%m%d")
        insp = self.s.query("inspections", {
            "$select": "inspection_id,insp_date,insp_level_id,vehicle_oos_total,driver_oos_total,hazmat_oos_total,hazmat_placard_req",
            "$where": f"dot_number='{dot}' AND insp_date >= '{since}'", "$limit": 50000})
        crashes = self.s.query("crashes", {
            "$select": "crash_id,report_date,fatalities,injuries,tow_away,report_state",
            "$where": f"dot_number='{dot}' AND report_date >= '{since}'", "$limit": 5000})

        prof = {
            "dot_number": dot,
            "identity": self._identity(c),
            "authority": self._authority(auth),
            "fleet": {
                "power_units": to_int(c.get("power_units")),
                "truck_units": to_int(c.get("truck_units")),
                "bus_units": to_int(c.get("bus_units")),
                "total_drivers": to_int(c.get("total_drivers")),
                "total_cdl_drivers": to_int(c.get("total_cdl")),
                "cargo_carried": [v for k, v in CARGO_LABELS.items() if c.get(k) == "X"],
                "hazmat": c.get("hm_ind") == "Y",
            },
            "mcs150": {
                "date": iso(parse_date(c.get("mcs150_date"))),
                "mileage": to_int(c.get("mcs150_mileage")) or None,
                "mileage_year": c.get("mcs150_mileage_year"),
            },
            "safety_rating": {"rating": c.get("safety_rating") or None,
                              "date": iso(parse_date(c.get("safety_rating_date")))},
            "insurance": self._insurance(ins, hist),
            "boc3": self._boc3(boc3),
            "revocations": self._revocations(revs),
            "inspections_24mo": self._inspections(insp),
            "crashes_24mo": self._crashes(crashes),
            "sources": {k: f"https://data.transportation.gov/d/{v}" for k, v in config.DATASETS.items()},
            "as_of": iso(self.today),
        }
        if self.qc.enabled:
            prof["qcmobile"] = {"carrier": self.qc.carrier(dot), "basics": self.qc.basics(dot)}
        return prof

    def _identity(self, c):
        dockets = []
        for i in (1, 2, 3):
            if c.get(f"docket{i}"):
                dockets.append({"docket": f"{c.get(f'docket{i}prefix', '')}{c[f'docket{i}']}",
                                "status": c.get(f"docket{i}_status_code")})
        return {
            "legal_name": c.get("legal_name"), "dba_name": c.get("dba_name"),
            "usdot_status": {"A": "ACTIVE", "I": "INACTIVE"}.get(c.get("status_code"), c.get("status_code")),
            "carrier_operation": c.get("carrier_operation"), "classification": c.get("classdef"),
            "business_type": c.get("business_org_desc"),
            "physical_address": {k: c.get(f"phy_{k}") for k in ("street", "city", "state", "zip")},
            "phone": c.get("phone"), "email": c.get("email_address"),
            "officers": [o for o in (c.get("company_officer_1"), c.get("company_officer_2")) if o],
            "dockets": dockets, "added": iso(parse_date(c.get("add_date"))),
        }

    def _authority(self, rows):
        out = [{"docket": r.get("docket_number"), "type": r.get("op_auth_type"), "status": r.get("op_auth_status"),
                "bipd_required": to_float(r.get("min_cov_amount")), "bipd_on_file": to_float(r.get("bipd_file")),
                "cargo_required": r.get("cargo_req") == "Y", "cargo_on_file": r.get("cargo_file") == "Y",
                "bond_required": r.get("bond_req") == "Y", "bond_on_file": r.get("bond_file") == "Y"} for r in rows]
        return {"records": out, "any_active": any((r["status"] or "").lower() == "active" for r in out),
                "has_operating_authority": bool(out)}

    def _insurance(self, rows, hist):
        seen, policies = set(), []
        for r in rows:
            key = (r.get("policy_no"), r.get("ins_form_code"), r.get("effective_date"), r.get("insurance_company_name"))
            if key in seen:
                continue
            seen.add(key)
            eff = parse_date(r.get("effective_date"))
            policies.append({
                "insurer": r.get("insurance_company_name"), "policy_no": r.get("policy_no"),
                "form": r.get("ins_form_code"), "type_code": r.get("ins_type_code"), "class_code": r.get("ins_class_code"),
                "max_coverage": to_float(r.get("max_cov_amount")), "underlying_limit": to_float(r.get("underl_lim_amount")),
                "effective_date": iso(eff), "filed_date": iso(parse_date(r.get("trans_date"))),
                "estimated_renewal": self._estimated_renewal(eff),
            })
        cancellations = []
        cutoff = self.today - timedelta(days=365)
        for h in hist:
            cd = parse_date(h.get("cancl_effective_date"))
            if cd and cd >= cutoff:
                cancellations.append({"insurer": h.get("insurance_company_name"), "policy_no": h.get("policy_no"),
                                      "form": h.get("ins_form_code"), "reason": h.get("filing_status_reason"),
                                      "cancel_effective_date": iso(cd)})
        return {"active_or_pending": policies, "recent_cancellations_12mo": cancellations,
                "note": "FMCSA filings have no expiration date; renewal dates are ESTIMATES (effective date + 12-month anniversaries)."}

    def _estimated_renewal(self, eff):
        if not eff:
            return None
        nxt = eff
        while nxt <= self.today:
            nxt = add_years(nxt, 1)
        return {"date": iso(nxt), "days_until": (nxt - self.today).days, "estimated": True,
                "method": "next anniversary of FMCSA filing effective date (assumes 12-month policy term)"}

    def _boc3(self, rows):
        if not rows:
            return {"on_file": False, "agents": []}
        agents = list({(r.get("co_name"), r.get("state_code")) for r in rows})
        return {"on_file": True, "agents": [{"name": n, "state": s} for n, s in agents]}

    def _revocations(self, rows):
        return [{"docket": r.get("docket_number"), "authority_type": r.get("op_auth_type"),
                 "order": r.get("order1_type_desc"), "served": iso(parse_date(r.get("order1_serve_date"))),
                 "effective": iso(parse_date(r.get("order1_effective_date")))} for r in rows]

    def _inspections(self, rows):
        seen = {}
        for r in rows:
            seen[r.get("inspection_id")] = r
        rows = list(seen.values())
        veh = [r for r in rows if r.get("insp_level_id") in VEHICLE_LEVELS]
        drv = [r for r in rows if r.get("insp_level_id") in DRIVER_LEVELS]
        veh_oos = sum(1 for r in veh if to_int(r.get("vehicle_oos_total")) > 0)
        drv_oos = sum(1 for r in drv if to_int(r.get("driver_oos_total")) > 0)
        pct = lambda a, b: round(100 * a / b, 2) if b else None
        return {
            "total": len(rows),
            "vehicle": {"inspections": len(veh), "oos": veh_oos, "oos_rate": pct(veh_oos, len(veh)),
                        "national_avg": config.NATIONAL_OOS["vehicle"]},
            "driver": {"inspections": len(drv), "oos": drv_oos, "oos_rate": pct(drv_oos, len(drv)),
                       "national_avg": config.NATIONAL_OOS["driver"]},
            "national_avg_source": f"{config.NATIONAL_OOS['source']}, as of {config.NATIONAL_OOS['as_of']}",
            "method": "24 months from FMCSA Vehicle Inspection File; vehicle = levels 1,2,5,6; driver = levels 1,2,3,6",
        }

    def _crashes(self, rows):
        seen = {}
        for r in rows:
            seen[r.get("crash_id")] = r
        rows = list(seen.values())
        return {"total": len(rows),
                "fatal": sum(1 for r in rows if to_int(r.get("fatalities")) > 0),
                "injury": sum(1 for r in rows if to_int(r.get("injuries")) > 0),
                "tow_away": sum(1 for r in rows if r.get("tow_away") == "Y")}
