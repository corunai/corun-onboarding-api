"""Build opening_stat.json from the latest LoadStop Loads export. Run daily after the ~6 AM PT export lands.
Usage: python build_stat.py [/workspace/loadstop] > opening_stat.json"""
import sys, glob, json, re, datetime, collections, openpyxl
d = sys.argv[1] if len(sys.argv) > 1 else "/workspace/loadstop"
f = sorted(glob.glob(f"{d}/Loads_*.xlsx"))[-1]
rows = list(openpyxl.load_workbook(f, read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True))
h = rows[0]; R = rows[1:]
ix = {k: h.index(k) for k in ("Status", "Delivery", "ETA date time", "Late Reason", "Miles/Units")}
st = collections.Counter(r[ix["Status"]] for r in R)
fmt = "%m/%d/%Y %I:%M %p"
on = late = 0
for r in R:
    eta = str(r[ix["ETA date time"]] or ""); dl = str(r[ix["Delivery"]] or "")
    m = re.match(r"Arrived : (.+)", eta); w = re.match(r"(\d\d/\d\d/\d{4}) (\d\d:\d\d [AP]M)-(\d\d:\d\d [AP]M)", dl)
    if not (m and w): continue
    try:
        a = datetime.datetime.strptime(m.group(1).strip(), fmt)
        end = datetime.datetime.strptime(f"{w.group(1)} {w.group(3)}", fmt)
    except ValueError: continue
    if a <= end + datetime.timedelta(minutes=0): on += 1
    else: late += 1
n = on + late
pk = [datetime.datetime.strptime(str(r[h.index("Pickup")])[:10], "%m/%d/%Y") for r in R if r[ix["Status"]] == "Completed" and re.match(r"\d\d/\d\d/\d{4}", str(r[h.index("Pickup")]))]
miles = sum(float(r[ix["Miles/Units"]] or 0) for r in R if r[ix["Status"]] == "Completed")
days = (max(pk) - min(pk)).days + 1 if pk else None
out = {"source_file": f.split("/")[-1], "built_at": datetime.datetime.now().isoformat(timespec="minutes"),
       "loads_in_export": len(R), "in_transit": st.get("InTransit", 0), "completed": st.get("Completed", 0),
       "deliveries_scored": n, "on_time_pct": round(100 * on / n, 1) if n else None,
       "definition": "on time = 'Arrived' timestamp at or before the end of the delivery appointment window (no grace)"}
out.update(completed_miles=int(miles), window_days=days, pickup_from=min(pk).strftime("%b %d"), pickup_to=max(pk).strftime("%b %d"))
# on-time % is kept for reference only: just ~1/3 of completed loads carry an Arrived stamp and strict window scoring gives a weak, partial number.
out["line"] = (f"As of this morning, True Nation has {out['in_transit']} loads on the road, and {out['completed']} loads delivered since {out['pickup_from']}, about {round(miles/1000)} thousand miles.")
print(json.dumps(out, indent=1))
