#!/usr/bin/env python3
"""Station climatology for the TFC26 workbench: docs/data/clim/<ICAO>.json

For each ICAO in docs/data/watchlist.json, downloads METAR/SPECI reports from the Iowa
Environmental Mesonet archive for 8 Oct - 12 Nov of each past year (default 2015 onward), turns
each hour into the same values the TFC26 grader reads (lowest visibility and ceiling, highest wind
or gust, any weather category, routine temperature), and stores one compact record per hour:

    [day_of_year, hour_utc, year, vis_m, ceil_ft (-1 = none, null = unknown), wind_kt,
     dir (0 calm, -1 VRB), wx_bits, temp_c, dew_c]

wx_bits: 1 Liquid, 2 Freezing, 4 Frozen, 8 Lithometer, 16 Non-Precip Hydrometer.

A station is rebuilt only when its file is missing, older than 60 days, or CLIMO_FORCE=1.
Standard library only.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "docs", "data")
IEM_ASOS = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
UA = {"User-Agent": "tfc26-workbench-climo (GitHub Actions)"}
FIRST_YEAR = int(os.environ.get("CLIMO_FIRST_YEAR", "2015"))
WINDOW = ((10, 8), (11, 12))     # month/day start and end of the season pulled each year
MAX_AGE_DAYS = 60

# ---------------------------------------------------------------- METAR parsing (mirrors tfc-core.js)
SM_TO_M = [(0, 0), (1/16, 100), (1/8, 200), (3/16, 300), (1/4, 400), (5/16, 500), (3/8, 600), (1/2, 800),
           (5/8, 1000), (3/4, 1200), (7/8, 1400), (1, 1600), (9/8, 1800), (5/4, 2000), (11/8, 2200), (3/2, 2400),
           (13/8, 2600), (7/4, 2800), (15/8, 3000), (2, 3200), (9/4, 3600), (5/2, 4000), (11/4, 4400), (3, 4800),
           (4, 6000), (5, 8000), (6, 9000), (7, 9999)]
LIQ, FZ, FROZ, LITH, NPH = 1, 2, 4, 8, 16
WX_TOKEN = re.compile(r"^(\+|-|VC|RE)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(TS)?((DZ|RA|SN|SG|IC|PL|GR|GS|UP)+|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)?$")


def sm_to_m(sm):
    if sm >= 7:
        return 9999
    best = 0
    for s, m in SM_TO_M:
        if s <= sm + 1e-9:
            best = m
    return best


def wx_bits(tok):
    if tok.startswith(("VC", "RE")):
        return 0
    t = tok.lstrip("+-")
    fz = t.startswith("FZ")
    b = 0
    for p in re.findall(r"(DZ|RA|SN|SG|IC|PL|GR|GS|UP)", t):
        if fz and p in ("DZ", "RA"):
            b |= FZ
        elif p in ("DZ", "RA", "UP"):
            b |= LIQ
        else:
            b |= FROZ
    blowing = re.match(r"^(BL|DR)SN", t)
    if re.search(r"(BR|FG)", t) or blowing:
        b |= NPH
    if blowing:
        b &= ~FROZ
    elif re.search(r"(HZ|FU|DU|SA|VA|PO|SS|DS)", t):
        b |= LITH
    return b


def parse_metar(raw):
    body = re.split(r"\s(?:RMK|TEMPO|BECMG|NOSIG)(?:\s|$)", raw.strip().rstrip("="))[0]
    tok = body.split()
    p = 0
    special = False
    if tok and tok[0] in ("METAR", "SPECI"):
        special = tok[0] == "SPECI"
        p = 1
    p += 1  # ICAO
    if p >= len(tok) or not re.match(r"^\d{6}Z$", tok[p]):
        return None
    p += 1
    while p < len(tok) and tok[p] in ("AUTO", "COR", "NIL"):
        p += 1
    o = {"special": special, "spd": None, "gst": None, "dir": None, "vrb": False, "vis": None,
         "ceil": "unk", "wx": 0, "t": None, "td": None}
    clouds = None
    vis_set = False
    rest = tok[p:]
    k = 0
    while k < len(rest):
        t = rest[k]
        m = re.match(r"^(\d{3}|VRB|///)(\d{2,3}|//)(?:G(\d{2,3}))?(KT|MPS|KMH)$", t)
        if m:
            f = 1.943844 if m.group(4) == "MPS" else 0.539957 if m.group(4) == "KMH" else 1
            o["vrb"] = m.group(1) == "VRB"
            o["dir"] = int(m.group(1)) if m.group(1).isdigit() else None
            o["spd"] = round(int(m.group(2)) * f) if m.group(2).isdigit() else None
            o["gst"] = round(int(m.group(3)) * f) if m.group(3) else None
        elif re.match(r"^\d{3}V\d{3}$", t):
            pass
        elif t == "CAVOK":
            o["vis"], clouds, vis_set = 9999, [], True
        elif re.match(r"^\d{4}(NDV|[NSEW]{1,2})?$", t) and not vis_set:
            o["vis"], vis_set = int(t[:4]), True
        elif re.match(r"^[PM]?\d*(/\d+)?SM$", t):
            mm = re.match(r"^([PM])?(\d+)?(?:/(\d+))?SM$", t)
            num = int(mm.group(2) or 0)
            sm = num / int(mm.group(3)) if mm.group(3) else num
            if mm.group(1) == "P":
                sm = max(sm, 7)
            o["vis"], vis_set = sm_to_m(sm), True
        elif re.match(r"^\d$", t) and k + 1 < len(rest) and re.match(r"^\d/\dSM$", rest[k + 1]):
            a, b = rest[k + 1][:-2].split("/")
            o["vis"], vis_set = sm_to_m(int(t) + int(a) / int(b)), True
            k += 1
        elif re.match(r"^(FEW|SCT|BKN|OVC)(\d{3}|///)", t):
            clouds = clouds or []
            h = t[3:6]
            clouds.append((t[:3], int(h) * 100 if h.isdigit() else None))
        elif re.match(r"^VV(\d{3}|///)$", t):
            clouds = clouds or []
            clouds.append(("VV", int(t[2:]) * 100 if t[2:].isdigit() else 0))
        elif t in ("SKC", "CLR", "NSC", "NCD"):
            clouds = []
        elif re.match(r"^(M?\d{2})/(M?\d{2})?$", t):
            a, b = t.split("/")
            c = lambda s: None if not s else (-int(s[1:]) if s[0] == "M" else int(s))  # noqa: E731
            o["t"], o["td"] = c(a), c(b)
        elif len(t) >= 2 and WX_TOKEN.match(t) and not t[0].isdigit():
            o["wx"] |= wx_bits(t)
        k += 1
    if clouds is not None:
        cs = [h if h is not None else 0 for a, h in clouds if a in ("BKN", "OVC", "VV")]
        o["ceil"] = min(cs) if cs else -1
    return o


def hour_record(obs):
    """obs: parsed reports inside one hour -> grader-style hourly values"""
    mx, mo = -1, None
    for o in obs:
        w = max(o["spd"] if o["spd"] is not None else -1, o["gst"] if o["gst"] is not None else -1)
        if w > mx:
            mx, mo = w, o
    vis = [o["vis"] for o in obs if o["vis"] is not None]
    ceils = [o["ceil"] for o in obs if o["ceil"] != "unk"]
    ceil = None
    if ceils:
        real = [c for c in ceils if c >= 0]
        ceil = min(real) if real else -1
    bits = 0
    for o in obs:
        bits |= o["wx"]
    routine = [o for o in obs if not o["special"]] or obs
    last = routine[-1]
    if mo is None:
        d = None
    elif mo["vrb"]:
        d = -1
    elif mx == 0:
        d = 0
    else:
        d = mo["dir"]
    return [min(vis) if vis else None, ceil, mx if mx >= 0 else None, d, bits, last["t"], last["td"]]


# ---------------------------------------------------------------- download
def get(url, tries=3, timeout=120):
    last = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(5 * (k + 1))
    raise last


def year_metars(icao, year):
    (m1, d1), (m2, d2) = WINDOW
    q = {"station": icao, "data": "metar", "tz": "Etc/UTC", "format": "onlycomma", "latlon": "no",
         "missing": "empty", "trace": "empty", "direct": "no",
         "year1": year, "month1": m1, "day1": d1, "hour1": 0,
         "year2": year, "month2": m2, "day2": d2, "hour2": 23, "report_type": [3, 4]}
    txt = get(IEM_ASOS + "?" + urllib.parse.urlencode(q, doseq=True))
    out = []
    for line in txt.splitlines()[1:]:
        parts = line.split(",", 2)
        if len(parts) < 3 or not parts[2].strip():
            continue
        try:
            t = datetime.strptime(parts[1], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        out.append((t, parts[2].strip()))
    return out


def build(icao, years):
    recs, used = [], []
    for y in years:
        try:
            rows = year_metars(icao, y)
        except Exception as e:  # noqa: BLE001
            print(f"  {icao} {y}: {e}")
            continue
        hours = {}
        for t, raw in rows:
            o = parse_metar(raw)
            if o:
                hours.setdefault((t.timetuple().tm_yday, t.hour), []).append(o)
        for (doy, hr), obs in sorted(hours.items()):
            recs.append([doy, hr, y] + hour_record(obs))
        if hours:
            used.append(y)
        print(f"  {icao} {y}: {len(rows)} reports, {len(hours)} hours")
        time.sleep(1.0)
    return recs, used


def main():
    wl = json.load(open(os.path.join(DATA, "watchlist.json"))).get("icaos", [])
    force = os.environ.get("CLIMO_FORCE") == "1"
    this_year = datetime.now(timezone.utc).year
    years = list(range(FIRST_YEAR, this_year))
    os.makedirs(os.path.join(DATA, "clim"), exist_ok=True)
    built = 0
    for icao in sorted({i.strip().upper() for i in wl}):
        path = os.path.join(DATA, "clim", f"{icao}.json")
        if not force and os.path.exists(path) and time.time() - os.path.getmtime(path) < MAX_AGE_DAYS * 86400:
            print(f"{icao}: up to date")
            continue
        print(f"{icao}: building {years[0]}-{years[-1]}")
        recs, used = build(icao, years)
        if not recs:
            print(f"{icao}: no data, keeping previous file")
            continue
        doc = {"icao": icao, "years": used, "season": "08 Oct - 12 Nov", "fields":
               ["doy", "hour", "year", "vis", "ceil", "spd", "dir", "wx", "t", "td"], "recs": recs}
        with open(path + ".tmp", "w") as f:
            json.dump(doc, f, separators=(",", ":"))
        os.replace(path + ".tmp", path)
        built += 1
        print(f"{icao}: {len(recs)} hourly records")
    print(f"built {built} station climatologies")
    return 0


if __name__ == "__main__":
    sys.exit(main())
