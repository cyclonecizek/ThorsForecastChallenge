#!/usr/bin/env python3
"""Mirror observations and station data for the TFC26 workbench (docs/index.html).

For every ICAO in docs/data/watchlist.json:
  docs/data/obs/<ICAO>.json   METAR/SPECI history, merged run to run and kept for 21 days so a
                              day can still be graded after it drops off aviationweather.gov
  docs/data/taf/<ICAO>.json   latest TAF
  docs/data/stations.json     name, lat, lon, elevation (m)
  docs/data/mos/<ICAO>_<MODEL>.json  LAMP, GFS MOS, NBM text, GFS MOS extended (US stations, from IEM)

Sources: aviationweather.gov data API, with the Iowa Environmental Mesonet METAR archive as a
backup. Standard library only. A failed download keeps the previous file.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "docs", "data")
AWC = "https://aviationweather.gov/api/data"
IEM_MOS = "https://mesonet.agron.iastate.edu/api/1/mos.json?station={icao}&model={model}"
IEM_ASOS = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
UA = {"User-Agent": "tfc26-workbench-mirror (GitHub Actions)"}
KEEP_DAYS = 21
MOS_MODELS = ["LAV", "GFS", "NBS", "GFSX"]


def get(url, tries=3, timeout=45, as_json=True):
    last = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                body = r.read().decode("utf-8", "replace")
                if r.status == 204 or not body.strip():
                    return [] if as_json else ""
                return json.loads(body) if as_json else body
        except Exception as e:  # noqa: BLE001 - log and retry
            last = e
            time.sleep(3 * (k + 1))
    raise last


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    os.replace(path + ".tmp", path)


def is_us(icao):
    return icao.startswith(("K", "PA", "PH", "PG", "TJ"))


def iem_metars(icao, hours=72):
    """Backup METAR source (IEM archive), returns [{t, raw}]"""
    end = datetime.now(timezone.utc) + timedelta(hours=1)
    start = end - timedelta(hours=hours)
    q = {
        "station": icao, "data": "metar", "tz": "Etc/UTC", "format": "onlycomma", "latlon": "no",
        "missing": "empty", "trace": "empty", "direct": "no",
        "year1": start.year, "month1": start.month, "day1": start.day, "hour1": start.hour,
        "year2": end.year, "month2": end.month, "day2": end.day, "hour2": end.hour,
        "report_type": [3, 4],
    }
    txt = get(IEM_ASOS + "?" + urllib.parse.urlencode(q, doseq=True), as_json=False)
    out = []
    for line in txt.splitlines()[1:]:
        parts = line.split(",", 2)
        if len(parts) < 3 or not parts[2].strip():
            continue
        try:
            t = datetime.strptime(parts[1], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        out.append({"t": int(t.timestamp() * 1000), "raw": parts[2].strip()})
    return out


def main():
    wl = load(os.path.join(DATA, "watchlist.json"), {}).get("icaos", [])
    icaos = sorted({i.strip().upper() for i in wl if len(i.strip()) == 4})
    if not icaos:
        print("watchlist is empty")
        return 1
    ids = ",".join(icaos)
    now_ms = int(time.time() * 1000)
    ok = 0

    # METARs (merge with history)
    try:
        metars = get(f"{AWC}/metar?ids={ids}&format=json&hours=72")
    except Exception as e:  # noqa: BLE001
        print(f"AWC METAR failed: {e}")
        metars = []
    by = {}
    for m in metars or []:
        raw = (m.get("rawOb") or "").strip()
        if not raw:
            continue
        t = m.get("obsTime")
        t = int(t) * 1000 if t else now_ms
        by.setdefault(m.get("icaoId", raw.split()[0]), []).append({"t": t, "raw": raw})
    for icao in icaos:
        new = by.get(icao, [])
        if not new:
            try:
                new = iem_metars(icao)
                print(f"{icao}: {len(new)} METARs from IEM backup")
            except Exception as e:  # noqa: BLE001
                print(f"{icao}: no METARs ({e})")
        path = os.path.join(DATA, "obs", f"{icao}.json")
        old = load(path, {}).get("metars", [])
        seen, merged = set(), []
        for r in sorted(old + new, key=lambda x: x["t"]):
            if r["raw"] in seen or r["t"] < now_ms - KEEP_DAYS * 86400e3:
                continue
            seen.add(r["raw"])
            merged.append(r)
        if merged:
            save(path, {"icao": icao, "updated": now_ms, "metars": merged})
            ok += 1
            print(f"{icao}: {len(merged)} METARs kept ({len(new)} fetched)")

    # TAFs
    try:
        tafs = get(f"{AWC}/taf?ids={ids}&format=json")
        for t in tafs or []:
            raw = (t.get("rawTAF") or "").strip()
            if raw:
                save(os.path.join(DATA, "taf", f"{t.get('icaoId')}.json"), {"icao": t.get("icaoId"), "updated": now_ms, "raw": raw})
        print(f"TAFs: {len(tafs or [])}")
    except Exception as e:  # noqa: BLE001
        print(f"AWC TAF failed: {e}")

    # station info
    try:
        info = get(f"{AWC}/stationinfo?ids={ids}&format=json")
        st = load(os.path.join(DATA, "stations.json"), {})
        for s in info or []:
            st[s["icaoId"]] = {"name": s.get("site") or s["icaoId"], "lat": s.get("lat"), "lon": s.get("lon"), "elev": s.get("elev") or 0}
        save(os.path.join(DATA, "stations.json"), st)
    except Exception as e:  # noqa: BLE001
        print(f"station info failed: {e}")

    # MOS (US)
    for icao in [i for i in icaos if is_us(i)]:
        for model in MOS_MODELS:
            try:
                js = get(IEM_MOS.format(icao=icao, model=model))
                rows = js.get("data", js) if isinstance(js, dict) else js
                if rows:
                    save(os.path.join(DATA, "mos", f"{icao}_{model}.json"), js)
            except Exception as e:  # noqa: BLE001
                print(f"{icao} {model}: {e}")
    save(os.path.join(DATA, "status.json"), {"updated": now_ms, "icaos": icaos})
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
