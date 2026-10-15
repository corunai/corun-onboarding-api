# CoRun Onboarding API (v1)

Standalone back end for the CoRun carrier and agency onboarding flows. It builds a unified carrier profile from **public FMCSA data**: the daily Motus datasets on data.transportation.gov, plus the FMCSA QCMobile API when a webKey is configured.

**Why Python + FastAPI:** lots of data reshaping, typed request models, free OpenAPI docs at `/docs`, and a straightforward path to pandas or ML scoring later.

## Run
```bash
pip install -r requirements.txt
cp .env.example .env   # optional tokens
uvicorn app.main:app --reload       # http://localhost:8000/docs
# or
docker build -t corun-onboarding-api . && docker run -p 8000:8000 corun-onboarding-api
```

## Endpoints
| Method | Path | What it returns |
|---|---|---|
| GET | `/` | onboarding start: carrier or insurance agent |
| GET | `/onboarding` | carrier setup (account, live FMCSA check, checklist) |
| GET | `/agency/onboarding` | agency setup (book, risk, estimated renewals) |
| GET | `/demo` | earlier single-page carrier/agency data demo |
| GET | `/health` | status, plus whether a QCMobile key and Socrata token are configured |
| GET | `/carriers/{dot}` | unified profile + Fleet Health Score + issues |
| GET | `/carriers/mc/{mc}` | same, looked up by MC/MX/FF docket (`1515`, `MC-1515`) |
| POST | `/agency/book` | `{"identifiers": [DOT or MC...]}` → matched profiles ranked by risk, plus a rollup |
| POST | `/agency/renewals` | renewal radar (**estimated**), bucketed 0-30/31-60/61-90/91+ days |
| GET | `/insurers/search?name=` | carriers with an active/pending FMCSA filing from an insurer (substring match) |

## Data sources (all public and free)
| Data | Dataset |
|---|---|
| Company Census | `az4n-8mr2` |
| Motus Carrier (authority) | `inys-ebih` |
| Motus Insur (active/pending insurance) | `c5y8-a4uz` |
| Motus InsHist | `3uet-3z4i` |
| Motus BOC3 | `6snj-ed7q` |
| Motus RevokeSuspend | `wb4f-neki` |
| Vehicle Inspection File | `fx4q-ay7w` |
| Crash File | `aayw-vxb3` |

- Responses are cached in SQLite for 24 h by default (`CACHE_TTL_SECONDS`).
- `SOCRATA_APP_TOKEN` is optional and raises Socrata's throttle limits.
- `FMCSA_WEBKEY` is optional. When set, profiles include a `qcmobile` block (carrier + BASICs). That part is untested because we don't have a key yet.
- **National OOS averages** (vehicle 22.26%, driver 6.67%) are copied from the FMCSA SAFER Company Snapshot "Nat'l Average as of 09/25/2026" (`app/config.py`). Update them when SAFER does.
- **Inspection counting** follows the SAFER convention: vehicle = levels 1, 2, 5, 6; driver = levels 1, 2, 3, 6; 24-month window. For USDOT 44110 our counts match SAFER exactly: vehicle 336 inspections / 25 OOS = 7.4%, driver 766 / 11 = 1.4%. Total inspections: ours 807, SAFER 806.

## Estimates (always labeled)
FMCSA insurance filings **have no expiration date**: a filing stays in force until it's cancelled. Every renewal date is therefore an **estimate**, computed as the next anniversary of the filing's effective date (assumes a 12-month term). Each one is flagged `"estimated": true`. Real dates should come from the agency's management system or the carrier's documents.

## Fleet Health Score — v0 DRAFT (0–100)
Built only from public data. Not an FMCSA rating and not underwriting advice. Every response includes the factor breakdown.

| Factor | Max | Formula |
|---|---|---|
| Vehicle OOS | 25 | `25 × clamp(1 − rate / (2 × national))`: full credit at 0%, half at the national average, zero at 2× national. Fewer than 3 inspections gets neutral half credit |
| Driver OOS | 20 | same formula, driver rate vs the driver national average |
| Crashes | 20 | `20 × clamp(1 − (crashes per 10 power units in 24 mo) / 2)`, minus 5 if any fatal crash (floor 0) |
| Compliance | 20 | +8 authority active, +6 insurance on file, +3 BOC-3 on file (each of these counts as satisfied if the carrier has no operating authority), +3 MCS-150 within 24 mo |
| Standing | 15 | 15 if USDOT is ACTIVE and there were no revocation/suspension orders in 24 mo, else 0 |

Known limits:
- Crashes aren't weighted for preventability or severity, and there's no mileage normalization.
- CSA BASIC percentiles aren't used (FMCSA doesn't publish them for property carriers; QCMobile BASICs could be added).
- Thresholds are first guesses and need calibrating against a real book of business.

## Issue rules
| Code | Severity | Rule |
|---|---|---|
| `usdot_inactive` | high | census status ≠ A |
| `mcs150_missing` / `mcs150_overdue` | medium | no MCS-150 date, or last update older than 24 months |
| `authority_inactive` | high | has authority records, none Active |
| `boc3_missing` | high | has authority, no BOC-3 |
| `insurance_missing` | high | has authority, no active/pending filing |
| `insurance_cancelled` | medium | InsHist cancellation in last 12 months |
| `revocation` | high | RevokeSuspend order in last 24 months |
| `high_vehicle_oos` / `high_driver_oos` | medium | ≥3 inspections and rate > 1.25 × national |
| `renewal_estimated` | high ≤30 d, medium ≤90 d | **estimated** renewal within window |

## Tests
```bash
pytest -q                          # 12 offline tests (fake data source)
RUN_LIVE=1 pytest -q               # + 3 live tests against data.transportation.gov
```

## Sample outputs (live, Oct 14 2026)
`GET /carriers/44110` (trimmed; full responses are in `samples/`):
```json
{
 "dot_number": "44110",
 "identity": {
  "legal_name": "GREYHOUND LINES INC",
  "dba_name": "BOLT BUS",
  "usdot_status": "ACTIVE",
  "dockets": [
   {
    "docket": "MC1515",
    "status": "A"
   }
  ]
 },
 "fleet": {
  "power_units": 683,
  "truck_units": 0,
  "bus_units": 683,
  "total_drivers": 905,
  "total_cdl_drivers": 905,
  "cargo_carried": [
   "genfreight",
   "passengers",
   "cargoothr"
  ],
  "hazmat": false
 },
 "mcs150": {
  "date": "2026-04-28",
  "mileage": 66149781,
  "mileage_year": "2025"
 },
 "inspections_24mo": {
  "total": 807,
  "vehicle": {
   "inspections": 336,
   "oos": 25,
   "oos_rate": 7.44,
   "national_avg": 22.26
  },
  "driver": {
   "inspections": 766,
   "oos": 11,
   "oos_rate": 1.44,
   "national_avg": 6.67
  }
 },
 "crashes_24mo": {
  "total": 70,
  "fatal": 6,
  "injury": 41,
  "tow_away": 54
 },
 "boc3": {
  "on_file": true,
  "agents": [
   {
    "name": "C T Corporation System",
    "state": "DC"
   }
  ]
 },
 "fleet_health": {
  "score": 78,
  "max": 100,
  "version": "v0-draft",
  "factors": [
   {
    "factor": "vehicle_oos",
    "points": 20.8,
    "max": 25,
    "detail": "OOS 7.44% vs national 22.26% (full credit at 0%, half at national avg, zero at 2x)"
   },
   {
    "factor": "driver_oos",
    "points": 17.8,
    "max": 20,
    "detail": "OOS 1.44% vs national 6.67% (full credit at 0%, half at national avg, zero at 2x)"
   },
   {
    "factor": "crashes",
    "points": 4.8,
    "max": 20,
    "detail": "70 crashes / 683 power units in 24 mo = 1.02 per 10 units (full credit at 0, zero at 2 per 10 units); -5 if any fatal (6)"
   },
   {
    "factor": "compliance",
    "points": 20,
    "max": 20,
    "detail": "authority active or not required (+8); insurance on file or not required (+6); BOC-3 on file or not required (+3); MCS-150 updated within 24 mo (+3)"
   },
   {
    "factor": "standing",
    "points": 15,
    "max": 15,
    "detail": "USDOT status ACTIVE; 0 revocation/suspension orders in 24 mo"
   }
  ],
  "disclaimer": "Draft composite from public FMCSA data. Not an FMCSA rating; not underwriting advice."
 },
 "issues": [
  {
   "code": "renewal_estimated",
   "severity": "high",
   "title": "Estimated renewal in 17 days",
   "detail": "BUS RISK RETENTION GROUP, INC BMC-91X policy AL-RRG-001022-01: effective 2022-10-31 -> estimated renewal 2026-10-31 (ESTIMATE: assumes 12-month term; FMCSA does not publish expiration dates)",
   "estimated": true
  }
 ],
 "insurance": {
  "active_or_pending": [
   {
    "insurer": "BUS RISK RETENTION GROUP, INC",
    "policy_no": "AL-RRG-001022-01",
    "form": "BMC-91X",
    "type_code": "1",
    "class_code": "P",
    "max_coverage": 5000000.0,
    "underlying_limit": 0.0,
    "effective_date": "2022-10-31",
    "filed_date": "2022-10-28",
    "estimated_renewal": {
     "date": "2026-10-31",
     "days_until": 17,
     "estimated": true,
     "method": "next anniversary of FMCSA filing effective date (assumes 12-month policy term)"
    }
   }
  ]
 }
}
```

`POST /agency/book` with `["44110","1515240","MC-636400","5728756","bogus"]` (rollup):
```json
{
 "rollup": {
  "carriers_submitted": 5,
  "matched": 3,
  "unmatched": 1,
  "total_power_units": 866,
  "total_drivers": 996,
  "avg_fleet_health": 77.7,
  "carriers_with_high_issues": 2,
  "health_distribution": {
   "<50": 0,
   "50-69": 1,
   "70-84": 1,
   "85+": 1
  }
 },
 "duplicates": [
  {
   "input": "MC-636400",
   "dot_number": "1515240"
  }
 ],
 "unmatched": [
  "bogus"
 ],
 "ranked": [
  [
   "IVAR & NONO LOGISTICS LLC",
   62
  ],
  [
   "GREYHOUND LINES INC",
   78
  ],
  [
   "ED'S TRUCKING LLC",
   93
  ]
 ]
}
```

`POST /agency/renewals` (window 365 days; trimmed):
```json
{
 "estimated": true,
 "method": "next anniversary of FMCSA filing effective date (12-month term assumed)",
 "buckets": {
  "0-30": 1,
  "31-60": 0,
  "61-90": 0,
  "91+": 4
 },
 "renewals": [
  {
   "dot_number": "44110",
   "legal_name": "GREYHOUND LINES INC",
   "insurer": "BUS RISK RETENTION GROUP, INC",
   "policy_no": "AL-RRG-001022-01",
   "form": "BMC-91X",
   "max_coverage": 5000000.0,
   "effective_date": "2022-10-31",
   "estimated_renewal": "2026-10-31",
   "days_until": 17,
   "estimated": true
  },
  {
   "dot_number": "1515240",
   "legal_name": "ED'S TRUCKING LLC",
   "insurer": "Old Republic Insurance Company",
   "policy_no": "MWTB 313876",
   "form": "BMC-91X",
   "max_coverage": 2000000.0,
   "effective_date": "2025-02-01",
   "estimated_renewal": "2027-02-01",
   "days_until": 110,
   "estimated": true
  }
 ]
}
```

`GET /insurers/search?name=great american&limit=3` (trimmed):
```json
{
 "query": "great american",
 "carriers": [
  {
   "dot_number": "8839867",
   "docket": "MC59135757",
   "filings": [
    {
     "insurer": "GREAT AMERICAN INSURANCE COMPANY",
     "form": "BMC-34",
     "policy_no": "IMPF566288",
     "max_coverage": "5000.00",
     "effective_date": "20261008"
    }
   ]
  },
  {
   "dot_number": "9703143",
   "docket": "MC88219203",
   "filings": [
    {
     "insurer": "GREAT AMERICAN INSURANCE COMPANY",
     "form": "BMC-34",
     "policy_no": "IMP F578585",
     "max_coverage": "5000.00",
     "effective_date": "20261005"
    }
   ]
  }
 ],
 "count": 3,
 "source": "FMCSA Motus Insur (active/pending filings)"
}
```

## Not done yet
- QCMobile enrichment hasn't been tested (no webKey).
- Inspections and crashes use the daily DataHub files; SMS BASIC measures/alerts (monthly) aren't integrated.
- No auth, accounts, or persistence of agency books; no ELD connectors, Twilio, or Stripe.
- The book endpoint resolves carriers one at a time; it needs batching/async for 100+ carriers.
- Score thresholds need calibration; the national averages are a hard-coded snapshot.
