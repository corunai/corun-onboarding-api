import os

SOCRATA_BASE = os.getenv("SOCRATA_BASE", "https://data.transportation.gov/resource")
SOCRATA_APP_TOKEN = os.getenv("SOCRATA_APP_TOKEN") or None
FMCSA_WEBKEY = os.getenv("FMCSA_WEBKEY") or None
CACHE_PATH = os.getenv("CACHE_PATH", "cache.sqlite3")
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", str(24 * 3600)))

DATASETS = {
    "census": "az4n-8mr2",
    "authority": "inys-ebih",
    "insurance": "c5y8-a4uz",
    "insurance_history": "3uet-3z4i",
    "boc3": "6snj-ed7q",
    "revocations": "wb4f-neki",
    "inspections": "fx4q-ay7w",
    "crashes": "aayw-vxb3",
}

# National out-of-service averages, copied from the FMCSA SAFER Company Snapshot
# ("Nat'l Average % as of 09/25/2026", 24-month window). Update when SAFER updates.
NATIONAL_OOS = {"vehicle": 22.26, "driver": 6.67, "hazmat": 4.44, "as_of": "2026-09-25",
                "source": "FMCSA SAFER Company Snapshot"}
