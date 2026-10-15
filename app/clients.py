"""Data clients: Socrata (data.transportation.gov) and optional FMCSA QCMobile."""
import httpx
from urllib.parse import urlencode
from . import config
from .cache import Cache


class SocrataClient:
    def __init__(self, cache: Cache | None = None, http: httpx.Client | None = None):
        self.cache = cache or Cache()
        self.http = http or httpx.Client(timeout=60)

    def query(self, dataset: str, params: dict) -> list[dict]:
        ds = config.DATASETS.get(dataset, dataset)
        url = f"{config.SOCRATA_BASE}/{ds}.json?{urlencode(sorted(params.items()))}"
        hit = self.cache.get(url)
        if hit is not None:
            return hit
        headers = {"X-App-Token": config.SOCRATA_APP_TOKEN} if config.SOCRATA_APP_TOKEN else {}
        r = self.http.get(url, headers=headers)
        r.raise_for_status()
        data = r.json()
        self.cache.set(url, data)
        return data


class QCMobileClient:
    """FMCSA QCMobile API. Only active when FMCSA_WEBKEY is set; otherwise every call returns None."""
    BASE = "https://mobile.fmcsa.dot.gov/qc/services"

    def __init__(self, cache: Cache | None = None, http: httpx.Client | None = None):
        self.key = config.FMCSA_WEBKEY
        self.cache = cache or Cache()
        self.http = http or httpx.Client(timeout=30)

    @property
    def enabled(self):
        return bool(self.key)

    def get(self, path: str):
        if not self.enabled:
            return None
        url = f"{self.BASE}/{path.lstrip('/')}"
        hit = self.cache.get("qc:" + url)
        if hit is not None:
            return hit
        try:
            r = self.http.get(url, params={"webKey": self.key})
            r.raise_for_status()
            data = r.json()
        except Exception as e:  # never break the profile because QCMobile is down
            return {"error": str(e)}
        self.cache.set("qc:" + url, data)
        return data

    def carrier(self, dot):
        return self.get(f"carriers/{dot}")

    def basics(self, dot):
        return self.get(f"carriers/{dot}/basics")
