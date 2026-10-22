"use strict";
/* ============================================================
   Thor's Forecast Challenge 2026 - core
   METAR / TAF parsing, the TFC26 scoring chart, and an
   expected-score optimizer that picks each value to maximise
   the points the grader is likely to award.
   ============================================================ */
const H = 3600e3;
const KT_PER_MPS = 1.943844;

/* ---------- competition days (from the TFC26 scenario) ---------- */
const DAYS = [
  { n:1, title:"Alaska Mobilization",          suspense:"2026-10-21T23:59Z", blocks:[["PAED","2026-10-22T06Z"],["PAEI","2026-10-22T06Z"]] },
  { n:2, title:"Canadian Arctic Staging",      suspense:"2026-10-22T23:59Z", blocks:[["CYQX","2026-10-23T04Z"],["CYYR","2026-10-23T04Z"],["CYFB","2026-10-23T06Z"]] },
  { n:3, title:"Greenland ISR Staging",        suspense:"2026-10-23T23:59Z", blocks:[["BGSF","2026-10-26T06Z"]], outlook:{ icao:"ETAR", from:"2026-10-26", days:3, callout:["2026-10-28T06Z","2026-10-28T12Z"] } },
  { n:4, title:"Highland QRF Planning",        suspense:"2026-10-26T23:59Z", blocks:[["EGQS","2026-10-27T06Z"]] },
  { n:5, title:"Central European Defensive Staging", suspense:"2026-10-27T23:59Z", blocks:[["ETAR","2026-10-28T06Z"]] },
  { n:6, title:"Redeployment and Reconstitution", suspense:"2026-10-28T23:59Z", blocks:[["ETAR","2026-10-29T03Z"],["KBGR","2026-10-29T06Z"]] },
];
const isoZ = s => Date.parse(s.replace(/T(\d\d)Z$/, "T$1:00:00Z").replace(/T(\d\d):(\d\d)Z$/, "T$1:$2:00Z"));
/* known stations (lat, lon, elevation m); anything else is looked up */
const STATIONS = {
  PAED:{ name:"Joint Base Elmendorf-Richardson", lat:61.2510, lon:-149.8063, elev:65 },
  PAEI:{ name:"Eielson AFB",                    lat:64.6657, lon:-147.1015, elev:167 },
  CYQX:{ name:"Gander International",           lat:48.9369, lon:-54.5681,  elev:151 },
  CYYR:{ name:"Goose Bay",                      lat:53.3192, lon:-60.4258,  elev:49 },
  CYFB:{ name:"Iqaluit",                        lat:63.7564, lon:-68.5558,  elev:34 },
  BGSF:{ name:"Kangerlussuaq",                  lat:67.0122, lon:-50.7116,  elev:50 },
  EGQS:{ name:"RAF Lossiemouth",                lat:57.7052, lon:-3.3392,   elev:13 },
  ETAR:{ name:"Ramstein Air Base",              lat:49.4369, lon:7.6003,    elev:237 },
  KBGR:{ name:"Bangor International",           lat:44.8074, lon:-68.8281,  elev:59 },
};

/* ---------- small helpers ---------- */
const p2 = n => String(n).padStart(2, "0");
const p3 = n => String(n).padStart(3, "0");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };
const zstr = ms => { const d = new Date(ms); return `${p2(d.getUTCDate())}/${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}Z`; };

/* ---------- visibility: reportable meters and SM conversion (AF practice) ---------- */
const VIS_M = [0,100,200,300,400,500,600,700,800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000,2100,2200,2400,2600,2800,3000,3200,3400,3600,3700,4000,4400,4500,4800,5000,6000,7000,8000,9000,9999];
const SM_TO_M = [[0,0],[1/16,100],[1/8,200],[3/16,300],[1/4,400],[5/16,500],[3/8,600],[1/2,800],[5/8,1000],[3/4,1200],[7/8,1400],[1,1600],[9/8,1800],[5/4,2000],[11/8,2200],[3/2,2400],[13/8,2600],[7/4,2800],[15/8,3000],[2,3200],[9/4,3600],[5/2,4000],[11/4,4400],[3,4800],[4,6000],[5,8000],[6,9000],[7,9999]];
function smToM(sm){ if (sm >= 7) return 9999; let best = 0; for (const [s, m] of SM_TO_M) if (s <= sm + 1e-9) best = m; return best; }
const snapVis = m => { if (m == null) return null; if (m >= 9000) return m >= 9500 ? 9999 : 9000; let r = 0; for (const v of VIS_M) if (v <= m) r = v; return r; };

/* ---------- present weather categories (the TFC26 workbook list) ---------- */
const WX = { NONE:"", LIQ:"Liquid", FZ:"Freezing", FROZ:"Frozen", LITH:"Lithometer", NPH:"Non-Precip Hydrometer" };
const WX_LIST = ["", "Liquid", "Freezing", "Frozen", "Lithometer", "Non-Precip Hydrometer"];
const WX_RANK = { "Freezing":5, "Frozen":4, "Liquid":3, "Non-Precip Hydrometer":2, "Lithometer":1, "":0 };
/* categories for one weather token (vicinity and recent weather are not scored) */
function wxCats(tok){
  const out = new Set();
  if (/^(VC|RE)/.test(tok)) return out;
  const t = tok.replace(/^[+-]/, "");
  const fz = /^FZ/.test(t);
  const precip = t.match(/(DZ|RA|SN|SG|IC|PL|GR|GS|UP)/g) || [];
  for (const p of precip){
    if (fz && (p === "DZ" || p === "RA")) out.add(WX.FZ);
    else if (p === "DZ" || p === "RA") out.add(WX.LIQ);
    else if (p === "UP") out.add(WX.LIQ);
    else out.add(WX.FROZ);
  }
  if (/(BR|FG)/.test(t) || /^(BL|DR)SN/.test(t)) out.add(WX.NPH);
  if (/(HZ|FU|DU|SA|VA|PO|SS|DS)/.test(t) && !/(BL|DR)SN/.test(t)) out.add(WX.LITH);
  if (/^(BL|DR)SN/.test(t)) out.delete(WX.FROZ);
  return out;
}
const WX_TOKEN = /^(\+|-|VC|RE)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(TS)?((DZ|RA|SN|SG|IC|PL|GR|GS|UP)+|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)?$/;
const isWxTok = t => t.length >= 2 && WX_TOKEN.test(t) && !/^\d/.test(t) && t !== "RE";

/* ---------- element parsing shared by METAR and TAF ---------- */
function parseElements(tokens, out){
  out = out || {};
  for (let k = 0; k < tokens.length; k++){
    const t = tokens[k];
    let m;
    if ((m = t.match(/^(\d{3}|VRB|\/\/\/)(\d{2,3}|\/\/)(?:G(\d{2,3}))?(KT|MPS|KMH)$/))){
      const f = m[4] === "MPS" ? KT_PER_MPS : m[4] === "KMH" ? 0.539957 : 1;
      out.vrb = m[1] === "VRB"; out.dir = /^\d/.test(m[1]) ? +m[1] : null;
      out.spd = /^\d/.test(m[2]) ? Math.round(+m[2]*f) : null; out.gst = m[3] ? Math.round(+m[3]*f) : null;
      if (out.spd === 0 && out.dir === 0) out.calm = true;
      continue;
    }
    if (/^\d{3}V\d{3}$/.test(t)) continue;
    if (t === "CAVOK"){ out.vis = 9999; out.clouds = []; out.wx = []; out.cavok = true; continue; }
    if ((m = t.match(/^(\d{4})(NDV|[NSEW]{1,2})?$/)) && !out.visSet){ out.vis = +m[1]; out.visSet = true; continue; }
    /* US statute miles: "10SM", "P6SM", "M1/4SM", "1/2SM", or "1 1/2SM" across two tokens */
    if ((m = t.match(/^([PM])?(\d+)?(?:\/(\d+))?SM$/))){
      let sm = m[3] ? +m[2]/+m[3] : +m[2];
      if (m[1] === "P") sm = Math.max(sm, 7);
      out.vis = smToM(sm); out.visSet = true; continue;
    }
    if (/^\d$/.test(t) && tokens[k + 1] && /^\d\/\dSM$/.test(tokens[k + 1])){
      const [a, b] = tokens[k + 1].replace("SM", "").split("/").map(Number);
      out.vis = smToM(+t + a/b); out.visSet = true; k++; continue;
    }
    if ((m = t.match(/^(FEW|SCT|BKN|OVC)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/))){ (out.clouds = out.clouds || []).push({ amt:m[1], h: /\d/.test(m[2]) ? +m[2]*100 : null, cb: m[3] === "CB" }); continue; }
    if ((m = t.match(/^VV(\d{3}|\/\/\/)$/))){ (out.clouds = out.clouds || []).push({ amt:"VV", h: /\d/.test(m[1]) ? +m[1]*100 : 0 }); continue; }
    if (/^(SKC|CLR|NSC|NCD)$/.test(t)){ out.clouds = []; continue; }
    if (t === "NSW"){ out.wx = []; out.nsw = true; continue; }
    if ((m = t.match(/^(M?\d{2})\/(M?\d{2})?$/))){ const c = s => s == null ? null : (s[0] === "M" ? -(+s.slice(1)) : +s); out.t = c(m[1]); out.td = c(m[2]); continue; }
    if (isWxTok(t)){ (out.wx = out.wx || []).push(t); continue; }
  }
  return out;
}
const ceilingOf = clouds => { if (!clouds) return undefined; const c = clouds.filter(x => x.amt === "BKN" || x.amt === "OVC" || x.amt === "VV").map(x => x.h ?? 0); return c.length ? Math.min(...c) : null; };
const wxCatsOf = wx => { const s = new Set(); (wx || []).forEach(t => wxCats(t).forEach(c => s.add(c))); return s; };

/* METAR / SPECI.  time is taken from the report, anchored near refMs. */
function parseMETAR(raw, refMs){
  const txt = raw.replace(/=+\s*$/, "").trim();
  let body = txt.split(/\s(?:RMK|TEMPO|BECMG|NOSIG)(?:\s|$)/)[0];
  const tok = body.split(/\s+/);
  let p = 0, special = false;
  if (tok[p] === "METAR" || tok[p] === "SPECI"){ special = tok[p] === "SPECI"; p++; }
  const icao = tok[p++];
  const tm = (tok[p] || "").match(/^(\d{2})(\d{2})(\d{2})Z$/); if (!tm) return null; p++;
  const t = anchorDay(+tm[1], +tm[2], +tm[3], refMs);
  while (tok[p] === "AUTO" || tok[p] === "COR" || tok[p] === "NIL") p++;
  const e = parseElements(tok.slice(p), { wx:[], clouds:undefined });
  return { raw:txt, icao, time:t, special, ...e, ceil: ceilingOf(e.clouds), cats: wxCatsOf(e.wx) };
}
function anchorDay(dd, hh, mi, refMs){
  const r = new Date(refMs || Date.now());
  let best = null;
  for (const mo of [-1, 0, 1]){
    const t = Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + mo, dd, hh, mi);
    if (new Date(t).getUTCDate() !== dd && hh < 24) continue;
    if (best == null || Math.abs(t - refMs) < Math.abs(best - refMs)) best = t;
  }
  return best;
}

/* ---------- observed values for one scoring hour (as the grader is assumed to read them) ---------- */
function hourObs(obs, start){
  const inH = obs.filter(o => o.time >= start && o.time < start + H);
  if (!inH.length) return null;
  let maxO = null, maxW = -1;
  for (const o of inH){ const w = Math.max(o.spd ?? -1, o.gst ?? -1); if (w > maxW){ maxW = w; maxO = o; } }
  const vis = inH.map(o => o.vis).filter(v => v != null);
  const ceils = inH.map(o => o.ceil).filter(v => v !== undefined);
  const cats = new Set(); inH.forEach(o => o.cats.forEach(c => cats.add(c)));
  const routine = inH.filter(o => !o.special); const tOb = (routine.length ? routine : inH)[(routine.length ? routine : inH).length - 1];
  return {
    n: inH.length, list: inH,
    spd: maxW < 0 ? null : maxW,
    dir: maxO ? (maxO.vrb ? "VRB" : maxO.calm || maxW === 0 ? 0 : maxO.dir) : null,
    vis: vis.length ? Math.min(...vis) : null,
    ceil: ceils.length ? (ceils.some(c => c != null) ? Math.min(...ceils.filter(c => c != null)) : null) : undefined,
    cats, wx: [...cats].sort((a, b) => WX_RANK[b] - WX_RANK[a])[0] || "",
    t: tOb ? tOb.t : null, td: tOb ? tOb.td : null, temps: inH.map(o => [o.t, o.td]),
  };
}

/* ---------- TFC26 scoring chart ---------- */
/* Present weather points: WX_MATRIX[observed][forecast] (commissioner's grading table).
   Freezing is the only category with penalties: -2 for forecasting it when it doesn't occur,
   and -2 for any other forecast (including blank) when it does. */
const WX_MATRIX = {
  "Freezing":              { "Freezing":6,  "Frozen":-2, "Liquid":-2, "Non-Precip Hydrometer":-2, "Lithometer":-2, "":-2 },
  "Frozen":                { "Freezing":-2, "Frozen":4,  "Liquid":0,  "Non-Precip Hydrometer":0,  "Lithometer":0,  "":0 },
  "Liquid":                { "Freezing":-2, "Frozen":0,  "Liquid":4,  "Non-Precip Hydrometer":0,  "Lithometer":0,  "":0 },
  "Non-Precip Hydrometer": { "Freezing":-2, "Frozen":0,  "Liquid":0,  "Non-Precip Hydrometer":2,  "Lithometer":0,  "":0 },
  "Lithometer":            { "Freezing":-2, "Frozen":0,  "Liquid":0,  "Non-Precip Hydrometer":0,  "Lithometer":2,  "":0 },
  "":                      { "Freezing":-2, "Frozen":0,  "Liquid":0,  "Non-Precip Hydrometer":0,  "Lithometer":0,  "":0 },
};
const DEFAULT_RULES = {
  version: 4,
  minWxProb: 0,            /* only forecast a weather type when its chance is at least this (%); 0 = pure expected score */
  wxNoneCode: "",          /* what goes in the workbook for no significant weather: blank */
  noCeilCode: "",          /* leave Min Cig blank when no ceiling is expected; full points if none occurs */
  tempPenalty: 3,          /* temp/dew point -1 when this many degrees or more off */
  tempAnyOb: true,         /* commissioner: SPECIs count, so temp/dew is checked against every report in the hour */
  confirmed: true,
};
/* which row of the matrix an hour's observed categories fall in, for a given forecast */
function wxRow(oCats, f){
  if (oCats.has(WX.FZ)) return WX.FZ;
  if (f && oCats.has(f)) return f;
  return [...oCats].sort((a, b) => WX_RANK[b] - WX_RANK[a])[0] || "";
}
function scoreDir(f, o){
  if (o == null || f == null || f === "") return null;
  if (o === "VRB") return 0;
  if (+o === 0 || +f === 0){ return (+o === 0 && +f === 0) ? 3 : 0; }
  const d = angDiff(+f, +o); return d <= 10 ? 3 : d <= 20 ? 2 : d <= 30 ? 1 : 0;
}
function scoreSpd(f, o){ if (o == null || f == null || f === "") return null; const d = Math.abs(+f - o); return d <= 2 ? 3 : d <= 3 ? 2 : d <= 4 ? 1 : d >= 8 ? -1 : 0; }
function scoreVis(f, o){ if (o == null || f == null || f === "") return null; const a = +f >= 9000 && +f !== 9000 ? 9999 : +f, b = o; if (a === b) return 6; const d = Math.abs(a - b); return d <= 400 ? 4 : d <= 800 ? 2 : d >= 1600 ? -2 : 0; }
function scoreWx(f, oCats, R){
  if (!oCats) return null;
  f = f === "None" ? "" : (f || "");
  const row = WX_MATRIX[wxRow(oCats, f)];
  return row && row[f] !== undefined ? row[f] : 0;
}
function scoreCeil(f, o, R){
  if (o === undefined || f == null) return null;
  const fNone = f === "" || f === R.noCeilCode || f === "NONE";
  if (o === null) return fNone ? 6 : 0;
  if (fNone) return 0;
  const d = Math.abs(+f*100 - o); return d <= 200 ? 6 : d <= 400 ? 4 : d <= 1000 ? 2 : 0;
}
const parseTemp = s => { if (s == null || s === "") return null; s = String(s).trim().toUpperCase(); const neg = s[0] === "M" || s[0] === "-"; const n = parseInt(s.replace(/^[M-]/, ""), 10); return isFinite(n) ? (neg ? -n : n) : null; };
function scoreTemp(f, o, list, R){
  const fv = parseTemp(f); if (fv == null || o == null) return null;
  const vals = R.tempAnyOb && list && list.length ? list.filter(v => v != null) : [o];
  if (vals.some(v => v === fv)) return 1;
  return vals.every(v => Math.abs(v - fv) >= (R.tempPenalty || 3)) ? -1 : 0;
}
const fmtTemp = v => v == null ? "" : (v < 0 ? "M" : "") + p2(Math.abs(Math.round(v)));
function gradeHour(fc, ob, R){
  if (!ob) return null;
  return {
    dir: scoreDir(fc.dir, ob.dir), spd: scoreSpd(fc.spd, ob.spd), vis: scoreVis(fc.vis, ob.vis),
    wx: scoreWx(fc.wx, ob.cats, R), ceil: scoreCeil(fc.ceil, ob.ceil, R),
    t: scoreTemp(fc.t, ob.t, ob.temps.map(x => x[0]), R), td: scoreTemp(fc.td, ob.td, ob.temps.map(x => x[1]), R),
  };
}
const ELEMENTS = [
  { k:"dir", label:"Wind Dir", sub:"ddd", max:3 },
  { k:"spd", label:"Wnd Spd", sub:"kt, max", max:3 },
  { k:"vis", label:"Sfc Vis", sub:"m, lowest", max:6 },
  { k:"wx",  label:"Present Wx", sub:"", max:6 },
  { k:"ceil",label:"Min Cig", sub:"hhh", max:6 },
  { k:"t",   label:"Temp", sub:"°C", max:1 },
  { k:"td",  label:"Dew Point", sub:"°C", max:1 },
];

/* ============================================================
   Expected-score optimizer
   Input: weighted samples (each a possible outcome for the hour).
   Each continuous element is smoothed with a kernel, turned into a
   probability for every reportable observed value, and every candidate
   forecast is scored against that distribution.
   ============================================================ */
const normCdf = x => { const t = 1/(1 + 0.2316419*Math.abs(x)); const d = 0.3989423*Math.exp(-x*x/2); const p = d*t*(0.3193815 + t*(-0.3565638 + t*(1.781478 + t*(-1.821256 + t*1.330274)))); return x > 0 ? 1 - p : p; };
const wOf = (s, key) => s.wk && s.wk[key] != null ? s.wk[key] : s.w;
function discreteNormal(samples, key, lo, hi, step, sigma){
  const n = Math.round((hi - lo)/step) + 1, pr = new Float64Array(n); let W = 0;
  for (const s0 of samples){
    const v = s0[key]; if (v == null || !isFinite(v)) continue;
    const s = { w: wOf(s0, key), sd: s0.sd };
    const sg = sigma + (s.sd ? s.sd : 0);
    for (let j = 0; j < n; j++){ const c = lo + j*step; const a = (c - step/2 - v)/sg, b = (c + step/2 - v)/sg; if (b < -6 || a > 6) continue; pr[j] += s.w*(normCdf(b) - normCdf(a)); }
    W += s.w;
  }
  if (W <= 0) return null;
  for (let j = 0; j < n; j++) pr[j] /= W;
  return { lo, step, pr, W };
}
function best(cands, ev){ let b = null; for (const c of cands){ const e = ev(c); if (!b || e > b.ev + 1e-9) b = { v:c, ev:e }; } return b; }
function rank(cands, ev, n){ return cands.map(c => ({ v:c, ev:ev(c) })).sort((a, b) => b.ev - a.ev).slice(0, n || 5); }

function optimizeHour(samples, R, opts){
  opts = opts || {};
  const res = {};
  /* temperature & dew point: integer outcomes, +1 exact, -1 when 5 or more off */
  for (const key of ["t", "td"]){
    const d = discreteNormal(samples, key, -60, 50, 1, opts.sigT ?? 0.9);
    if (!d){ res[key] = null; continue; }
    const P = j => d.pr[j] || 0, idx = v => v - d.lo;
    const pen = R.tempPenalty || 3;
    const ev = c => { let e = P(idx(c)); for (let j = 0; j < d.pr.length; j++){ const v = d.lo + j; if (Math.abs(v - c) >= pen) e -= d.pr[j]; } return e; };
    let mode = 0, mp = -1; d.pr.forEach((p, j) => { if (p > mp){ mp = p; mode = d.lo + j; } });
    const cands = []; for (let c = mode - 4; c <= mode + 4; c++) cands.push(c);
    const b = best(cands, ev); res[key] = { v:b.v, ev:b.ev, alts: rank(cands, ev, 5), dist:d, fmt: fmtTemp(b.v), evf: s => { const v = parseTemp(s); return v == null ? null : ev(v); } };
  }
  /* wind speed (max in hour) */
  {
    const d = discreteNormal(samples, "spd", 0, 90, 1, opts.sigS ?? 2.2);
    if (d){
      const sc = (c, v) => { const x = Math.abs(c - v); return x <= 2 ? 3 : x <= 3 ? 2 : x <= 4 ? 1 : x >= 8 ? -1 : 0; };
      const ev = c => { let e = 0; d.pr.forEach((p, j) => { if (p) e += p*sc(c, j); }); return e; };
      const cands = Array.from({ length:80 }, (_, i) => i);
      const b = best(cands, ev); res.spd = { v:b.v, ev:b.ev, alts: rank(cands, ev, 5), dist:d, fmt: p2(b.v), evf: s => s === "" || s == null ? null : ev(+s) };
    } else res.spd = null;
  }
  /* wind direction: circular kernel, calm separate, VRB scores 0 for everyone */
  {
    const pr = new Float64Array(36); let pCalm = 0, pVrb = 0, W = 0;
    const sig = opts.sigD ?? 18;
    for (const s0 of samples){
      if (s0.spd == null && s0.dir == null) continue;
      const s = { ...s0, w: wOf(s0, "dir") };
      W += s.w;
      if (s.spd != null && s.spd < 1){ pCalm += s.w; continue; }
      if (s.dir == null){ pVrb += s.w; continue; }
      if (s.spd != null && s.spd <= 3){ pVrb += s.w*0.5; }
      const w = s.w*(s.spd != null && s.spd <= 3 ? 0.5 : 1);
      let z = 0; const tmp = new Float64Array(36);
      for (let j = 0; j < 36; j++){ const dd = angDiff(j*10 || 360, s.dir); tmp[j] = Math.exp(-0.5*(dd/sig)**2); z += tmp[j]; }
      for (let j = 0; j < 36; j++) pr[j] += w*tmp[j]/z;
    }
    if (W > 0){
      for (let j = 0; j < 36; j++) pr[j] /= W; pCalm /= W; pVrb /= W;
      const ev = c => { if (c === 0) return 3*pCalm; let e = 0; for (let j = 0; j < 36; j++){ const dd = angDiff(c, (j*10) || 360); e += pr[j]*(dd <= 10 ? 3 : dd <= 20 ? 2 : dd <= 30 ? 1 : 0); } return e; };
      const cands = [0, ...Array.from({ length:36 }, (_, i) => (i + 1)*10)];
      const b = best(cands, ev); res.dir = { v:b.v, ev:b.ev, alts: rank(cands, ev, 5), pCalm, pVrb, fmt: p3(b.v), evf: s => s === "" || s == null ? null : ev(+s === 360 ? 360 : +s) };
    } else res.dir = null;
  }
  /* visibility: log-space kernel onto the reportable values */
  {
    const outs = VIS_M, pr = new Float64Array(outs.length); let W = 0;
    const sig = opts.sigV ?? 0.18;
    for (const s0 of samples){
      if (s0.vis == null) continue; const s = { ...s0, w: wOf(s0, "vis") }; W += s.w;
      const lv = Math.log10(Math.max(50, s.vis));
      const edges = outs.map((v, j) => j === outs.length - 1 ? Infinity : Math.log10(Math.max(50, (v + outs[j + 1])/2)));
      let prev = -Infinity;
      for (let j = 0; j < outs.length; j++){ const a = (prev - lv)/sig, b = (edges[j] - lv)/sig; pr[j] += s.w*((b === Infinity ? 1 : normCdf(b)) - (a === -Infinity ? 0 : normCdf(a))); prev = edges[j]; }
    }
    if (W > 0){
      for (let j = 0; j < pr.length; j++) pr[j] /= W;
      const ev = c => { let e = 0; outs.forEach((o, j) => { const p = pr[j]; if (!p) return; const d = Math.abs(c - o); e += p*(d === 0 ? 6 : d <= 400 ? 4 : d <= 800 ? 2 : d >= 1600 ? -2 : 0); }); return e; };
      const b = best(outs, ev); res.vis = { v:b.v, ev:b.ev, alts: rank(outs, ev, 5), pr, fmt: String(b.v).padStart(4, "0"), evf: s => s === "" || s == null ? null : ev(+s >= 9500 ? 9999 : +s) };
    } else res.vis = null;
  }
  /* ceiling: hundreds of feet in log space, plus "no ceiling" */
  {
    const outs = []; for (let h = 0; h <= 30; h++) outs.push(h); for (let h = 35; h <= 100; h += 5) outs.push(h); for (let h = 110; h <= 250; h += 10) outs.push(h);
    const pr = new Float64Array(outs.length); let pNone = 0, W = 0;
    const sig = opts.sigC ?? 0.22;
    for (const s0 of samples){
      if (s0.ceil === undefined) continue; const s = { ...s0, w: wOf(s0, "ceil") }; W += s.w;
      if (s.ceil === null){ pNone += s.w; continue; }
      const lv = Math.log10(Math.max(50, s.ceil));
      let z = 0; const tmp = outs.map(h => { const x = Math.exp(-0.5*((Math.log10(Math.max(50, h*100)) - lv)/sig)**2); z += x; return x; });
      tmp.forEach((x, j) => pr[j] += s.w*x/z);
    }
    if (W > 0){
      for (let j = 0; j < pr.length; j++) pr[j] /= W; pNone /= W;
      const ev = c => { if (c === "NONE") return 6*pNone; let e = 0; outs.forEach((h, j) => { const p = pr[j]; if (!p) return; const d = Math.abs(c*100 - h*100); e += p*(d <= 200 ? 6 : d <= 400 ? 4 : d <= 1000 ? 2 : 0); }); return e; };
      const cands = ["NONE", ...outs];
      const b = best(cands, ev); res.ceil = { v:b.v, ev:b.ev, alts: rank(cands, ev, 5), pNone, fmt: b.v === "NONE" ? R.noCeilCode : p3(b.v), evf: s => s == null ? null : (s === "" || s === R.noCeilCode || String(s).toUpperCase() === "NONE") ? ev("NONE") : ev(+s) };
    } else res.ceil = null;
  }
  /* present weather: probability of each category from the samples */
  {
    const P = { "":0, "Liquid":0, "Freezing":0, "Frozen":0, "Lithometer":0, "Non-Precip Hydrometer":0 }; let W = 0;
    /* a sample with freezing precipitation counts in the Freezing row; mixed types split their weight */
    for (const s0 of samples){ if (!s0.cats) continue; const w = wOf(s0, "wx"); W += w; if (!s0.cats.size) P[""] += w; else if (s0.cats.has(WX.FZ)) P[WX.FZ] += w; else s0.cats.forEach(c => P[c] += w/s0.cats.size); }
    if (W > 0){
      for (const k in P) P[k] /= W;
      const pOf = c => P[c] || 0;
      const evM = c => { let e = 0; for (const o in P) e += P[o]*WX_MATRIX[o][c]; return e; };
      const ev = c => (c !== "" && pOf(c) < (R.minWxProb || 0)/100) ? -Infinity : evM(c);   /* below the minimum chance: not a candidate */
      const evRaw = c => evM(c);
      const b = best(WX_LIST, ev); res.wx = { v:b.v, ev:b.ev, alts: rank(WX_LIST, evRaw, 6), P, fmt:b.v, evf: s => evRaw(s === "None" ? "" : (s || "")) };
    } else res.wx = null;
  }
  return res;
}

/* ============================================================
   TAF parsing into hourly prevailing / temporary states
   ============================================================ */
function parseTAF(raw, refMs){
  const txt = raw.replace(/\s+/g, " ").replace(/=\s*$/, "").trim();
  const tok = txt.split(" ");
  let p = 0;
  if (tok[p] === "TAF") p++;
  while (tok[p] === "AMD" || tok[p] === "COR") p++;
  const icao = tok[p++];
  let issue = null; const im = (tok[p] || "").match(/^(\d{2})(\d{2})(\d{2})Z$/); if (im){ issue = anchorDay(+im[1], +im[2], +im[3], refMs); p++; }
  const vm = (tok[p] || "").match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/); if (!vm) return null; p++;
  const ref = issue || refMs;
  const dt = (dd, hh, mi) => { const add = +hh === 24 ? 1 : 0; return anchorDay(+dd, add ? 0 : +hh, +(mi || 0), ref) + (add ? 24*H : 0); };
  const vs = dt(vm[1], vm[2]), ve = dt(vm[3], vm[4]);
  const groups = []; let cur = { kind:"BASE", a:vs, b:ve, tokens:[] };
  const push = () => { groups.push(cur); };
  for (; p < tok.length; p++){
    const t = tok[p]; let m;
    if ((m = t.match(/^FM(\d{2})(\d{2})(\d{2})$/))){ push(); cur = { kind:"FM", a:dt(m[1], m[2], m[3]), b:ve, tokens:[] }; continue; }
    if (t === "BECMG" || t === "TEMPO" || /^PROB\d{2}$/.test(t)){
      push(); let kind = t, prob = null;
      if (/^PROB/.test(t)){ prob = +t.slice(4)/100; if (tok[p + 1] === "TEMPO"){ kind = "PROBTEMPO"; p++; } else kind = "PROB"; }
      const tm = (tok[p + 1] || "").match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/);
      let a = vs, b = ve; if (tm){ a = dt(tm[1], tm[2]); b = dt(tm[3], tm[4]); p++; }
      cur = { kind, prob, a, b, tokens:[] }; continue;
    }
    if (t === "RMK") break;
    cur.tokens.push(t);
  }
  push();
  groups.forEach(g => { const toks = g.tokens.filter(x => !/^(QNH|TX|TN|WS|[56]\d{5}|LAST|NXT|NEXT|AMDS|AFT)/.test(x)); g.el = parseElements(toks, {}); });
  return { raw:txt, icao, issue, vs, ve, groups };
}
/* state for an hour starting at t: prevailing plus weighted alternates */
function tafHour(taf, t, wTempo){
  if (!taf || t < taf.vs || t >= taf.ve) return null;
  const mid = t + H/2;
  let prev = {};
  const apply = (base, el) => { const s = { ...base }; for (const k of ["dir","spd","gst","vrb","calm","vis","clouds","wx"]) if (el[k] !== undefined) s[k] = el[k]; if (el.cavok){ s.clouds = []; s.wx = []; } if (el.nsw) s.wx = []; return s; };
  const alts = [];
  for (const g of taf.groups){
    if (g.kind === "BASE" || (g.kind === "FM" && g.a <= mid)) prev = g.kind === "FM" ? apply({}, g.el) : apply(prev, g.el);
    else if (g.kind === "BECMG"){ if (mid >= g.b) prev = apply(prev, g.el); else if (mid >= g.a) alts.push({ el:g.el, w:0.5 }); }
  }
  for (const g of taf.groups){
    if (!(mid >= g.a && mid < g.b)) continue;
    if (g.kind === "TEMPO") alts.push({ el:g.el, w: wTempo ?? 0.35 });
    else if (g.kind === "PROB") alts.push({ el:g.el, w:g.prob });
    else if (g.kind === "PROBTEMPO") alts.push({ el:g.el, w:g.prob*0.6 });
  }
  const toSample = s => ({ dir: s.vrb ? null : s.dir, spd: s.spd == null ? null : Math.max(s.spd, s.gst || 0), vis: s.vis ?? null, ceil: s.clouds ? ceilingOf(s.clouds) : undefined, cats: wxCatsOf(s.wx || []) });
  let wPrev = 1; const out = [];
  for (const a of alts){ const s = apply(prev, a.el); out.push({ ...toSample(s), w:a.w }); wPrev -= a.w; }
  out.unshift({ ...toSample(prev), w: Math.max(0.1, wPrev) });
  return out;
}
