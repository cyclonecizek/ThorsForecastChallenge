# Thor's Forecast Challenge 2026 workbench

A forecast workbench for TFC26 (Operation Northern Lantern). It pulls model guidance, observations
and TAFs for any ICAO, picks each forecast value to **maximize expected points under the TFC26
scoring chart**, fills in the official daily workbook, and grades your forecasts against the
METAR/SPECI reports once the valid window has passed.

## What it does
* **Days 1–6 built in** (ICAOs, valid windows, suspense countdown), plus a Custom mode for any ICAO
  and start time.
* **Guidance**: about 20 Open-Meteo deterministic models (GFS, ECMWF IFS/AIFS, ICON, GEM, UKMO,
  ARPEGE, JMA, and the regional models that cover each site: HRRR/NBM/NAM, GEM Regional/HRDPS,
  ICON-EU/D2, UKV, AROME, HARMONIE, MET Nordic), 9 ensembles (GEFS, ECMWF ENS, AIFS ENS, ICON EPS/EU/D2,
  GEPS, MOGREPS-G/UK), LAMP / GFS MOS / NBM text for US stations, the official TAF, and persistence.
  Models that don't cover a station just drop out.
* **Ceilings from models**: lowest pressure level at or above BKN (60 %) cloud, converted to feet
  above the station, with MOS/LAMP/NBM ceilings and the TAF alongside.
* **Recent skill**: every model is verified against the last ~24 h of METARs at the station.
  Better-verifying models get more weight and recent bias is removed (both can be switched off).
* **Scoring-aware values**: for every hour and element the page builds a probability distribution
  from all sources and chooses the value with the highest expected score under the chart, including
  the penalties (−1 wind ≥ 8 kt off, −2 visibility ≥ 1600 m off, −2 wrong freezing precip, −1 temp
  ≥ 5 °C off). Click any cell to see the alternatives with their expected points.
* **Workbook**: Download fills the official `teamname_TFC26_ICAO_DD.xlsx` (date, team, ICAO, the
  forecast cells, multiple-choice answers and the short-answer box) and names it
  `TEAMNAME_TFC26_ICAO_DD.xlsx`. Nothing else in the form changes.
* **Grading**: each download is saved in the browser with every source's own forecast. Once the
  observations are in, the Grading panel scores your submission and shows which sources would have
  scored better. Teammates can share saved forecasts with Export / Import, and any completed
  workbook can be imported and graded.
* **Climatology**: `pipeline/tfc_climo.py` pulls every METAR/SPECI from 8 Oct to 12 Nov for each
  past year since 2015 (IEM archive) and stores the grader-style hourly values. The page compares
  climatology with the guidance for the valid window (fog, low ceilings, calm winds, precipitation
  types) and can blend it in as a source from the Model mixer.
* **Pre-submission check**: Download runs a check first. It flags blank or badly formatted cells,
  dew point above temperature, weather that doesn't fit the visibility or temperature, edits that
  cost expected points, stale guidance, the suspense, blank answers, the RFI format (Day 2) and the
  250-word brief limit (Day 3).
* **Day 3 helper**: scores the ETAR guidance against the J2 thresholds for Sable-6 (visibility,
  precipitation, sustained wind, gusts, lightning, EO/IR, passive RF) and Raven-4 (visibility, surface
  wind, precipitation, lightning, launch/recovery) for each day T+3 to T+5 and the T+5 0600–1200Z
  window, as Favorable / Limited / Constrained with the chance of each, then drafts the Annex C outlook
  and a commander briefing of 250 words or fewer (copyable into the short answer box).

## Setup
1. Create an empty GitHub repo named `ThorsForecastChallenge` (no README).
2. From this folder:
   ```
   git init -b main
   git add .
   git commit -m "TFC26 workbench"
   git remote add origin https://github.com/<you>/ThorsForecastChallenge.git
   git push -u origin main
   ```
3. Settings > Actions > General > Workflow permissions: Read and write.
4. Settings > Pages: Deploy from a branch, `main`, folder `/docs`.
5. Actions tab: run "TFC observation mirror" once (it then runs every 15 minutes) and
   "TFC climatology" once (about 10–20 minutes; it then refreshes weekly).
6. Open `https://<you>.github.io/ThorsForecastChallenge/` (`?demo=1` shows synthetic data).

## The observation mirror
`pipeline/tfc_mirror.py` (standard library only) fetches METARs, TAFs, station info and US MOS for
every ICAO in `docs/data/watchlist.json` and keeps **21 days of METAR history**, so a day can still be
graded after it drops off aviationweather.gov. The page reads the mirror first and falls back to the
live sources. For a station that isn't on the watchlist, the page tries aviationweather.gov directly;
if your browser blocks that, add the ICAO to the watchlist and push.

## Scoring assumptions to confirm with A39T
The chart doesn't say how a few cases are graded, so they are settings (Sources, weighting and
scoring assumptions), and the optimizer adapts to whatever you set:
* points for a **blank Present Wx** when nothing is observed (default 2),
* whether **−2 also applies when freezing precip is observed but not forecast** (default no),
* the code to enter in **Min Cig when no ceiling** is expected (default `999`),
* whether **temperature/dew point** is checked against the routine METAR or any report in the hour,
* hourly verification: wind is the highest speed or gust reported in the hour, direction from that
  report; visibility and ceiling are the lowest; any reported weather category counts (vicinity ignored).
