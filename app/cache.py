import json, sqlite3, threading, time
from . import config

_lock = threading.Lock()


class Cache:
    def __init__(self, path=None, ttl=None):
        self.path = path or config.CACHE_PATH
        self.ttl = config.CACHE_TTL_SECONDS if ttl is None else ttl
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT, ts REAL)")
        self.db.commit()

    def get(self, key):
        with _lock:
            row = self.db.execute("SELECT v, ts FROM cache WHERE k=?", (key,)).fetchone()
        if row and time.time() - row[1] < self.ttl:
            return json.loads(row[0])
        return None

    def set(self, key, value):
        with _lock:
            self.db.execute("REPLACE INTO cache VALUES (?,?,?)", (key, json.dumps(value), time.time()))
            self.db.commit()
