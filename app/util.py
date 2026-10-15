from datetime import date, datetime
import re


def parse_date(s):
    """Parse FMCSA date strings: YYYYMMDD, MM/DD/YYYY, or ISO. Returns date or None."""
    if not s:
        return None
    s = str(s).strip()
    for fmt in ("%Y%m%d", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:10] if "-" in s else s, fmt).date()
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(s.replace("Z", "")).date()
    except ValueError:
        return None


def iso(d):
    return d.isoformat() if d else None


def to_int(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def months_between(a: date, b: date) -> float:
    return (b - a).days / 30.4375


def add_years(d: date, n: int) -> date:
    try:
        return d.replace(year=d.year + n)
    except ValueError:  # Feb 29
        return d.replace(year=d.year + n, day=28)


def parse_identifier(raw: str):
    """'44110' -> ('dot','44110'); 'MC-1515' / 'mc1515' -> ('mc','1515')."""
    s = str(raw).strip().upper().replace(" ", "")
    m = re.fullmatch(r"(?:USDOT|DOT)?[-#:]?(\d{1,8})", s)
    if m:
        return "dot", str(int(m.group(1)))
    m = re.fullmatch(r"(MC|MX|FF)[-#:]?(\d{1,8})", s)
    if m:
        return m.group(1).lower(), str(int(m.group(2)))
    return None, None
