/* ============================================================
   Data: stations, observations, TAF, MOS, Open-Meteo models
   Every fetch tries this site's mirror (written by the GitHub
   workflow) first, then the public source directly.
   ============================================================ */
const DEMO = /[?&]demo=1\b/.test(location.search);
async function getJSON(url, ms){
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), ms || 30000);
  try { const r = await fetch(url, { signal:ctl.signal, cache:"no-store" }); if (!r.ok){ const e = new Error("HTTP " + r.status); e.status = r.status; throw e; } return await r.json(); }
  finally { clearTimeout(tm); }
}
async function mirrorFirst(path, direct, ms){
  try { const j = await getJSON(`${path}?ts=${Date.now()}`, 8000); if (j) return { j, from:"mirror" }; } catch (e) { /* not mirrored */ }
  if (!direct) throw new Error("not mirrored");
  return { j: await getJSON(direct, ms || 20000), from:"live" };
}

/* ---------- stations ---------- */
async function stationMeta(icao){
  if (STATIONS[icao]) return { icao, ...STATIONS[icao] };
  try {
    const { j } = await mirrorFirst(`data/stations.json`, null);
    if (j && j[icao]) return { icao, ...j[icao] };
  } catch (e) { /* fall through */ }
  const j = await getJSON(`https://aviationweather.gov/api/data/stationinfo?ids=${icao}&format=json`, 15000);
  const s = Array.isArray(j) ? j[0] : null;
  if (!s) throw new Error("unknown station");
  return { icao, name: s.site || icao, lat: +s.lat, lon: +s.lon, elev: +s.elev || 0 };
}

/* ---------- METARs ---------- */
async function fetchObs(icao){
  if (DEMO) return demoObs(icao);
  const { j, from } = await mirrorFirst(`data/obs/${icao}.json`, `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=72`);
  const list = Array.isArray(j) ? j.map(x => ({ raw: x.rawOb, t: (x.obsTime ? x.obsTime*1000 : Date.parse(x.reportTime)) })) : (j.metars || []);
  const obs = list.map(x => parseMETAR(x.raw, x.t || Date.now())).filter(Boolean);
  obs.sort((a, b) => a.time - b.time);
  const uniq = []; for (const o of obs) if (!uniq.length || uniq[uniq.length - 1].raw !== o.raw) uniq.push(o);
  return { obs: uniq, from };
}
async function fetchTAF(icao){
  if (DEMO) return demoTAF(icao);
  const { j, from } = await mirrorFirst(`data/taf/${icao}.json`, `https://aviationweather.gov/api/data/taf?ids=${icao}&format=json`);
  const raw = Array.isArray(j) ? (j[0] && j[0].rawTAF) : j.raw;
  if (!raw) return { taf:null, from };
  return { taf: parseTAF(raw, Date.now()), from };
}

/* ---------- climatology (built by pipeline/tfc_climo.py) ---------- */
async function fetchClim(icao){
  if (DEMO) return demoClim(icao);
  const { j } = await mirrorFirst(`data/clim/${icao}.json`, null);
  return j && j.recs && j.recs.length ? j : null;
}

/* ---------- MOS (US stations, IEM) ---------- */
const MOS_MODELS = [
  { id:"lav", name:"LAMP",          model:"LAV" },
  { id:"mav", name:"GFS MOS",       model:"GFS" },
  { id:"nbs", name:"NBM text",      model:"NBS" },
  { id:"mex", name:"GFS MOS ext",   model:"GFSX" },
];
const isUS = icao => /^(K|PA|PH|PG|TJ)/.test(icao);
async function fetchMOS(icao, def, TL){
  if (DEMO) return null;
  const { j } = await mirrorFirst(`data/mos/${icao}_${def.model}.json`, `https://mesonet.agron.iastate.edu/api/1/mos.json?station=${icao}&model=${def.model}`);
  const rows = Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : [];
  if (!rows.length) return null;
  const pick = (r, ks) => { for (const k of ks) for (const rk in r) if (rk.toLowerCase() === k && r[rk] != null && r[rk] !== "") return r[rk]; return null; };
  const num = (r, ks) => { const v = pick(r, ks); if (v == null) return null; const m = String(v).match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };
  const t = s => { s = String(s).replace(" ", "T"); if (!/Z|[+-]\d\d:?\d\d$/.test(s)) s += "Z"; return Date.parse(s); };
  const f2c = f => f == null ? null : (f - 32)*5/9;
  const vals = rows.map(r => r && pick(r, ["vis"]) != null ? num(r, ["vis"]) : null).filter(v => v != null);
  const visTenths = vals.length && Math.max(...vals) > 7;
  const m = blankMember(TL);
  let run = null;
  for (const r of rows){
    const ft = t(pick(r, ["ftime"])); const i = TL.idx(ft); if (!(i >= 0 && i < TL.n)) continue;
    const rt = pick(r, ["runtime"]); if (rt) run = t(rt);
    const tmp = num(r, ["tmp"]), dpt = num(r, ["dpt"]);
    if (tmp != null && tmp > -80 && tmp < 130) m.t[i] = f2c(tmp);
    if (dpt != null && dpt > -80 && dpt < 100) m.td[i] = f2c(dpt);
    const wd = num(r, ["wdr"]), ws = num(r, ["wsp"]), gs = num(r, ["gst","wgs"]);
    if (ws != null && ws < 150){ m.spd[i] = Math.max(ws, gs && gs > ws ? gs : 0); m.dir[i] = wd; }
    const vv = num(r, ["vis"]);
    if (vv != null) m.vis[i] = visTenths ? smToM(vv/10) : [null, 400, 1200, 2400, 4000, 6400, 9000, 9999][Math.round(vv)] ?? null;
    const cg = num(r, ["cig"]);
    if (cg != null) m.ceil[i] = def.model === "NBS" ? (cg >= 800 ? null : cg*100) : ({ 1:100, 2:300, 3:700, 4:1500, 5:2500, 6:4500, 7:9000, 8:null })[Math.round(cg)];
    const typ = String(pick(r, ["typ","ptype"]) || "").toUpperCase();
    const pop = num(r, ["ppo","p01","p06"]);
    if (pop != null) m.pop[i] = pop/100;
    if (typ) m.ptyp[i] = typ[0];
  }
  m.gap = def.model === "GFSX" ? 12 : 3;
  return { members:[finishMember(m, TL)], run };
}

/* ---------- Open-Meteo ---------- */
const OM_DET = [
  { id:"gfs",    name:"GFS",            model:"gfs_seamless",                    fam:"global" },
  { id:"ifs",    name:"ECMWF IFS",      model:"ecmwf_ifs025",                    fam:"global" },
  { id:"aifs",   name:"ECMWF AIFS",     model:"ecmwf_aifs025_single",            fam:"global" },
  { id:"icon",   name:"ICON",           model:"icon_global",                     fam:"global" },
  { id:"gem",    name:"GEM",            model:"gem_global",                      fam:"global" },
  { id:"ukmo",   name:"UKMO Global",    model:"ukmo_global_deterministic_10km",  fam:"global" },
  { id:"arpege", name:"ARPEGE",         model:"meteofrance_arpege_world",        fam:"global" },
  { id:"jma",    name:"JMA",            model:"jma_gsm",                         fam:"global" },
  { id:"hrrr",   name:"HRRR",           model:"ncep_hrrr_conus",                 fam:"regional" },
  { id:"nbm",    name:"NBM",            model:"ncep_nbm_conus",                  fam:"regional" },
  { id:"nam",    name:"NAM 3 km",       model:"ncep_nam_conus",                  fam:"regional" },
  { id:"gemreg", name:"GEM Regional",   model:"gem_regional",                    fam:"regional" },
  { id:"hrdps",  name:"HRDPS",          model:"gem_hrdps_continental",           fam:"regional" },
  { id:"iconeu", name:"ICON-EU",        model:"icon_eu",                         fam:"regional" },
  { id:"icond2", name:"ICON-D2",        model:"icon_d2",                         fam:"regional" },
  { id:"ukv",    name:"UKV 2 km",       model:"ukmo_uk_deterministic_2km",       fam:"regional" },
  { id:"arome",  name:"AROME",          model:"meteofrance_arome_france",        fam:"regional" },
  { id:"harm",   name:"HARMONIE (KNMI)",model:"knmi_harmonie_arome_europe",      fam:"regional" },
  { id:"dmi",    name:"HARMONIE (DMI)", model:"dmi_harmonie_arome_europe",       fam:"regional" },
  { id:"metno",  name:"MET Nordic",     model:"metno_nordic",                    fam:"regional" },
];
const OM_ENS = [
  { id:"gefs",    name:"GEFS",           model:"gfs025",                   fam:"ens" },
  { id:"eps",     name:"ECMWF ENS",      model:"ecmwf_ifs025",             fam:"ens" },
  { id:"aifsens", name:"AIFS ENS",       model:"ecmwf_aifs025",            fam:"ens" },
  { id:"iconeps", name:"ICON EPS",       model:"icon_global",              fam:"ens" },
  { id:"iconeueps",name:"ICON-EU EPS",   model:"icon_eu",                  fam:"ens" },
  { id:"icond2eps",name:"ICON-D2 EPS",   model:"icon_d2",                  fam:"ens" },
  { id:"geps",    name:"GEPS",           model:"gem_global",               fam:"ens" },
  { id:"mogreps", name:"MOGREPS-G",      model:"ukmo_global_ensemble_20km",fam:"ens" },
  { id:"mogrepsuk",name:"MOGREPS-UK",    model:"ukmo_uk_ensemble_2km",     fam:"ens" },
];
const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700];
const OM_VARS_DET = ["temperature_2m","dew_point_2m","wind_speed_10m","wind_direction_10m","wind_gusts_10m","visibility","weather_code","cloud_cover","cloud_cover_low","cloud_cover_mid","precipitation","snowfall","pressure_msl",
  ...LEVELS.map(l => `cloud_cover_${l}hPa`), ...LEVELS.map(l => `geopotential_height_${l}hPa`)];
const OM_VARS_ENS = ["temperature_2m","dew_point_2m","wind_speed_10m","wind_direction_10m","wind_gusts_10m","visibility","weather_code","cloud_cover","precipitation","snowfall"];
const OM_MIN = ["temperature_2m","dew_point_2m","wind_speed_10m","wind_direction_10m","wind_gusts_10m","weather_code","cloud_cover","precipitation"];
const VMAP = { temperature_2m:"t", dew_point_2m:"td", wind_speed_10m:"ws", wind_direction_10m:"dir", wind_gusts_10m:"wg", visibility:"vis", weather_code:"wc", cloud_cover:"cc", cloud_cover_low:"ccl", cloud_cover_mid:"ccm", precipitation:"pr", snowfall:"sf", pressure_msl:"slp" };
LEVELS.forEach(l => { VMAP[`cloud_cover_${l}hPa`] = "c" + l; VMAP[`geopotential_height_${l}hPa`] = "z" + l; });
const VKEYS = Object.keys(VMAP).sort((a, b) => b.length - a.length);

function makeTimeline(startMs, endMs){ const t0 = Math.floor(startMs/H)*H; const n = Math.ceil((endMs - t0)/H) + 1; return { t0, n, idx: ms => Math.round((ms - t0)/H) }; }
function blankMember(TL){ const m = {}; ["t","td","spd","dir","vis","ceil","pop","ptyp","wc","cc","ccl","pr","sf"].forEach(k => m[k] = new Array(TL.n).fill(undefined)); return m; }
function fillGaps(arr, maxGap){
  let last = -1;
  for (let i = 0; i < arr.length; i++){
    if (arr[i] == null || typeof arr[i] !== "number") continue;
    if (last >= 0 && i - last > 1 && i - last <= maxGap) for (let j = last + 1; j < i; j++) arr[j] = arr[last] + (arr[i] - arr[last])*(j - last)/(i - last);
    last = i;
  }
}
function finishMember(m, TL){ ["t","td","spd"].forEach(k => fillGaps(m[k], m.gap || 3)); return m; }

/* lowest level at or above BKN (60 %) from the pressure-level cloud profile, feet above the station */
function profileCeiling(m, i, elevM){
  let have = false;
  for (const l of LEVELS){
    const c = m["c" + l] && m["c" + l][i], z = m["z" + l] && m["z" + l][i];
    if (c == null || z == null) continue; have = true;
    const agl = (z - elevM)*3.281; if (agl < 0) continue;
    if (c >= 60) return Math.max(100, Math.round(agl/100)*100);
  }
  if (have) return null;
  return undefined;
}
async function fetchOM(def, ens, stations, TL){
  const base = ens ? "https://ensemble-api.open-meteo.com/v1/ensemble" : "https://api.open-meteo.com/v1/forecast";
  const days = Math.min(16, Math.max(3, Math.ceil((TL.t0 + TL.n*H - Date.now())/86400e3) + 1));
  const url = vars => `${base}?latitude=${stations.map(s => s.lat).join(",")}&longitude=${stations.map(s => s.lon).join(",")}&hourly=${vars.join(",")}&models=${def.model}&wind_speed_unit=kn&timezone=GMT&timeformat=unixtime&past_days=2&forecast_days=${days}`;
  let js = null, lastErr = null;
  for (const vars of [ens ? OM_VARS_ENS : OM_VARS_DET, OM_MIN, OM_MIN.filter(v => v !== "weather_code")]){
    try { js = await getJSON(url(vars), 45000); break; }
    catch (e){ lastErr = e; if (e.status !== 400) throw e; }
  }
  if (!js) throw lastErr;
  const arr = Array.isArray(js) ? js : [js];
  return stations.map((st, si) => {
    const hr = (arr[si] || {}).hourly || {}, times = hr.time || [];
    const mem = new Map();
    for (const key of Object.keys(hr)){
      if (key === "time") continue;
      const b = VKEYS.find(vk => key === vk || key.startsWith(vk + "_")); if (!b) continue;
      const q = key.slice(b.length).match(/member(\d+)/); const mi = q ? +q[1] : 0;
      if (!mem.has(mi)) mem.set(mi, blankMember(TL));
      const out = mem.get(mi)[VMAP[b]] = new Array(TL.n).fill(undefined), vals = hr[key];
      for (let j = 0; j < times.length; j++){ const i = TL.idx(times[j]*1000); if (i >= 0 && i < TL.n && vals[j] != null) out[i] = vals[j]; }
    }
    const members = [...mem.values()].filter(m => m.t && m.t.some(v => v != null));
    members.forEach(m => {
      m.spd = m.ws.map((w, i) => w == null ? undefined : Math.max(w, m.wg[i] ?? 0));
      m.ceil = m.t.map((_, i) => {
        const pc = profileCeiling(m, i, st.elev);
        if (pc !== undefined) return pc;
        if (ens) return undefined;
        const low = m.ccl && m.ccl[i], all = m.cc && m.cc[i];
        if (low == null && all == null) return undefined;
        if (low != null && low >= 62.5) return 1500;
        if (m.ccm && m.ccm[i] != null && m.ccm[i] >= 62.5) return 8000;
        return null;
      });
      m.gap = ens ? 6 : 3; finishMember(m, TL);
    });
    return members;
  });
}

/* WMO weather code -> TFC present weather category */
function wcCats(wc, t, td, vis){
  const s = new Set();
  if (wc == null) return s;
  if (wc === 56 || wc === 57 || wc === 66 || wc === 67) s.add(WX.FZ);
  else if ((wc >= 71 && wc <= 77) || wc === 85 || wc === 86) s.add(WX.FROZ);
  else if ((wc >= 51 && wc <= 55) || (wc >= 61 && wc <= 65) || (wc >= 80 && wc <= 82) || wc >= 95) s.add(t != null && t <= 0 && wc < 95 ? WX.FROZ : WX.LIQ);
  if (!s.size){
    if (wc === 45 || wc === 48) s.add(WX.NPH);
    else if (vis != null && vis < 5000) s.add(t != null && td != null && t - td <= 3 ? WX.NPH : WX.LITH);
  }
  return s;
}

/* ---------- one hour's samples ---------- */
function sampleFromMember(m, TL, t, src){
  const i0 = TL.idx(t), i1 = i0 + 1; if (i1 >= TL.n || i0 < 0) return null;
  const v = (a, i) => a ? a[i] : undefined;
  const pick = (a) => v(a, i1) ?? v(a, i0);
  const sp = [v(m.spd, i0), v(m.spd, i1)].filter(x => x != null);
  const vis = [v(m.vis, i0), v(m.vis, i1)].filter(x => x != null);
  const ce = [v(m.ceil, i0), v(m.ceil, i1)];
  let ceil; if (ce.every(x => x === undefined)) ceil = undefined; else { const n = ce.filter(x => x != null); ceil = n.length ? Math.min(...n) : null; }
  let T = pick(m.t), Td = pick(m.td), S = sp.length ? Math.max(...sp) : null;
  if (src && src.bias){ if (T != null && src.bias.t) T -= src.bias.t; if (Td != null && src.bias.td) Td -= src.bias.td; if (S != null && src.bias.spd) S = Math.max(0, S - src.bias.spd); }
  if (T != null && Td != null && Td > T) Td = T;
  const V = vis.length ? Math.min(...vis) : null;
  let cats;
  if (m.wc && pick(m.wc) !== undefined) cats = wcCats(pick(m.wc), T, Td, V);
  else if (m.pop && pick(m.pop) != null) cats = null;   /* MOS: split below */
  return { t:T, td:Td, spd:S, dir: pick(m.dir) ?? null, vis:V, ceil, cats, mos: m.pop && pick(m.pop) != null ? { pop:pick(m.pop), typ:pick(m.ptyp) } : null };
}
