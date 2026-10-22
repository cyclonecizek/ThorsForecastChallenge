/* ============================================================
   App state
   ============================================================ */
/* this script runs the planning page and, with window.PAGE = "exposure", the exposure page */
const PAGE = (typeof window !== "undefined" && window.PAGE) || "planning";
const EXPO = PAGE === "exposure";
const LS = EXPO ? { edits:"expfx:v1:edits", prefs:"expfx:v1:prefs", pub:"expfx:v1:published" } : { edits:"planfx:v1:edits", prefs:"planfx:v1:prefs", pub:"planfx:v1:published" };
const PLANNING_PARAMS = PARAMS.map(p => ({ ...p }));
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const DEMO = /[?&]demo=1\b/.test(location.search);

/* ============================================================
   Exposure forecasts: points, constraints and valid range
   ============================================================ */
const EXP_POINTS = [
  { id:"lc39a", name:"LC-39A", point:"LC-39A", area:"KSC", tag:"39A", off:[6,3,"start"],   stn:"KTTS", lat:28.6083, lon:-80.6041 },
  { id:"lc39b", name:"LC-39B", point:"LC-39B", area:"KSC", tag:"39B", off:[0,-7,"middle"], stn:"KTTS", lat:28.6272, lon:-80.6208 },
  { id:"slc41", name:"SLC-41", point:"SLC-41", area:"CCSFS", tag:"41",  off:[-6,3,"end"],    stn:"KXMR", lat:28.5833, lon:-80.5830 },
  { id:"slc40", name:"SLC-40", point:"SLC-40", area:"CCSFS", tag:"40",  off:[6,4,"start"],   stn:"KXMR", lat:28.5620, lon:-80.5772 },
  { id:"slc37", name:"SLC-37", point:"SLC-37", area:"CCSFS", tag:"37",  off:[6,3,"start"],   stn:"KXMR", lat:28.5314, lon:-80.5650 },
  { id:"lc36",  name:"LC-36",  point:"LC-36",  area:"CCSFS", tag:"36",  off:[6,3,"start"],   stn:"KXMR", lat:28.4710, lon:-80.5378 },
  { id:"slf",   name:"SLF",    point:"SLF",    area:"KSC Shuttle Landing Facility", tag:"SLF", off:[-5,3,"end"],    stn:"KTTS", lat:28.6150, lon:-80.6945 },
  { id:"xmr",   name:"XMR",    point:"XMR",    area:"CCSFS Skid Strip", tag:"XMR", off:[-6,3,"end"],    stn:"KXMR", lat:28.4686, lon:-80.5667 },
];
const MOS_STATIONS = { KTTS:[28.6150,-80.6945], KXMR:[28.4686,-80.5667], KCOF:[28.2349,-80.6101] };
const WIND_UNITS = { kt:1, mph:0.868976, "m/s":1.943844, "ft/s":0.592484, "km/h":0.539957 };
/* display unit for forecast winds (stored in knots) */
const WIND_DISP = { kt:1, mph:1.150779, "m/s":0.514444, "ft/s":1.687810, "km/h":1.852 };
const isWind = p => p && p.unit === "kt" && p.kind === "num";
const wfac = () => WIND_DISP[prefs.wu] || 1;
const wuLabel = () => prefs.wu || "kt";
const toDispW = v => v == null ? v : v*wfac();
/* "Winds (kt)" group labels follow the display unit */
const grpLabel = g => g.replace("Winds (kt)", `Winds (${wuLabel()})`);
function expDefaults(){
  const st = Math.ceil(Date.now()/H)*H;
  return { op:"", start:st, end:st + 48*H, hourly:24, custom:{ name:"Custom point", lat:28.5, lon:-80.6 },
    constraints:[ { id:"c1", type:"wind", h:60, kind:"peak", op:">=", v:25, unit:"kt" }, { id:"c2", type:"temp", op:"<", v:40, unit:"F" } ] };
}
const expStored = EXPO ? (store.get(LS.prefs, {}).exp || expDefaults()) : null;
function expPoints(exp){
  const c = exp.custom || {}; let stn = null, best = 30;
  for (const k in MOS_STATIONS){ const d = kmBetween(+c.lat, +c.lon, MOS_STATIONS[k][0], MOS_STATIONS[k][1]); if (d < best){ best = d; stn = k; } }
  return [...EXP_POINTS, { id:"custom", name: c.name || "Custom point", point: c.name || "Custom", tag:"C", off:[6,3,"start"], stn, lat:+c.lat || 28.5, lon:+c.lon || -80.6, custom:true }];
}
const fmtNum = v => (Math.round(v*10)/10).toString();
const opText = op => ({ ">":">", ">=":"≥", "<":"<", "<=":"≤" })[op] || op;
function constraintParams(exp){
  return (exp.constraints || []).map(c => {
    if (c.type === "wind"){
      const ft = Math.round(+c.h) || 54, kt = (+c.v || 0)*(WIND_UNITS[c.unit] || 1), key = (c.kind === "sust" ? "s" : "g") + ft;
      return { k:"x" + c.id, g:"Constraint probability (%)", l:`${opText(c.op)}${fmtNum(+c.v)} ${c.unit}`, s:`${ft} ft ${c.kind === "sust" ? "sust" : "peak"}`, chip:`${ft} ft ${c.kind === "sust" ? "sust" : "peak"} ${opText(c.op)}${fmtNum(+c.v)}${c.unit === "kt" ? "" : " " + c.unit}`,
        kind:"prob", ex:key, dep:[key], op:c.op, v:kt, title:`${c.kind === "sust" ? "Sustained" : "Peak"} wind at ${ft} ft ${opText(c.op)} ${fmtNum(+c.v)} ${c.unit}`, csv:`p_${c.kind}${ft}ft_${c.op === ">" ? "gt" : "ge"}${fmtNum(+c.v)}${c.unit.replace("/", "")}_pct`, cons:c, thrKt:kt, ft };
    }
    const f = c.unit === "C" ? (+c.v)*9/5 + 32 : +c.v, below = c.op === "<" || c.op === "<=";
    return { k:"x" + c.id, g:"Constraint probability (%)", l:`${below ? "<" : ">"}${fmtNum(+c.v)}°${c.unit}`, s:"temp", chip:`Temp ${below ? "<" : ">"}${fmtNum(+c.v)}°${c.unit}`, kind:"prob", ex: below ? "tmin" : "tmax", dep:["t"], op: below ? "<" : ">", v:f,
      title:`Temperature ${below ? "below" : "above"} ${fmtNum(+c.v)}°${c.unit}`, csv:`p_temp_${below ? "lt" : "gt"}${fmtNum(+c.v)}${c.unit}_pct`, cons:c };
  });
}
/* swap in the exposure points, wind heights and parameters */
function applyExposureConfig(exp){
  SITES.splice(0, SITES.length, ...expPoints(exp));
  const cons = constraintParams(exp);
  const hs = [...new Set(cons.filter(p => p.ft).map(p => p.ft))].sort((a, b) => a - b); if (!hs.length) hs.push(54);
  HEIGHTS.splice(0, HEIGHTS.length, ...hs);
  const base = k => ({ ...PLANNING_PARAMS.find(p => p.k === k) });
  const winds = hs.flatMap(ft => {
    const thr = cons.filter(p => p.ft === ft).map(p => Math.round(p.thrKt));
    return [ { k:"s" + ft, g:"Winds (kt)", l:`${ft} ft`, s:"sust", kind:"num", unit:"kt", step:1, lo:0, title:`${ft} ft sustained wind`, thr, csv:`wind${ft}ft_sust_kt` },
             { k:"g" + ft, g:"Winds (kt)", l:`${ft} ft`, s:"peak", kind:"num", unit:"kt", step:1, lo:0, title:`${ft} ft peak wind`, thr, peakOf:"s" + ft, csv:`wind${ft}ft_peak_kt` } ];
  });
  const list = [...["sky","t","td","wbgt","pp1","pp3","pp6","lt1","lt3","lt6"].map(base), ...winds, base("dir"), ...cons.map(p => ({ ...p, unit:"%", step:1, lo:0, hi:100 })), base("sev")];
  list.find(p => p.k === "dir").s = `${hs[0]} ft`;
  const CSVN = { sky:"sky_pct", t:"temp_f", td:"dewpoint_f", wbgt:"wbgt_f", pp1:"pop_1h_pct", pp3:"pop_3h_pct", pp6:"pop_6h_pct", lt1:"ltg_1h_pct", lt3:"ltg_3h_pct", lt6:"ltg_6h_pct", dir:"wind_dir_deg", sev:"spc_category" };
  list.forEach(p => { if (CSVN[p.k]) p.csv = CSVN[p.k]; });
  PARAMS.splice(0, PARAMS.length, ...list);
  for (const k of Object.keys(P)) delete P[k];
  PARAMS.forEach(p => P[p.k] = p);
}
function constraintSummary(){
  if (!EXPO) return "";
  const cons = constraintParams(prefs.exp || expStored);
  return cons.length ? "Constraints: " + cons.map((p, j) => j ? p.title.charAt(0).toLowerCase() + p.title.slice(1) : p.title).join("; ") + "." : "No constraints set.";
}
if (EXPO) applyExposureConfig(expStored);
const prefs = Object.assign({ enabled:{}, weight:{}, orient:"across", tz:"L", initials:"", link:true, clamp:true, hot:{}, site:SITES[0].id, param:"t" }, store.get(LS.prefs, {}));
let edits = store.get(LS.edits, {});
if (["s54","g54"].includes(prefs.param)) prefs.param = "w54";
if (/^(pp|lt)\d$/.test(prefs.param)) prefs.param = prefs.param.slice(0, 2);
if (["s200","g200"].includes(prefs.param)) prefs.param = "w200";
if (!prefs.draw) prefs.draw = "n";
if (!prefs.cmode) prefs.cmode = "select";
if (EXPO){ prefs.exp = Object.assign(expDefaults(), prefs.exp || {}); if (prefs.exp.end <= Date.now()){ const d = expDefaults(); prefs.exp.start = d.start; prefs.exp.end = d.end; } }
if (!SITES.some(x => x.id === prefs.site)) prefs.site = SITES[0].id;
delete edits["cape-pad"];   /* old SLC-40 point */
let published = store.get(LS.pub, {});
const S = { rows:null, TL:null, G:{}, agg:{}, status:{}, loading:true, cur:null, hoverRow:null, undo:[], redo:[], fetchedAt:null, errors:0 };
const savePrefs = () => store.set(LS.prefs, prefs);
const saveEdits = () => store.set(LS.edits, edits);
const site = () => SITES.find(s => s.id === prefs.site) || SITES[0];
const hotOf = s => prefs.hot[s.id] ?? s.hot;
const zulu = () => prefs.tz === "Z";
const $ = id => document.getElementById(id);

function pruneEdits(){
  const now = Date.now();
  for (const sid in edits) for (const k in edits[sid]) for (const key in edits[sid][k]){ const [a, len] = key.split("_").map(Number); if (a + len*H < now - H) delete edits[sid][k][key]; }
}
function editCount(sid){ let n = 0; const e = edits[sid] || {}; for (const k in e) n += Object.keys(e[k]).length; return n; }

/* ---------- guidance + official values ---------- */
const rnd = v => v == null ? null : Math.round(v);
/* guidance probabilities: whole percent, with 1% rounded down to 0 */
const probRound = v => { if (v == null) return null; const r = Math.round(v); return r <= 1 ? 0 : r; };
function guidanceFor(sid){
  const A = S.agg[sid]; if (!A) return null;
  const clampP = v => v == null ? v : Math.max(0, Math.min(prefs.clamp ? 99 : 100, v));
  const g = {};
  for (const p of PARAMS){
    if (p.k.startsWith("x")) continue;
    const arr = A.val[p.k] || [];
    g[p.k] = S.rows.map((r, i) => {
      const v = arr[i];
      if (p.win && !probCell(S.rows[i], p.win)) return undefined;
      if (p.kind === "prob") return v == null ? null : probRound(clampP(v));
      if (p.kind === "dir") return v == null ? null : (Math.round(v/10)*10) % 360;
      if (p.kind === "sev") return v || "-";
      return rnd(v);
    });
  }
  return g;
}
/* ---------- linked 1 / 3 / 6 hr probabilities ----------
   Each row has a base value for its own length (1 h rows: 1 hr, 3 h blocks: 3 hr, 6 h blocks: 6 hr).
   Longer windows are built from the base values inside them with
     P = max + k * (1 - prod(1 - p) - max),
   where k comes from the guidance for that window (0 = all hours the same event, 1 = independent).
   An edit on a window is an anchor: the unedited base values inside it are scaled together to meet it.
   "Highest 1 hr / 3 hr inside a block" cells follow the block by the guidance ratio. */
function combProb(ps, k){ let mx = 0, q = 1; for (const p of ps){ mx = Math.max(mx, p); q *= 1 - p; } return mx + k*((1 - q) - mx); }
function linkProbs(ev, rows, Gv, ed){
  const K = [ev + "1", ev + "3", ev + "6"];
  const P01 = v => v == null || v === undefined ? null : Math.max(0, Math.min(1, v/100));
  const baseK = r => r.len === 1 ? K[0] : r.len <= 3 ? K[1] : K[2];
  const G = k => Gv[k] || [];
  const ratio = (kc, i) => { const gc = P01(G(kc)[i]), gb = P01(G(baseK(rows[i]))[i]); if (gc == null || gb == null || gb <= 0) return 1; return Math.min(1, gc/gb); };
  const b = rows.map((r, i) => { const e = ed(baseK(r), r); return e !== undefined ? e/100 : P01(G(baseK(r))[i]); });
  const fixed = rows.map((r, i) => ed(baseK(r), r) !== undefined);
  /* anchors on "highest inside" cells set their block */
  rows.forEach((r, i) => {
    if (r.len === 1 || fixed[i]) return;
    for (const kc of r.len > 3 ? [K[1], K[0]] : [K[0]]){ const a = ed(kc, r); if (a === undefined) continue; const rt = ratio(kc, i); b[i] = Math.min(1, rt > 0 ? a/100/rt : a/100); fixed[i] = true; break; }
  });
  const kOf = (idx, Kw, i0) => {
    const gs = idx.map(j => P01(G(baseK(rows[j]))[j])), gw = P01(G(Kw)[i0]);
    if (gs.some(v => v == null) || gw == null) return 0.5;
    let mx = 0, q = 1; gs.forEach(p => { mx = Math.max(mx, p); q *= 1 - p; });
    const ind = 1 - q; if (ind - mx < 1e-4) return 0.5;
    return Math.max(0, Math.min(1, (gw - mx)/(ind - mx)));
  };
  const wins = { 3:[], 6:[] };
  for (const L of [3, 6]){
    const Kw = L === 3 ? K[1] : K[2];
    spanMap(Kw).forEach((sp, i0) => {
      if (sp.cov || sp.na || sp.s < 2) return;
      const idx = Array.from({ length: sp.s }, (_, d) => i0 + d);
      wins[L].push({ L, i0, idx, Kw, k: kOf(idx, Kw, i0), anchor: ed(Kw, rows[i0]) });
    });
  }
  const locked = new Set();
  const solve = w => {
    const T = Math.min(0.995, w.anchor/100);
    const free = w.idx.filter(j => !fixed[j] && !locked.has(j)); if (!free.length) return;
    const base = free.map(j => b[j] || 0); if (base.every(v => v <= 0)) base.fill(0.01);
    const val = sc => combProb(w.idx.map(j => { const m = free.indexOf(j); return m >= 0 ? Math.min(0.995, base[m]*sc) : (b[j] || 0); }), w.k);
    let lo = 0, hi = 1; while (val(hi) < T && hi < 1e5) hi *= 2;
    for (let it = 0; it < 48; it++){ const mid = (lo + hi)/2; if (val(mid) < T) lo = mid; else hi = mid; }
    const sc = (lo + hi)/2; free.forEach((j, m) => b[j] = Math.min(0.995, base[m]*sc));
  };
  wins[3].forEach(w => { if (w.anchor !== undefined){ solve(w); w.idx.forEach(j => locked.add(j)); } });
  wins[6].forEach(w => { if (w.anchor !== undefined) solve(w); });
  const out = {}; K.forEach(k => out[k] = rows.map(() => undefined));
  rows.forEach((r, i) => {
    out[baseK(r)][i] = b[i] == null ? null : b[i]*100;
    if (r.len > 1){ out[K[0]][i] = b[i] == null ? null : b[i]*ratio(K[0], i)*100; if (r.len > 3) out[K[1]][i] = b[i] == null ? null : b[i]*ratio(K[1], i)*100; }
  });
  const fit = [];
  for (const L of [3, 6]) for (const w of wins[L]){
    let v = combProb(w.idx.map(j => b[j] || 0), w.k)*100;
    if (L === 6 && w.anchor === undefined){ let mx = 0; w.idx.forEach(j => { mx = Math.max(mx, (b[j] || 0)*100); const v3 = out[K[1]][j]; if (v3 != null) mx = Math.max(mx, v3); }); v = Math.max(v, mx); }
    if (w.anchor !== undefined) fit.push({ k:w.Kw, i:w.i0, anchor:w.anchor, fit:v });
    out[w.Kw][w.i0] = v;
  }
  return { out, fit };
}
function officialFor(sid, fast){
  const s = SITES.find(x => x.id === sid), G = S.G[sid], g = guidanceFor(sid) || {};
  const e = edits[sid] || {}, rows = S.rows, o = {}, src = {};
  const ed = (k, r) => e[k] && e[k][r.key] !== undefined ? e[k][r.key] : undefined;
  for (const p of PARAMS){
    if (p.k.startsWith("x")) continue;
    o[p.k] = rows.map((r, i) => { if (p.win && !probCell(r, p.win)) return undefined; const x = ed(p.k, r); return x !== undefined ? x : (g[p.k] ? g[p.k][i] : null); });
  }
  /* precip and lightning: keep 1, 3 and 6 hr consistent */
  const fits = [];
  if (prefs.linkWin !== false && S.agg[sid]){
    for (const ev of ["pp","lt"]){
      const res = linkProbs(ev, rows, S.agg[sid].val, ed);
      for (const k of [ev + "1", ev + "3", ev + "6"]){
        o[k] = rows.map((r, i) => {
          if (o[k][i] === undefined) return undefined;
          const x = ed(k, r); if (x !== undefined) return x;
          const v = res.out[k][i]; return v == null || v === undefined ? null : probRound(Math.min(prefs.clamp ? 99 : 100, v));
        });
      }
      fits.push(...res.fit);
    }
  }
  /* peaks follow edited sustained winds unless the peak itself is edited */
  rows.forEach((r, i) => {
    for (const [sk, gk] of PARAMS.filter(p => p.peakOf && o[p.peakOf]).map(p => [p.peakOf, p.k])){
      if (ed(gk, r) !== undefined || ed(sk, r) === undefined || o[gk][i] == null || g[sk] == null || g[sk][i] == null) continue;
      o[gk][i] = Math.max(o[sk][i], o[gk][i] + (o[sk][i] - g[sk][i]));
    }
  });
  /* WBGT follows edited temperature / dew point unless WBGT itself is edited */
  rows.forEach((r, i) => {
    if (ed("wbgt", r) !== undefined || (ed("t", r) === undefined && ed("td", r) === undefined)) return;
    if (o.t[i] == null || o.td[i] == null || g.t[i] == null || g.td[i] == null || g.wbgt[i] == null) return;
    const d = wbgtF(o.t[i], o.td[i], 400, 8) - wbgtF(g.t[i], g.td[i], 400, 8);
    o.wbgt[i] = Math.round(g.wbgt[i] + d);
  });
  const gx = {};
  if (fast && OF && OF.site === sid){
    /* while dragging: keep the exceedance probabilities from the last full pass */
    for (const p of PARAMS.filter(p => p.k.startsWith("x"))){ o[p.k] = OF.o[p.k] || []; gx[p.k] = OF.g[p.k] || []; src[p.k] = OF.xsrc[p.k] || {}; }
    return { o, g: Object.assign(g, gx), xsrc: src, fits, site:sid };
  }
  for (const p of PARAMS.filter(p => p.k.startsWith("x"))){
    o[p.k] = []; gx[p.k] = []; src[p.k] = {};
    rows.forEach((r, i) => {
      let delta = 0;
      if (prefs.link && G && g.t && p.dep){
        const mx = (src2, ks) => { const v = ks.map(k => src2[k] ? src2[k][i] : null).filter(x => x != null); return v.length ? Math.max(...v) : null; };
        const a = mx(o, p.dep), b = mx(g, p.dep); if (a != null && b != null) delta = a - b;
      }
      const clampP = v => v == null ? v : Math.max(0, Math.min(prefs.clamp ? 99 : 100, v));
      const base = G && G.mem ? exceed(G, p.k, i, 0, hotOf(s)) : { v:null, per:{} };
      const shifted = delta && G && G.mem ? exceed(G, p.k, i, delta, hotOf(s)) : base;
      gx[p.k][i] = probRound(clampP(base.v));
      for (const id in base.per) (src[p.k][id] = src[p.k][id] || [])[i] = base.per[id];
      const x = ed(p.k, r);
      o[p.k][i] = x !== undefined ? x : probRound(clampP(shifted.v));
    });
  }
  return { o, g: Object.assign(g, gx), xsrc: src, fits, site:sid };
}

/* QC: impossible or inconsistent combinations */
function qcIssues(sid, OF){
  const { o } = OF, out = [], bad = {};
  const flag = (k, i, msg) => { (bad[k] = bad[k] || {})[i] = msg; out.push({ i, k, msg }); };
  S.rows.forEach((r, i) => {
    if (o.t[i] != null && o.td[i] != null && o.td[i] > o.t[i]) flag("td", i, "Dew point above temperature");
    for (const p of PARAMS.filter(p => p.peakOf)){ const sv = o[p.peakOf] && o[p.peakOf][i], gv = o[p.k] && o[p.k][i]; if (sv != null && gv != null && gv < sv) flag(p.k, i, `${p.l} peak below sustained`); }
    for (const ev of ["pp","lt"]){
      const a = o[ev+"1"][i], b = o[ev+"3"][i], c = o[ev+"6"][i];
      if (r.len === 1 && a != null && b != null && a > b) flag(ev+"3", i, (ev === "pp" ? "Precip" : "Lightning") + " 3 hr below 1 hr");
      if (b != null && c != null && b > c) flag(ev+"6", i, (ev === "pp" ? "Precip" : "Lightning") + " 6 hr below 3 hr");
    }
    for (const w of ["1","3","6"]){ const a = o["lt" + w][i], b = o["pp" + w][i]; if (a != null && b != null && a > b + 5) flag("lt" + w, i, `Lightning ${w} hr (${a}%) is above precipitation ${w} hr (${b}%)`); }
    for (const [lo, hi] of [["x50","x35"],["x35","x25"],["x32","x40"]]) if (o[lo] && o[hi] && o[lo][i] != null && o[hi][i] != null && o[lo][i] > o[hi][i]) flag(lo, i, `${P[lo].l} more likely than ${P[hi].l}`);
  });
  for (const f of OF.fits || []) if (Math.abs(f.fit - f.anchor) > 2.5) flag(f.k, f.i, `${P[f.k].title} ${f.anchor}% can't be met by the values you've set inside it (they give ${Math.round(f.fit)}%)`);
  return { list: out, bad };
}

/* ---------- formatting ---------- */
function fmt(p, v){
  if (v === undefined) return "";
  if (v == null) return "";
  if (isWind(p)) return String(Math.round(v*wfac()));
  if (p.kind === "sky") return skyCat(v);
  if (p.kind === "dir") return compass(v);
  if (p.kind === "sev") return v === "-" ? "-" : SEV_NAME[v] || v;
  return String(v);
}
function tint(p, v){
  if (v == null || v === undefined) return "";
  if (p.kind === "prob"){ const a = Math.min(0.62, Math.max(0, v)/100*0.62); return a > 0.02 ? `background:rgba(var(--p),${a.toFixed(3)})` : ""; }
  if (p.k === "t" || p.k === "wbgt"){ if (v >= 85) return `background:rgba(var(--hot),${Math.min(0.32,(v-84)/40).toFixed(3)})`; if (v <= 50) return `background:rgba(var(--cold),${Math.min(0.3,(51-v)/40).toFixed(3)})`; return ""; }
  if (p.unit === "kt" && p.kind === "num"){ const a = Math.max(0, Math.min(0.4, (v - 12)/45)); return a > 0.02 ? `background:rgba(var(--hot),${a.toFixed(3)})` : ""; }
  if (p.kind === "sky"){ const a = Math.max(0, v)/100*0.16; return a > 0.02 ? `background:rgba(120,135,150,${a.toFixed(3)})` : ""; }
  if (p.kind === "sev" && v !== "-") return `background:rgba(var(--hot),${(0.08 + SEV.indexOf(v)*0.06).toFixed(3)})`;
  return "";
}
function rowTime(r){
  const z = zulu();
  if (r.len === 1) return hhmm(r.a, z);
  return hhmm(r.a, z) + "–" + hhmm(r.b, z);
}
function tzLabel(){ return zulu() ? "UTC" : tzAbbr(Date.now()); }
function colLabel(p, s){ if (p.k === "xhot") return `>${hotOf(s)}°F`; return p.l; }

/* ============================================================
   Rendering: header, locator, params, sources
   ============================================================ */
function renderSites(){
  $("sites").innerHTML = SITES.map(s => `<button type="button" data-site="${s.id}" aria-pressed="${s.id === prefs.site}" class="${editCount(s.id) ? "dirty" : ""}"><span class="n">${s.name}<span class="dot" title="Has edits"></span></span><span class="p">${EXPO ? (s.custom ? `${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}` : s.area) : s.point}</span></button>`).join("");
  const s = site();
  if (EXPO){
    const e = prefs.exp, z = zulu(), r0 = S.rows && S.rows[0], r1 = S.rows && S.rows[S.rows.length - 1];
    $("where").innerHTML = `<b>${e.op ? e.op.replace(/</g, "&lt;") : "Exposure forecast"}</b> at ${s.name} (${s.lat.toFixed(4)}, ${s.lon.toFixed(4)})${s.stn ? `, MOS from ${s.stn}` : ""}${r0 ? `, ${dayLabel(r0.a, z).dt} ${hhmm(r0.a, z)} to ${dayLabel(r1.b, z).dt} ${hhmm(r1.b, z)}${z ? "Z" : " " + tzAbbr(r0.a)}` : ""}`;
  } else $("where").innerHTML = `<b>${s.name}</b>, forecast point ${s.point} (${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}), MOS from ${s.stn}`;
  renderLocator();
  if (!EXPO) $("hotThr").value = hotOf(s);
}
/* ---------- exposure setup panel ---------- */
function dtInput(ms){ if (zulu()) return new Date(ms).toISOString().slice(0, 16); const p = lp(ms); return `${p.y}-${pad2(p.mo)}-${pad2(p.d)}T${pad2(p.h)}:${pad2(p.mi)}`; }
function dtParse(v){
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); if (!m) return null;
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (zulu()) return base;
  for (const off of [4, 5]){ const t = base + off*H, p = lp(t); if (p.h === +m[4] && p.d === +m[3]) return t; }
  return base + 5*H;
}
function renderExpSetup(){
  if (!EXPO) return;
  const e = prefs.exp, el = document.activeElement;
  if (el !== $("expOp")) $("expOp").value = e.op || "";
  if (el !== $("expStart")) $("expStart").value = dtInput(e.start);
  if (el !== $("expEnd")) $("expEnd").value = dtInput(e.end);
  $("expTz").textContent = zulu() ? "UTC" : tzAbbr(e.start);
  $("expHourly").value = String(e.hourly);
  const n = Math.round((e.end - e.start)/H);
  $("expLen").textContent = `${n} h window${S.rows ? `, ${S.rows.length} rows` : ""}`;
  $("expCustom").hidden = prefs.site !== "custom";
  if (!$("expCustom").contains(el)){ $("cuName").value = e.custom.name || ""; $("cuLat").value = e.custom.lat; $("cuLon").value = e.custom.lon; }
  const sel = (id, opts, v) => `<select data-f="${id}">${opts.map(([val, lab]) => `<option value="${val}" ${String(val) === String(v) ? "selected" : ""}>${lab}</option>`).join("")}</select>`;
  $("expCons").innerHTML = e.constraints.length ? e.constraints.map(c => c.type === "wind"
    ? `<div class="con" data-id="${c.id}"><span class="ct">Wind</span><label><input data-f="h" type="number" min="5" max="600" step="1" value="${c.h}"> ft</label>${sel("kind", [["peak","Peak"],["sust","Sustained"]], c.kind)}${sel("op", [[">=","≥"],[">",">"]], c.op)}<input data-f="v" type="number" min="0" step="1" value="${c.v}">${sel("unit", Object.keys(WIND_UNITS).map(u => [u, u]), c.unit)}<button type="button" class="x" data-del="${c.id}" aria-label="Remove constraint">×</button></div>`
    : `<div class="con" data-id="${c.id}"><span class="ct">Temperature</span>${sel("op", [["<","Below"],[">","Above"]], c.op)}<input data-f="v" type="number" step="1" value="${c.v}">${sel("unit", [["F","°F"],["C","°C"]], c.unit)}<button type="button" class="x" data-del="${c.id}" aria-label="Remove constraint">×</button></div>`).join("")
    : `<p class="mut">No constraints yet. Add a wind or temperature constraint to get its probability in the forecast.</p>`;
}
let expT = null;
function expChanged(full){
  savePrefs(); applyExposureConfig(prefs.exp); rebuildViews();
  clearTimeout(expT); expT = setTimeout(() => { if (full) loadAll(); else rebuildGuidance(); renderExpSetup(); }, full ? 50 : 250);
}
function bindExp(){
  if (!EXPO) return;
  $("expSetup").hidden = false;
  document.querySelectorAll(".plan-only").forEach(x => x.hidden = true);
  $("pageTitle").textContent = "Exposure forecast";
  document.title = "Exposure Forecast | KSC and CCSFS";
  $("expOp").oninput = e => { prefs.exp.op = e.target.value; savePrefs(); renderSites(); };
  const range = () => {
    let a = dtParse($("expStart").value), b = dtParse($("expEnd").value);
    if (a == null || b == null) return;
    const lo = Math.floor(Date.now()/H)*H - 6*H, hi = S.TL ? S.TL.t0 + (S.TL.n - 2)*H : Date.now() + 7.5*24*H;
    let note = "";
    if (a < lo){ a = lo; note = "Start moved to the earliest time with guidance. "; }
    if (b > hi){ b = hi; note += "End moved to the last time with guidance (about 8 days out)."; }
    if (b <= a + H){ toast("The end has to be after the start"); renderExpSetup(); return; }
    prefs.exp.start = a; prefs.exp.end = b; if (note) toast(note.trim());
    expChanged(false);
  };
  $("expStart").onchange = range; $("expEnd").onchange = range;
  $("expHourly").onchange = e => { prefs.exp.hourly = e.target.value === "all" ? "all" : +e.target.value; expChanged(false); };
  $("expQuick").onclick = ev => { const b = ev.target.closest("[data-q]"); if (!b) return; const st = Math.ceil(Date.now()/H)*H; prefs.exp.start = st; prefs.exp.end = st + (+b.dataset.q)*H; expChanged(false); };
  $("cuLoad").onclick = () => {
    const la = parseFloat($("cuLat").value), lo = parseFloat($("cuLon").value);
    if (!(la > 27 && la < 30) || !(lo > -82 && lo < -79)){ toast("Enter a latitude and longitude near the Space Coast (decimal degrees, west is negative)"); return; }
    prefs.exp.custom = { name: $("cuName").value.trim() || "Custom point", lat: la, lon: lo }; expChanged(true);
  };
  $("expCons").onchange = ev => {
    const row = ev.target.closest("[data-id]"), f = ev.target.dataset.f; if (!row || !f) return;
    const c = prefs.exp.constraints.find(x => x.id === row.dataset.id); if (!c) return;
    c[f] = ev.target.type === "number" ? +ev.target.value : ev.target.value; expChanged(false);
  };
  $("expCons").onclick = ev => { const d = ev.target.closest("[data-del]"); if (!d) return; prefs.exp.constraints = prefs.exp.constraints.filter(x => x.id !== d.dataset.del); expChanged(false); };
  const newId = () => "c" + Date.now().toString(36);
  $("addWind").onclick = () => { prefs.exp.constraints.push({ id:newId(), type:"wind", h:60, kind:"peak", op:">=", v:25, unit:"kt" }); expChanged(false); };
  $("addTemp").onclick = () => { prefs.exp.constraints.push({ id:newId(), type:"temp", op:">", v:95, unit:"F" }); expChanged(false); };
  $("foot1").textContent = "Rows are hourly for the period you choose, then 3-hour blocks to the end of the window. In blocks, temperature shows the warmest value for daytime blocks and the coolest for overnight blocks, winds show the block maximum, and probabilities are the chance of the event at any time in the block. Constraint probabilities are the chance that the constraint is met (for example, a peak wind at or above the limit) at any time in the row, from all the guidance members, and they move with your wind and temperature edits. 3 and 6 hr precipitation and lightning cells are merged across the hours they cover and linked to the 1 hr values. Press Enter to edit a table cell, Delete to return it to guidance.";
  const f2 = $("foot1").nextElementSibling; if (f2) f2.textContent = "Winds at each constraint height are interpolated from each model's 10 m and 80 m winds (power law where 80 m is missing), and peaks scale the 10 m gust factor with height. The custom point uses the nearest MOS station within 30 km and the nearest high-res pipeline point within 15 km. Lightning comes only from guidance with explicit thunder probabilities.";
  renderExpSetup();
}
function renderLocator(){
  const X = lon => (lon + 80.78)/0.28*80, Y = lat => (28.80 - lat)/0.64*118;
  const coast = [[28.85,-80.73],[28.76,-80.68],[28.70,-80.655],[28.64,-80.60],[28.59,-80.575],[28.53,-80.555],[28.48,-80.535],[28.455,-80.526],[28.435,-80.56],[28.40,-80.598],[28.32,-80.604],[28.24,-80.594],[28.10,-80.575]];
  const pts = coast.map(([la, lo]) => `${X(lo).toFixed(1)},${Y(la).toFixed(1)}`).join(" ");
  const tags = { "ksc-inland":"SLF", "ksc-pads":"39B", "cape-inland":"XMR", "cape-pad37":"37", patrick:"COF" };
  const off = { "ksc-inland":[-5,3,"end"], "ksc-pads":[0,-7,"middle"], "cape-inland":[-6,3,"end"], "cape-pad37":[-6,3,"end"], patrick:[-6,3,"end"] };
  SITES.forEach(s => { if (!tags[s.id]) tags[s.id] = s.tag || ""; if (!off[s.id]) off[s.id] = s.off || [-5,3,"end"]; });
  $("locator").innerHTML = `<polygon class="water" points="${pts} 80,118 80,0"/><polyline class="coast" points="${pts}"/>` +
    SITES.map(s => { const x = X(s.lon), y = Y(s.lat), o = off[s.id], on = s.id === prefs.site; return `<g data-site="${s.id}" style="cursor:pointer"><title>${s.name} (${s.point})</title><circle class="pt ${on ? "on" : ""}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${on ? 4.4 : 3.2}"/>${EXPO && !on ? "" : `<text x="${(x + o[0]).toFixed(1)}" y="${(y + o[1]).toFixed(1)}" text-anchor="${o[2]}" style="${on ? "fill:var(--accent)" : ""}">${tags[s.id]}</text>`}</g>`; }).join("");
}
const chartGroups = () => [
  ["Sky and temperature", ["sky","t","td","wbgt"].filter(k => P[k])],
  ["Precipitation and lightning", ["pp","lt"].filter(k => P[k + "1"])],
  ["Wind", [...HEIGHTS.map(ft => "w" + ft).filter(v => VIEWS[v]), ...(P.dir ? ["dir"] : [])]],
  [EXPO ? "Constraint probability" : "Exceedance probability", PARAMS.filter(p => p.k.startsWith("x")).map(p => p.k)],
].filter(g => g[1].length);
const chipName = k => ({ sky:"Sky", t:"Temp", td:"Dew pt", wbgt:"WBGT", pp:"Precipitation", lt:"Lightning", dir:"Direction", xhot:`>${hotOf(site())}°F` }[k] || (VIEWS[k] ? VIEWS[k].chip : P[k] ? (P[k].chip || P[k].l) : k));
function renderParams(){
  const e = edits[prefs.site] || {};
  $("params").innerHTML = chartGroups().map(([gl, ks]) => `<div class="pgroup"><span class="gl">${gl}</span><div class="chips">${ks.map(k => `<button type="button" class="chip ${keysOf(k).some(q => e[q] && Object.keys(e[q]).length) ? "edited" : ""}" data-p="${k}" aria-pressed="${k === prefs.param}">${chipName(k)}</button>`).join("")}</div></div>`).join("");
}
function renderSources(){
  const fams = Object.keys(FAMILIES);
  let ok = 0, tot = 0;
  $("srcgrid").innerHTML = fams.map(f => {
    const list = ALL_SOURCES.filter(s => s.fam === f);
    return `<div class="srcfam"><h3><i style="background:${FAMILIES[f].color}"></i>${FAMILIES[f].label}</h3>` + list.map(s => {
      const st = S.status[s.id] || {}; tot++; if (st.ok) ok++;
      const on = prefs.enabled[s.id] !== false, w = prefs.weight[s.id] ?? s.w ?? 1;
      const txt = st.loading ? "loading" : st.ok ? st.note : (st.err || "not available");
      return `<div class="srow ${st.ok ? "" : "na"}"><input type="checkbox" data-src="${s.id}" ${on ? "checked" : ""} aria-label="Use ${s.name}"><span>${s.name} <span class="st">${txt}</span></span><select data-w="${s.id}" aria-label="${s.name} weight">${[0.5,1,2,3].map(x => `<option value="${x}" ${x == w ? "selected" : ""}>×${x}</option>`).join("")}</select></div>`;
    }).join("") + `</div>`;
  }).join("");
  const used = ALL_SOURCES.filter(s => (S.status[s.id] || {}).ok && prefs.enabled[s.id] !== false).length;
  $("srcSum").textContent = S.loading && !ok ? "loading" : `${used} in the blend, ${ok} of ${tot} available`;
}
function renderStatus(){
  const live = $("live");
  const ok = Object.values(S.status).filter(s => s.ok).length;
  const pend = Object.values(S.status).filter(s => s.loading).length;
  live.classList.toggle("err", !S.loading && ok === 0);
  live.textContent = DEMO ? "Demo guidance (synthetic data)" : pend ? `Loading guidance, ${ok} sources in` : ok ? `Guidance from ${ok} sources, fetched ${hhmm(S.fetchedAt, zulu())}${zulu() ? "Z" : " " + tzAbbr(S.fetchedAt)}` : "No guidance loaded";
  const pb = published[prefs.site];
  $("lastPub").textContent = pb ? `${hhmm(pb.t, zulu())}${zulu() ? "Z" : ""} ${new Date(pb.t).toDateString().slice(4,10)} by ${pb.by}` : "not yet";
  $("editCount").textContent = editCount(prefs.site);
  $("undo").disabled = !S.undo.length; $("redo").disabled = !S.redo.length;
  $("orD").setAttribute("aria-pressed", !across()); $("orA").setAttribute("aria-pressed", across());
  $("tzL").setAttribute("aria-pressed", !zulu()); $("tzZ").setAttribute("aria-pressed", zulu());
  const b = $("banner");
  if (DEMO){ b.className = "banner show demo"; b.textContent = "Demo mode: every value on this page is synthetic. Remove ?demo=1 from the address to load real guidance."; }
  else if (!S.loading && ok === 0){ b.className = "banner show"; b.textContent = "Couldn't reach any guidance source from this browser. Check the network connection, then press Refresh guidance. You can still type a forecast into the table."; }
  else if (!S.loading && ![...OM_DET, ...OM_ENS].some(d => (S.status[d.id] || {}).ok)){ b.className = "banner show"; b.textContent = "Model guidance from Open-Meteo didn't load, so only MOS and LAMP are showing. Press Refresh guidance to try again."; }
  else if (!S.loading && !["lav","mav","nbs","met","mex","nbe","hrefct","refsct"].some(id => (S.status[id] || {}).ok)){ b.className = "banner show"; b.textContent = "No thunder guidance loaded (calibrated thunder, LAMP or MOS), so lightning probabilities are blank. Fill them in by hand, or check that the MOS mirror and high-res workflows are running."; }
  else b.className = "banner";
}

/* ============================================================
   Matrix
   ============================================================ */
let OF = null, QC = null;
/* how many rows each 3 h / 6 h probability cell covers; {cov:true} = inside an earlier cell */
function spanMap(k){
  S.spanCache = S.spanCache || {};
  if (S.spanCache[k]) return S.spanCache[k];
  const p = P[k], rows = S.rows, res = rows.map(() => ({ s:1 }));
  if (p.win && p.win > 1){
    let start = -1, until = -Infinity, naStart = -1;
    rows.forEach((r, i) => {
      if (start >= 0 && r.a < until){ res[i] = { cov:true }; res[start].s++; naStart = -1; return; }
      start = -1;
      const c = probCell(r, p.win);
      if (c && c.mode === "win"){ start = i; until = c.B; naStart = -1; return; }
      if (!c){ if (naStart >= 0){ res[i] = { cov:true }; res[naStart].s++; } else { naStart = i; res[i] = { s:1, na:true }; } return; }
      naStart = -1;
    });
  }
  return (S.spanCache[k] = res);
}
const ownerIdx = (k, i) => { const m = spanMap(k); while (i > 0 && m[i] && m[i].cov) i--; return i; };
function cellTitle(p, r, i){
  if (!p.win) return p.title;
  const c = probCell(r, p.win);
  if (c && c.mode === "max") return `Highest ${p.win}-hour chance inside this ${r.len}-hour block`;
  const sp = spanMap(p.k)[i]; if (!sp || sp.na) return p.title;
  const end = S.rows[i + sp.s - 1].b, z = zulu();
  return `${p.win}-hour chance, ${hhmm(r.a, z)} to ${hhmm(end, z)}${z ? "Z" : " " + tzAbbr(r.a)}`;
}
function recompute(){ OF = officialFor(prefs.site); QC = qcIssues(prefs.site, OF); }
function renderTable(){
  const s = site(), rows = S.rows, { o } = OF, e = edits[s.id] || {}, z = zulu();
  const groups = []; PARAMS.forEach(p => { const g = groups[groups.length - 1]; if (g && g.g === p.g) g.n++; else groups.push({ g:p.g, n:1 }); });
  let h = `<table class="mx"><thead><tr class="g"><th class="stick" rowspan="1"></th><th class="stick2"></th>${groups.map(g => `<th colspan="${g.n}" class="gstart">${grpLabel(g.g)}</th>`).join("")}</tr>`;
  h += `<tr class="c"><th class="stick">Day</th><th class="stick2">Time<small>${tzLabel()}</small></th>`;
  let lastG = null;
  for (const p of PARAMS){ const gs = p.g !== lastG; lastG = p.g; h += `<th data-p="${p.k}" class="${gs ? "gstart" : ""} ${keysOf(prefs.param).includes(p.k) ? "sel" : ""}" title="${p.title}">${colLabel(p, s)}${p.s ? `<small>${p.s}</small>` : ""}</th>`; }
  h += `</tr></thead><tbody>`;
  let lastDay = null, lastBlk = null;
  const dayRuns = {}; rows.forEach(r => { const dk = dayKey(r.a, z); dayRuns[dk] = (dayRuns[dk] || 0) + 1; });
  rows.forEach((r, i) => {
    const dk = dayKey(r.a, z), ds = dk !== lastDay, bs = r.len !== lastBlk && !ds; lastDay = dk; lastBlk = r.len;
    let cls = (ds ? "dstart " : "") + (bs ? "sect " : "") + (S.hoverRow === i ? "hov" : "");
    h += `<tr data-r="${i}" class="${cls}">`;
    if (ds){ const L = dayLabel(r.a, z); const today = i === 0 ? "Today" : (dayKey(r.a, z) === dayKey(Date.now() + 24*H, z) ? "Tomorrow" : L.wd); h += `<td class="stick day" rowspan="${dayRuns[dk]}"><b>${today}</b>${today === L.wd ? "" : L.wd + "<br>"}${L.dt}</td>`; }
    h += `<td class="stick2 tm">${rowTime(r)}${r.len > 1 ? `<small>${r.len} h</small>` : ""}</td>`;
    lastG = null;
    for (const p of PARAMS){
      const gs = p.g !== lastG; lastG = p.g;
      const sp = spanMap(p.k)[i]; if (sp.cov) continue;
      const v = o[p.k][i], na = v === undefined, edd = e[p.k] && e[p.k][r.key] !== undefined;
      const bad = QC.bad[p.k] && QC.bad[p.k][i];
      const cur = S.cur && S.cur.i === i && S.cur.k === p.k;
      const c = `c ${p.kind === "sev" ? "sev" : ""} ${gs ? "gstart" : ""} ${na ? "na" : ""} ${edd ? "ed" : ""} ${bad ? "bad" : ""} ${cur ? "cur" : ""}`;
      h += `<td class="${c}" data-k="${p.k}" data-i="${i}"${sp.s > 1 ? ` rowspan="${sp.s}"` : ""} style="${na ? "" : tint(p, v)}" title="${bad || cellTitle(p, r, i)}">${na ? "–" : fmt(p, v)}</td>`;
    }
    h += `</tr>`;
  });
  h += `</tbody></table>`;
  const m = $("matrix"), st = m.scrollTop, sl = m.scrollLeft;
  m.innerHTML = h; m.scrollTop = st; m.scrollLeft = sl;
}
function renderTableAcross(){
  const s = site(), rows = S.rows, { o } = OF, e = edits[s.id] || {}, z = zulu();
  const days = []; rows.forEach((r, i) => { const dk = dayKey(r.a, z); const d = days[days.length - 1]; if (d && d.dk === dk) d.n++; else days.push({ dk, n:1, i }); });
  const dstart = new Set(days.map(d => d.i));
  const tlab = r => { const a = hhmm(r.a, z).slice(0, 2); return r.len === 1 ? a : `${a}–${hhmm(r.b, z).slice(0, 2)}`; };
  let h = `<table class="mx across"><thead><tr class="g"><th class="stick" colspan="2">${tzLabel()}</th>`;
  days.forEach((d, j) => { const L = dayLabel(rows[d.i].a, z); const nm = j === 0 ? "Today" : (d.dk === dayKey(Date.now() + 24*H, z) ? "Tomorrow" : L.wd); h += `<th colspan="${d.n}" class="dcol">${d.n >= 3 ? `${nm}, ${L.dt}` : L.dt}</th>`; });
  h += `</tr><tr class="c"><th class="stick">Parameter</th><th class="stick2"></th>`;
  rows.forEach((r, i) => { h += `<th data-i="${i}" class="tcol ${dstart.has(i) ? "dcol" : ""} ${S.hoverRow === i ? "hov" : ""}">${tlab(r)}${r.len > 1 ? `<small>${r.len} h</small>` : ""}</th>`; });
  h += `</tr></thead><tbody>`;
  const gcount = {}; PARAMS.forEach(p => gcount[p.g] = (gcount[p.g] || 0) + 1);
  let lastG = null;
  for (const p of PARAMS){
    const gs = p.g !== lastG; lastG = p.g;
    h += `<tr class="${gs ? "gfirst" : ""}">`;
    if (gs) h += `<th class="stick grp" rowspan="${gcount[p.g]}">${grpLabel(p.g)}</th>`;
    h += `<th class="stick2 plab ${keysOf(prefs.param).includes(p.k) ? "sel" : ""}" data-p="${p.k}" title="${p.title}">${colLabel(p, s)}${p.s ? ` <small>${p.s}</small>` : ""}</th>`;
    const spm = spanMap(p.k);
    rows.forEach((r, i) => {
      const sp = spm[i]; if (sp.cov) return;
      const v = o[p.k][i], na = v === undefined, edd = e[p.k] && e[p.k][r.key] !== undefined;
      const bad = QC.bad[p.k] && QC.bad[p.k][i], cur = S.cur && S.cur.i === i && S.cur.k === p.k;
      const c = `c ${dstart.has(i) ? "dcol" : ""} ${na ? "na" : ""} ${edd ? "ed" : ""} ${bad ? "bad" : ""} ${cur ? "cur" : ""} ${S.hoverRow === i ? "hov" : ""}`;
      h += `<td class="${c}${sp.s > 1 ? " span" : ""}" data-k="${p.k}" data-i="${i}"${sp.s > 1 ? ` colspan="${sp.s}"` : ""} style="${na ? "" : tint(p, v)}" title="${bad || cellTitle(p, r, i)}">${na ? "–" : p.kind === "sev" && v !== "-" ? v : fmt(p, v)}</td>`;
    });
    h += `</tr>`;
  }
  h += `</tbody></table>`;
  const m = $("matrix"), st = m.scrollTop, sl = m.scrollLeft;
  m.innerHTML = h; m.scrollTop = st; m.scrollLeft = sl;
}
const across = () => prefs.orient === "across";
function renderMatrix(){ across() ? renderTableAcross() : renderTable(); }
/* hover highlight for the hovered time, in either orientation */
function markHover(i){
  const mx = $("matrix");
  mx.querySelectorAll(".hov").forEach(x => x.classList.remove("hov"));
  if (i == null) return;
  if (across()) mx.querySelectorAll(`[data-i="${i}"]`).forEach(x => x.classList.add("hov"));
  else { const tr = mx.querySelector(`tr[data-r="${i}"]`); if (tr) tr.classList.add("hov"); }
}
/* arrow / Enter / Tab move on screen: convert to (time step, parameter step) */
const visStep = (down, right) => across() ? [right, down] : [down, right];
function renderAll(){ recompute(); renderSites(); renderParams(); renderStatus(); renderMatrix(); renderChart(); }

/* ---------- editing ---------- */
function parseInput(p, txt){
  txt = String(txt).trim(); if (txt === "") return null;
  if (p.kind === "sky"){ const u = txt.toUpperCase(); const alias = { CLEAR:"CLR", SKC:"CLR", SCATTERED:"SCT", BROKEN:"BKN", OVERCAST:"OVC" }; const c = alias[u] || u; if (SKY_MID[c] !== undefined) return SKY_MID[c]; const n = parseFloat(txt); return isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : undefined; }
  if (p.kind === "dir"){ const d = parseDir(txt); return d == null ? undefined : (Math.round(d/10)*10) % 360; }
  if (p.kind === "sev"){ const u = txt.toUpperCase(); const map = { NONE:"-", "-":"-", MARGINAL:"MRGL", SLIGHT:"SLGT", ENHANCED:"ENH", MODERATE:"MDT" }; const c = map[u] || u; return SEV.includes(c) ? c : undefined; }
  let n = parseFloat(txt.replace("%", "")); if (!isFinite(n)) return undefined;
  if (isWind(p) && wfac() !== 1) return Math.max(0, Math.round(n/wfac()*10)/10);   /* typed in the display unit, stored in knots */
  if (p.kind === "prob" && n > 0 && n < 1 && txt.includes(".")) n *= 100;
  if (p.lo != null) n = Math.max(p.lo, n); if (p.hi != null) n = Math.min(p.hi, n);
  return Math.round(n);
}
function setEdit(sid, k, key, val, group){
  const e = edits[sid] = edits[sid] || {}; const m = e[k] = e[k] || {};
  const old = m[key];
  if (val === undefined || val === null) delete m[key]; else m[key] = val;
  if (old !== m[key]) group.push({ sid, k, key, old, nw: m[key] });
}
/* store an edit, dropping it if it equals guidance */
function writeCell(k, i, val, group){
  const r = S.rows[i], p = P[k];
  if (OF.o[k][i] === undefined && p.kind === "prob") return;
  const g = OF.g[k] ? OF.g[k][i] : null;
  if (val === null) return setEdit(prefs.site, k, r.key, undefined, group);
  /* values that follow other cells (linked probabilities, peaks, WBGT, exceedances) keep any typed value as an edit */
  const linked = /^(pp|lt)\d$|^g\d+$|^wbgt$|^x/.test(k);
  const same = !linked && (p.kind === "sky" ? skyCat(val) === skyCat(g) && Math.abs(val - (g ?? -99)) < 1 : val === g);
  setEdit(prefs.site, k, r.key, same ? undefined : val, group);
}
function commit(group){
  if (!group.length) return;
  S.undo.push(group); if (S.undo.length > 200) S.undo.shift(); S.redo = [];
  saveEdits(); renderAll();
}
function applyGroup(group, dir){
  for (const c of (dir < 0 ? [...group].reverse() : group)){
    const e = edits[c.sid] = edits[c.sid] || {}; const m = e[c.k] = e[c.k] || {};
    const v = dir < 0 ? c.old : c.nw; if (v === undefined) delete m[c.key]; else m[c.key] = v;
  }
  saveEdits();
  if (group[0] && group[0].sid !== prefs.site){ prefs.site = group[0].sid; savePrefs(); }
  renderAll();
}
function undo(){ const g = S.undo.pop(); if (!g) return; S.redo.push(g); applyGroup(g, -1); toast("Undone"); }
function redo(){ const g = S.redo.pop(); if (!g) return; S.undo.push(g); applyGroup(g, 1); }

let editor = null;
function cellEl(i, k){ return $("matrix").querySelector(`td.c[data-i="${i}"][data-k="${k}"]`); }
function selectCell(i, k, scroll){
  S.cur = { i, k };
  $("matrix").querySelectorAll("td.cur").forEach(x => x.classList.remove("cur"));
  const el = cellEl(i, k); if (el){ el.classList.add("cur"); if (scroll) el.scrollIntoView({ block:"nearest", inline:"nearest" }); }
  if (viewOf(k) !== prefs.param && P[k].kind !== "sev"){ clearSel(); prefs.param = viewOf(k); savePrefs(); renderParams(); renderChart(); $("matrix").querySelectorAll("th.sel").forEach(x => x.classList.remove("sel")); keysOf(prefs.param).forEach(q => { const th = $("matrix").querySelector(`th[data-p="${q}"]`); if (th) th.classList.add("sel"); }); }
}
function openEditor(i, k, initial){
  const el = cellEl(i, k); if (!el || el.classList.contains("na")) return;
  const p = P[k], cur = OF.o[k][i];
  closeEditor(false);
  let inp;
  if (p.kind === "sky" || p.kind === "sev"){
    inp = document.createElement("select");
    const opts = p.kind === "sky" ? SKY.map(x => x[0]) : SEV;
    inp.innerHTML = opts.map(x => `<option value="${x}" ${(p.kind === "sky" ? skyCat(cur) : cur) === x ? "selected" : ""}>${p.kind === "sev" ? SEV_NAME[x] : x}</option>`).join("");
    inp.addEventListener("change", () => finishEditor(true, 0));
  } else {
    inp = document.createElement("input"); inp.type = "text"; inp.inputMode = p.kind === "dir" ? "text" : "decimal";
    inp.value = initial != null ? initial : p.kind === "prob" ? (cur == null ? "" : String(cur)) : fmt(p, cur);
  }
  el.appendChild(inp); editor = { i, k, inp };
  inp.focus(); if (initial == null && inp.select) inp.select();
  inp.addEventListener("keydown", ev => {
    if (ev.key === "Enter"){ ev.preventDefault(); finishEditor(true, ...visStep(1, 0)); }
    else if (ev.key === "Tab"){ ev.preventDefault(); finishEditor(true, ...visStep(0, ev.shiftKey ? -1 : 1)); }
    else if (ev.key === "Escape"){ ev.preventDefault(); closeEditor(false); $("matrix").focus(); }
    ev.stopPropagation();
  });
  inp.addEventListener("blur", () => setTimeout(() => { if (editor && editor.inp === inp) finishEditor(true, 0); }, 0));
}
function finishEditor(save, down, right){
  if (!editor) return;
  const { i, k, inp } = editor; editor = null;
  if (save){
    const v = parseInput(P[k], inp.value);
    if (v === undefined){ toast(`Couldn't read "${inp.value}" as ${P[k].title.toLowerCase()}`); }
    else { const g = []; writeCell(k, i, v, g); if (g.length) commit(g); }
  }
  if (inp.parentNode) inp.remove();
  if (!save) return;
  let ni = i, kidx = PARAMS.findIndex(p => p.k === k);
  if (down > 0){ const sp = spanMap(k)[i]; ni = i + (sp && sp.s ? sp.s : 1); } else if (down < 0) ni = i - 1;
  ni = Math.max(0, Math.min(S.rows.length - 1, ni));
  if (right) kidx = Math.max(0, Math.min(PARAMS.length - 1, kidx + right));
  ni = ownerIdx(PARAMS[kidx].k, ni);
  renderMatrix(); selectCell(ni, PARAMS[kidx].k, true); $("matrix").focus({ preventScroll:true });
}
function closeEditor(){ if (editor){ editor.inp.remove(); editor = null; } }

/* ============================================================
   Graph editor
   ============================================================ */
const CH = { m:{ l:46, r:14, t:22, b:30 }, w:0, h:300, x:null, y:null, pts:[], drag:null };
function chartDomain(p, pts, A, srcv){
  if (p.kind === "prob" || p.kind === "sky") return [0, 100];
  if (p.kind === "dir") return [0, 360];
  let lo = Infinity, hi = -Infinity;
  const acc = v => { if (v != null && isFinite(v)){ lo = Math.min(lo, v); hi = Math.max(hi, v); } };
  pts.forEach(q => { acc(q.v); acc(q.g); });
  (A.band[p.k] || []).forEach(b => { if (b){ acc(b[0]); acc(b[1]); } });
  for (const id in (srcv || {})) (srcv[id] || []).forEach(acc);
  if (!isFinite(lo)){ lo = 0; hi = 10; }
  const padv = Math.max(2, (hi - lo)*0.1); lo -= padv; hi += padv;
  if (p.lo === 0) lo = Math.max(0, lo);
  if (p.unit === "kt") hi = Math.max(hi, 20);
  /* on the exposure page keep the constraint limits in view */
  if (EXPO){ const lims = p.unit === "kt" ? keysOf(prefs.param).flatMap(k => P[k].thr || []) : p.k === "t" ? PARAMS.filter(q => q.ex === "tmax" || q.ex === "tmin").map(q => q.v) : []; for (const v of lims){ hi = Math.max(hi, v + 3); lo = Math.min(lo, v - 3); } }
  return [Math.floor(lo), Math.ceil(hi)];
}
function srcColor(id){ const s = ALL_SOURCES.find(x => x.id === id); return s ? FAMILIES[s.fam].color : "var(--ink-3)"; }
const VIEWS = {
  pp:   { title:"Precipitation probability", keys:["pp1","pp3","pp6"], names:["1 hr","3 hr","6 hr"], prob:true },
  lt:   { title:"Lightning probability",     keys:["lt1","lt3","lt6"], names:["1 hr","3 hr","6 hr"], prob:true },
};
/* one combined sustained/peak view per wind height */
function rebuildViews(){
  for (const k of Object.keys(VIEWS)) if (/^w\d+$/.test(k)) delete VIEWS[k];
  for (const ft of HEIGHTS) if (P["s" + ft] && P["g" + ft]) VIEWS["w" + ft] = { title:`${ft} ft wind`, chip:`${ft} ft`, keys:["s" + ft, "g" + ft], names:["Sustained","Peak"] };
}
rebuildViews();
const viewOf = k => /^[sg]\d+$/.test(k) && VIEWS["w" + k.slice(1)] ? "w" + k.slice(1) : /^pp\d$/.test(k) ? "pp" : /^lt\d$/.test(k) ? "lt" : k;
const isProbView = v => !!(VIEWS[v] && VIEWS[v].prob);
/* the cell that sets a row's own value (1 hr on hourly rows, 3 hr on 3 h blocks, 6 hr on 6 h blocks) */
const isBaseCell = (k, i) => { const p = P[k]; if (!p.win) return true; const len = S.rows[i].len; return p.win === (len === 1 ? 1 : len <= 3 ? 3 : 6); };
const drawKey = ks => prefs.draw === "s" ? ks[0] : prefs.draw === "p" ? ks[1] : ks.includes(prefs.draw) ? prefs.draw : null;
const keysOf = v => VIEWS[v] ? VIEWS[v].keys : [v];
const seriesName = k => { const v = VIEWS[viewOf(k)]; return v ? v.names[v.keys.indexOf(k)] : P[k].title; };
/* which series a drag edits in a combined view: nearest line, or the locked one */
function pickKey(i, py){
  const ks = keysOf(prefs.param); if (ks.length === 1) return ks[0];
  const dk = drawKey(ks); if (dk) return dk;
  let best = ks[0], d = Infinity;
  for (const k of ks){ const v = OF.o[k][ownerIdx(k, i)]; if (v == null) continue; const dd = Math.abs(CH.y(Math.max(CH.y0, Math.min(CH.y1, v))) - py); if (dd < d){ d = dd; best = k; } }
  return best;
}
/* Two layers: the background (grid, guidance, sources, member band) is drawn only when the parameter,
   point or guidance changes; the foreground (official values, handles, selection) is redrawn while editing.
   While dragging, the y-axis stays fixed so the background stays valid. */
function renderChartFg(){ renderChart(true); }
function renderChart(fgOnly){
  const svg = $("chart"), view = prefs.param, ks = keysOf(view), combo = ks.length > 1, p = P[ks[0]] || P.t, s = site();
  $("ptitle").textContent = combo ? VIEWS[view].title : p.k === "xhot" ? `Temperature above ${hotOf(s)}°F` : p.title;
  $("punit").textContent = p.kind === "prob" ? "percent chance" : p.kind === "sky" ? "percent cloud cover (categories at right)" : p.kind === "dir" ? "degrees true, toward the points" : isWind(p) ? wuLabel() : p.unit || "";
  $("drawWrap").hidden = !(combo && prefs.cmode === "draw");
  $("modeSel").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.m === prefs.cmode));
  $("phint").textContent = prefs.cmode === "draw"
    ? "Drag across the graph to draw the forecast. Alt-drag erases back to guidance. Hold Ctrl to see the guidance values."
    : "Click a point to select it, or drag across the graph to select several. Then drag a selected point, or use the arrow keys, to move them. Shift-click adds points. Hold Ctrl to see the guidance values.";
  updateSelInfo();
  const pview = isProbView(view);
  if (!fgOnly) $("legend").innerHTML = pview
    ? `<span><i class="bar"></i>1 hr</span><span><i class="off"></i>3 hr</span><span><i class="off pk"></i>6 hr</span><span><i class="gd"></i>Guidance</span>`
    : `<span><i class="off"></i>${combo ? "Sustained" : "Official"}</span>${combo ? `<span><i class="off pk"></i>Peak</span>` : ""}<span><i class="gd"></i>Guidance blend</span><span><i class="src"></i>Sources</span><span><i class="bd"></i>Member 10th to 90th</span>`;
  if (combo && !fgOnly){ const dk = drawKey(ks) || "n"; $("drawSel").innerHTML = `<button type="button" data-d="n" aria-pressed="${dk === "n"}" title="Draw whichever line you start nearest">Nearest</button>` + ks.map((k, j) => `<button type="button" data-d="${k}" aria-pressed="${dk === k}">${VIEWS[view].names[j]}</button>`).join(""); }
  if (pview && prefs.cmode !== "draw") $("phint").textContent = (prefs.linkWin !== false ? "1, 3 and 6 hr are linked: change any of them and the others follow. " : "") + "Click a bar or step to select it, or drag across the graph to select the hourly or block values. Drag or use the arrow keys to move them. Hold Ctrl to see the guidance values.";
  const W = svg.clientWidth || 900, Hh = CH.h; CH.w = W;
  const A = S.agg[s.id] || { val:{}, srcv:{}, band:{} };
  const rows = S.rows, n = rows.length, { o, g } = OF;
  const srcOf = k => k.startsWith("x") ? OF.xsrc[k] : A.srcv[k] || {};
  const ptsOf = k => rows.map((r, i) => ({ i, v:o[k][i], g:g[k] ? g[k][i] : null, ed: ((edits[s.id] || {})[k] || {})[r.key] !== undefined })).filter(q => q.v !== undefined);
  const allPts = ks.flatMap(ptsOf); CH.pts = allPts; CH.hits = [];
  const na = rows.map((r, i) => o[ks[0]][i] === undefined);   /* rows where this window doesn't apply: draw across them */
  /* domain across every series in the view */
  const merged = {}; ks.forEach((k, j) => { const sv = srcOf(k); for (const id in sv) merged[id + "_" + j] = sv[id]; });
  const bandAll = { band:{ [p.k]: rows.map((r, i) => { const bs = ks.map(k => (A.band[k] || [])[i]).filter(Boolean); return bs.length ? [Math.min(...bs.map(b => b[0])), Math.max(...bs.map(b => b[1]))] : null; }) } };
  const layoutKey = [view, s.id, svg.clientWidth || 900, zulu(), S.rows.length, wuLabel()].join("|");
  const full = !fgOnly || !CH.layout || CH.layout.key !== layoutKey;
  const sc = isWind(p) ? wfac() : 1;
  const dom = full ? chartDomain(p, allPts, bandAll, merged) : null;
  const [y0, y1] = !full ? [CH.layout.y0, CH.layout.y1] : sc === 1 ? dom : [Math.floor(dom[0]*sc), Math.ceil(dom[1]*sc)];
  if (full) CH.layout = { key:layoutKey, y0, y1 };
  const L = CH.m.l, R = W - CH.m.r, T = CH.m.t, B = Hh - CH.m.b;
  const x = i => L + (i + 0.5) * (R - L)/n, yD = v => B - (v - y0)/(y1 - y0)*(B - T), y = v => yD(v*sc);
  const colW = (R - L)/n;
  const spanOf = (k, i) => { const sp = spanMap(k)[i]; return sp && sp.s ? sp.s : 1; };
  const xk = k => i => L + (i + spanOf(k, i)/2) * colW;   /* centre of the period a value covers */
  CH.xk = xk;
  CH.sc = sc; CH.x = x; CH.y = y; CH.inv = py => y0 + (B - py)/(B - T)*(y1 - y0); CH.ix = px => Math.max(0, Math.min(n - 1, Math.floor((px - L)/((R - L)/n)))); CH.y0 = y0; CH.y1 = y1;
  let h = "", f = "";
  const z = zulu(); let start = 0, band = 0;
  if (full) for (let i = 1; i <= n; i++){
    if (i === n || dayKey(rows[i].a, z) !== dayKey(rows[start].a, z)){
      const xa = L + start*(R - L)/n, xb = L + i*(R - L)/n;
      if (band % 2 === 0) h += `<rect class="dayband" x="${xa}" y="${T}" width="${xb - xa}" height="${B - T}"/>`;
      const Lb = dayLabel(rows[start].a, z); if (xb - xa > 34) h += `<text class="daylab" x="${xa + 5}" y="${T - 7}">${Lb.wd.slice(0,3)} ${Lb.dt}</text>`;
      start = i; band++;
    }
  }
  const step = p.kind === "dir" ? 90 : p.kind === "prob" || p.kind === "sky" ? 20 : niceStep((y1 - y0)/5);
  if (full){
  for (let v = Math.ceil(y0/step)*step; v <= y1 + 1e-9; v += step){ const yy = yD(v); h += `<line class="grid" x1="${L}" x2="${R}" y1="${yy}" y2="${yy}"/><text class="axis" x="${L - 7}" y="${yy + 4}" text-anchor="end">${p.kind === "dir" ? compass(v) : v}</text>`; }
  rows.forEach((r, i) => { const hh = z ? new Date(r.a).getUTCHours() : r.lh; if (hh % 6 === 0 && (r.len < 6 || hh % 12 === 0)) h += `<text class="axis" x="${x(i)}" y="${B + 16}" text-anchor="middle">${pad2(hh)}</text>`; });
  const tempThr = () => EXPO ? PARAMS.filter(q => q.ex === "tmax" || q.ex === "tmin").map(q => Math.round(q.v)) : [hotOf(s), 40, 32];
  const thr = pview ? [] : combo ? [...new Set(ks.flatMap(k => P[k].thr || []))] : p.thr ? p.thr.slice() : p.k === "t" ? tempThr() : p.k === "wbgt" ? [82, 85, 88, 90] : [];
  thr.filter(v => v*sc > y0 && v*sc < y1).forEach(v => { h += `<line class="thr" x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}"/><text class="thrlab" x="${R - 3}" y="${y(v) - 4}" text-anchor="end">${p.unit === "kt" ? Math.round(v*sc) + " " + wuLabel() : v + "°"}</text>`; });
  if (p.kind === "sky") SKY.forEach(([c, a, b]) => { const yy = y(Math.min(100, (a + Math.min(b, 100))/2)); h += `<text class="thrlab" style="fill:var(--ink-3)" x="${R - 3}" y="${yy + 4}" text-anchor="end">${c}</text>`; if (a > 0) h += `<line class="grid" x1="${L}" x2="${R}" y1="${y(a)}" y2="${y(a)}" style="stroke-dasharray:2 3"/>`; });
  }
  const line = (arr, cls, style, xf) => { xf = xf || x; let d = "", pen = false; arr.forEach((v, i) => { if (v === undefined && na[i]) return; if (v == null || !isFinite(v)){ pen = false; return; } d += (pen ? "L" : "M") + xf(i).toFixed(1) + "," + y(Math.max(y0, Math.min(y1, v))).toFixed(1); pen = true; }); return d ? `<path class="${cls}" d="${d}" style="${style || ""}"/>` : ""; };
  if (pview){
    /* 1 hr as bars, 3 and 6 hr as steps over the periods they cover */
    const pad = Math.min(3, colW*0.18);
    ks.forEach((k, j) => {
      ptsOf(k).forEach(q => {
        const sp = spanOf(k, q.i), xa = L + q.i*colW, xb = L + (q.i + sp)*colW, id = k + "|" + q.i, sel = CH.sel.has(id);
        if (full && q.g != null && q.g !== undefined) h += `<line class="gstep" x1="${(xa + pad).toFixed(1)}" x2="${(xb - pad).toFixed(1)}" y1="${y(q.g)}" y2="${y(q.g)}"/>`;
        if (q.v == null) return;
        const cy = y(Math.max(y0, Math.min(y1, q.v))), cx = (xa + xb)/2;
        if (j === 0) f += `<rect class="pbar ${q.ed ? "e" : ""} ${sel ? "s" : ""}" x="${(xa + pad).toFixed(1)}" y="${cy.toFixed(1)}" width="${Math.max(1, xb - xa - 2*pad).toFixed(1)}" height="${Math.max(0, B - cy).toFixed(1)}"/>`;
        else f += `<line class="pstep s${j} ${sel ? "s" : ""}" x1="${(xa + pad).toFixed(1)}" x2="${(xb - pad).toFixed(1)}" y1="${cy}" y2="${cy}"/>`;
        CH.hits.push({ k, i:q.i, x:cx, y:cy });
        if (sel) f += `<circle class="selring" cx="${cx}" cy="${cy}" r="7.5"/>`;
        f += `<circle class="h ${j === 2 ? "pk" : ""} ${j === 0 ? "b" : ""} ${q.ed ? "e" : ""} ${sel ? "s" : ""}" cx="${cx}" cy="${cy}" r="${sel ? 4.6 : j === 0 ? 2.4 : 3.2}"/>`;
      });
    });
  } else {
  if (full) ks.forEach((k, j) => {
    const bnd = A.band[k] || [];
    if (p.kind !== "dir" && bnd.some(b => b)){
      let seg = [];
      const flush = () => { if (seg.length > 1) h += `<path class="band ${j ? "pk" : ""}" d="M${seg.map(i => `${x(i)},${y(Math.max(y0, Math.min(y1, bnd[i][1])))}`).join("L")}L${seg.slice().reverse().map(i => `${x(i)},${y(Math.max(y0, Math.min(y1, bnd[i][0])))}`).join("L")}Z"/>`; seg = []; };
      rows.forEach((r, i) => { if (bnd[i]) seg.push(i); else flush(); }); flush();
    }
  });
  if (full) ks.forEach((k, j) => {
    const srcv = srcOf(k);
    for (const id in srcv){
      const arr = rows.map((r, i) => srcv[id][i]);
      if (p.kind === "dir"){ arr.forEach((v, i) => { if (v != null) h += `<circle cx="${x(i)}" cy="${y(v)}" r="1.8" fill="${srcColor(id)}" opacity=".45"/>`; }); }
      else h += line(arr, "src", `stroke:${srcColor(id)}${j ? ";stroke-dasharray:3 2" : ""}`, xk(k));
    }
  });
  ks.forEach((k, j) => {
    const garr = rows.map((r, i) => g[k] ? g[k][i] : null), oarr = rows.map((r, i) => o[k][i]);
    const xf = xk(k);
    if (P[k].win > 1) ptsOf(k).forEach(q => { if (q.v == null) return; const sp = spanOf(k, q.i); if (sp > 1) f += `<line class="spanbar ${j ? "pk" : ""}" x1="${(L + q.i*colW + 2).toFixed(1)}" x2="${(L + (q.i + sp)*colW - 2).toFixed(1)}" y1="${y(q.v)}" y2="${y(q.v)}"/>`; });
    if (p.kind !== "dir"){ if (full) h += line(garr, "guide", "", xf); f += line(oarr, "off" + (j ? " pk" : ""), "", xf); }
    ptsOf(k).forEach(q => {
      if (q.v == null) return;
      const cx = xf(q.i), cy = y(Math.max(y0, Math.min(y1, q.v))), id = k + "|" + q.i;
      CH.hits.push({ k, i:q.i, x:cx, y:cy });
      if (CH.sel.has(id)) f += `<circle class="selring" cx="${cx}" cy="${cy}" r="7.5"/>`;
      f += `<circle class="h ${j ? "pk" : ""} ${q.ed ? "e" : ""} ${CH.sel.has(id) ? "s" : ""}" cx="${cx}" cy="${cy}" r="${CH.sel.has(id) ? 4.6 : n > 90 ? 2.6 : 3.4}"/>`;
    });
    if (combo){ const last = ptsOf(k).filter(q => q.v != null).pop(); if (last) f += `<text class="serlab ${j ? "pk" : ""}" x="${x(last.i) + 6}" y="${y(last.v) + 4}">${j ? "Pk" : "Sus"}</text>`; }
  });
  }
  if (CH.drag && CH.drag.kind === "marq"){ const d = CH.drag; f += `<rect class="marq" x="${Math.min(d.x0, d.x1)}" y="${Math.min(d.y0, d.y1)}" width="${Math.abs(d.x1 - d.x0)}" height="${Math.abs(d.y1 - d.y0)}"/>`; }
  if (!allPts.some(q => q.v != null)) f += `<text class="axis" x="${(L + R)/2}" y="${(T + B)/2}" text-anchor="middle" style="font-size:14px">${S.loading ? "Loading guidance" : "No guidance for this parameter. Drag on the graph to draw a forecast."}</text>`;
  CH.cursorY = [T, B];
  if (full){
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`); svg.style.height = Hh + "px";
    svg.innerHTML = `<g id="chBg">${h}</g><g id="chFg">${f}</g><line id="chCur" class="cursor" x1="0" x2="0" y1="${T}" y2="${B}" style="display:none"/>`;
  } else $("chFg").innerHTML = f;
  moveCursor(S.hoverRow);
}
/* hover cursor: move one line instead of redrawing */
function moveCursor(i){
  const c = document.getElementById("chCur"); if (!c) return;
  if (i == null || !CH.x){ c.style.display = "none"; return; }
  const xx = CH.x(i); c.setAttribute("x1", xx); c.setAttribute("x2", xx); c.style.display = "";
}
function niceStep(s){ const e = Math.pow(10, Math.floor(Math.log10(s))); const f = s/e; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10)*e; }
function chartValue(py, k){
  const p = P[k];
  if (isWind(p) && (CH.sc || 1) !== 1){ const vd = Math.max(0, Math.round(CH.inv(py))); return Math.round(vd/CH.sc*10)/10; }
  let v = CH.inv(py);
  v = Math.max(p.lo ?? CH.y0, Math.min(p.hi ?? CH.y1, v));
  const st = p.step || 1; v = Math.round(v/st)*st;
  if (p.kind === "dir") v = ((v % 360) + 360) % 360;
  return v;
}
function paintRange(k, i0, v0, i1, v1, erase){
  const lo = Math.min(i0, i1), hi = Math.max(i0, i1);
  for (let i = lo; i <= hi; i++){
    if (OF.o[k][i] === undefined) continue;
    const f = i1 === i0 ? 1 : (i - i0)/(i1 - i0);
    let v = v0 + (v1 - v0)*f; const st = P[k].step || 1; v = Math.round(v/st)*st;
    writeCell(k, i, erase ? null : v, CH.drag.group);
  }
}
let tableTimer = null;
let liveFrame = 0;
function liveRefresh(){
  if (liveFrame) return;
  liveFrame = requestAnimationFrame(() => {
    liveFrame = 0;
    OF = officialFor(prefs.site, true);
    renderChartFg();
    if (!tableTimer) tableTimer = setTimeout(() => { tableTimer = null; updateCells(keysOf(prefs.param)); }, 120);
  });
}
/* update only the matrix cells of the parameters being edited */
function updateCells(ks){
  const mx = $("matrix"), s = site(), e = edits[s.id] || {};
  const extra = { t:["wbgt"], td:["wbgt"] }; PARAMS.filter(p => p.peakOf).forEach(p => extra[p.peakOf] = [p.k]);
  const all = new Set(ks); ks.forEach(k => (extra[k] || []).forEach(x => all.add(x)));
  for (const k of all){
    const p = P[k]; if (!p) continue;
    mx.querySelectorAll(`td.c[data-k="${k}"]`).forEach(td => {
      const i = +td.dataset.i, v = OF.o[k][i]; if (v === undefined) return;
      const txt = across() && p.kind === "sev" && v !== "-" ? v : fmt(p, v);
      if (td.textContent !== txt && !td.querySelector("input,select")) td.textContent = txt;
      td.style.cssText = tint(p, v);
      td.classList.toggle("ed", e[k] && e[k][S.rows[i].key] !== undefined);
    });
  }
}
function chartPos(ev){ const r = $("chart").getBoundingClientRect(); return { px: (ev.clientX - r.left) * (CH.w / r.width), py: (ev.clientY - r.top) * (CH.h / r.height) }; }
/* ---------- selection helpers ---------- */
CH.sel = new Set();
function clearSel(){ CH.sel = new Set(); }
function selList(){ return [...CH.sel].map(id => { const [k, i] = id.split("|"); return { k, i:+i }; }).filter(q => OF.o[q.k] && OF.o[q.k][q.i] != null); }
const rawEdit = (k, key) => ((edits[prefs.site] || {})[k] || {})[key];
function hitTest(px, py){
  let best = null, d = Infinity;
  for (const h of CH.hits){ const dd = Math.hypot((h.x - px)*1.0, (h.y - py)*0.8); if (dd < d){ d = dd; best = h; } }
  return d <= 14 ? best : null;
}
function updateSelInfo(){
  const n = CH.sel.size, el = $("selinfo"); if (!el) return;
  el.textContent = n ? `${n} point${n > 1 ? "s" : ""} selected` : "";
  const scope = n ? `${n} point${n > 1 ? "s" : ""}` : "all";
  $("nudgeUp").textContent = `Raise ${scope}`; $("nudgeDn").textContent = `Lower ${scope}`;
  $("resetParam").textContent = n ? "Reset selected to guidance" : "Reset parameter to guidance";
  $("setGo").textContent = n ? `Set ${scope}` : "Set all";
}
/* apply f(value, k) -> new value to the selection (or every point of the view) as one undo step */
function applyToPoints(f, list){
  const g = [];
  for (const q of list){ const v = OF.o[q.k][q.i]; if (v == null || v === undefined) continue; writeCell(q.k, q.i, f(v, q.k), g); }
  commit(g); return g.length;
}
function scopePoints(){
  if (CH.sel.size) return selList();
  const out = [], pv = isProbView(prefs.param), locked = toolKeysG().length === 1 && keysOf(prefs.param).length > 1;
  for (const k of toolKeysG()) S.rows.forEach((r, i) => { if (OF.o[k][i] != null && (!pv || locked || isBaseCell(k, i))) out.push({ k, i }); });
  return out;
}
const toolKeysG = () => { const ks = keysOf(prefs.param); const dk = ks.length > 1 && prefs.cmode === "draw" ? drawKey(ks) : null; return dk ? [dk] : ks; };
const clampV = (k, v) => { const p = P[k], st = p.step || 1; v = Math.round(v/st)*st; if (p.kind === "dir") return ((v % 360) + 360) % 360; if (p.lo != null) v = Math.max(p.lo, v); if (p.hi != null) v = Math.min(p.hi, v); return v; };
function nudgeSel(d){ const n = applyToPoints((v, k) => clampV(k, v + d*(P[k].step || 1)), scopePoints()); if (!n) toast("Nothing to move"); }

/* ---------- chart interaction ---------- */
const MOUSE = { x:0, y:0, i:null, in:false, ctrl:false };
function bindChart(){
  const svg = $("chart");
  svg.addEventListener("pointerdown", ev => {
    if (ev.button !== 0 || P[keysOf(prefs.param)[0]].kind === "sev") return;
    svg.focus({ preventScroll:true });
    svg.setPointerCapture(ev.pointerId);
    const { px, py } = chartPos(ev);
    $("tip").style.display = "none";
    if (prefs.cmode === "draw"){
      const i = CH.ix(px), k = pickKey(i, py), v = chartValue(py, k);
      CH.drag = { kind:"paint", k, i, v, erase: ev.altKey, group: [] };
      paintRange(k, i, v, i, v, ev.altKey); liveRefresh(); return;
    }
    const hit = hitTest(px, py);
    if (hit){
      const id = hit.k + "|" + hit.i;
      if (ev.shiftKey){ if (CH.sel.has(id)) CH.sel.delete(id); else CH.sel.add(id); }
      else if (!CH.sel.has(id)) CH.sel = new Set([id]);
      const snap = selList().map(q => ({ ...q, key:S.rows[q.i].key, val:OF.o[q.k][q.i], raw:rawEdit(q.k, S.rows[q.i].key) }));
      CH.drag = { kind:"move", py0:py, moved:false, snap };
      svg.style.cursor = "ns-resize";
    } else {
      CH.drag = { kind:"marq", x0:px, y0:py, x1:px, y1:py, base: ev.shiftKey ? new Set(CH.sel) : new Set() };
    }
    renderChartFg();
  });
  let pmEv = null, pmFrame = 0;
  svg.addEventListener("pointermove", ev => {
    pmEv = ev; if (pmFrame) return;
    pmFrame = requestAnimationFrame(() => { pmFrame = 0; const e = pmEv; pmEv = null; if (e) onMove(e); });
  });
  const onMove = ev => {
    const { px, py } = chartPos(ev); const i = CH.ix(px);
    MOUSE.x = ev.clientX; MOUSE.y = ev.clientY; MOUSE.i = i; MOUSE.in = true;
    const d = CH.drag;
    if (d && d.kind === "paint"){ const v = chartValue(py, d.k); paintRange(d.k, d.i, d.v, i, v, d.erase || ev.altKey); d.i = i; d.v = v; liveRefresh(); }
    else if (d && d.kind === "move"){
      const dv = (CH.inv(py) - CH.inv(d.py0))/(CH.sc || 1);
      if (!d.moved && Math.abs(py - d.py0) < 3) return;
      d.moved = true;
      const tmp = [];
      for (const q of d.snap){ writeCell(q.k, q.i, clampV(q.k, q.val + dv), tmp); }
      liveRefresh();
    }
    else if (d && d.kind === "marq"){
      d.x1 = px; d.y1 = py;
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      const sel = new Set(d.base);
      /* a thin drag selects every point in those columns; a box selects only the points inside it */
      const tall = y1 - y0 < 6;
      const pv = isProbView(prefs.param);
      for (const h of CH.hits) if (h.x >= x0 && h.x <= x1 && (tall ? (!pv || isBaseCell(h.k, h.i)) : (h.y >= y0 && h.y <= y1))) sel.add(h.k + "|" + h.i);
      CH.sel = sel; renderChartFg();
    }
    else {
      const hit = prefs.cmode === "select" ? hitTest(px, py) : null;
      svg.style.cursor = hit ? (CH.sel.has(hit.k + "|" + hit.i) ? "ns-resize" : "pointer") : prefs.cmode === "draw" ? "crosshair" : "default";
    }
    hover(i, ev);
  };
  const end = () => {
    if (pmFrame){ cancelAnimationFrame(pmFrame); pmFrame = 0; if (pmEv){ const e = pmEv; pmEv = null; onMove(e); } }
    if (liveFrame){ cancelAnimationFrame(liveFrame); liveFrame = 0; }
    const d = CH.drag; if (!d) return; CH.drag = null;
    if (d.kind === "paint"){ if (d.group.length){ S.undo.push(d.group); S.redo = []; saveEdits(); } renderAll(); return; }
    if (d.kind === "move"){
      if (d.moved){
        const g = [];
        for (const q of d.snap){ const nw = rawEdit(q.k, q.key); if (nw !== q.raw) g.push({ sid:prefs.site, k:q.k, key:q.key, old:q.raw, nw }); }
        if (g.length){ S.undo.push(g); S.redo = []; saveEdits(); }
      }
      renderAll(); return;
    }
    if (d.kind === "marq"){ if (Math.abs(d.x1 - d.x0) < 4 && Math.abs(d.y1 - d.y0) < 4 && !d.base.size) clearSel(); renderChartFg(); }
  };
  svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
  svg.addEventListener("pointerleave", () => { MOUSE.in = false; if (!CH.drag){ hover(null); } });
  svg.addEventListener("dblclick", ev => { const { px, py } = chartPos(ev); const hit = hitTest(px, py); if (!hit) return; const g = []; writeCell(hit.k, hit.i, null, g); commit(g); });
  svg.addEventListener("keydown", ev => {
    if (ev.key === "ArrowUp" || ev.key === "ArrowDown"){ ev.preventDefault(); if (!CH.sel.size){ toast("Select points first (click, or drag across the graph)"); return; } nudgeSel((ev.key === "ArrowUp" ? 1 : -1)*(ev.shiftKey ? 5 : 1)); }
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowRight"){
      ev.preventDefault(); if (CH.sel.size !== 1) return;
      const q = selList()[0]; if (!q) return; const pts = CH.hits.filter(h => h.k === q.k).sort((a, b) => a.i - b.i);
      const j = pts.findIndex(h => h.i === q.i) + (ev.key === "ArrowRight" ? 1 : -1); if (pts[j]){ CH.sel = new Set([q.k + "|" + pts[j].i]); renderChartFg(); }
    }
    else if (ev.key === "Delete" || ev.key === "Backspace"){ ev.preventDefault(); if (CH.sel.size) applyToPoints(() => null, selList()); }
    else if (ev.key === "Escape"){ clearSel(); renderChartFg(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a"){ ev.preventDefault(); CH.sel = new Set(CH.hits.map(h => h.k + "|" + h.i)); renderChartFg(); }
  });
  /* hold Ctrl (or Cmd) to see the values under the cursor */
  const ctrlState = ev => { const on = ev.ctrlKey || ev.metaKey; if (on !== MOUSE.ctrl){ MOUSE.ctrl = on; if (MOUSE.in && MOUSE.i != null) hover(MOUSE.i, { clientX:MOUSE.x, clientY:MOUSE.y, ctrlKey:on, metaKey:false }); else $("tip").style.display = "none"; } };
  window.addEventListener("keydown", ctrlState); window.addEventListener("keyup", ctrlState);
  window.addEventListener("blur", () => { MOUSE.ctrl = false; $("tip").style.display = "none"; });
  window.addEventListener("resize", () => renderChart());
}
function hover(i, ev){
  const tip = $("tip");
  if (S.hoverRow !== i){ S.hoverRow = i; markHover(i); moveCursor(i); }
  if (i == null || !ev || CH.drag || !(ev.ctrlKey || ev.metaKey)){ tip.style.display = "none"; return; }
  const ks = keysOf(prefs.param), combo = ks.length > 1, p = P[ks[0]], s = site(), A = S.agg[s.id] || { srcv:{} };
  const r = S.rows[i];
  const srcOf = k => k.startsWith("x") ? OF.xsrc[k] : (A.srcv[k] || {});
  const f = v => v == null || v === undefined ? "–" : isWind(p) ? `${Math.round(v*wfac())} ${wuLabel()}` : p.kind === "sky" ? `${Math.round(v)}% ${skyCat(v)}` : p.kind === "dir" ? `${Math.round(v)}° ${compass(v)}` : p.kind === "prob" ? `${Math.round(v)}%` : `${Math.round(v)}${p.unit === "°F" ? "°" : ""}`;
  const fv = getter => ks.map(k => f(getter(k, ownerIdx(k, i)))).join(" / ");
  const Ld = dayLabel(r.a, zulu()), oi = ownerIdx(ks[ks.length - 1], i), sp = spanMap(ks[ks.length - 1])[oi], end = S.rows[oi + (sp.s || 1) - 1].b;
  let h = `<div><b>${Ld.wd.slice(0,3)} ${Ld.dt}, ${hhmm(r.a, zulu())}${sp.s > 1 || r.len > 1 ? "–" + hhmm(end, zulu()) : ""}${zulu() ? "Z" : ""}</b></div>`;
  if (combo) h += `<div class="r mut"><span></span><span>${VIEWS[prefs.param].names.map(x => x.replace("Sustained", "sust").replace("Peak", "peak")).join(" / ")}</span></div>`;
  h += `<div class="r"><span>Official</span><span>${fv((k, j) => OF.o[k][j])}</span></div><div class="r mut"><span>Guidance</span><span>${fv((k, j) => OF.g[k] ? OF.g[k][j] : null)}</span></div>`;
  const ids = [...new Set(ks.flatMap(k => Object.keys(srcOf(k))))].filter(id => ks.some(k => (srcOf(k)[id] || [])[ownerIdx(k, i)] != null)).sort((a, b) => ALL_SOURCES.findIndex(x => x.id === a) - ALL_SOURCES.findIndex(x => x.id === b));
  ids.slice(0, 16).forEach(id => { const d = ALL_SOURCES.find(x => x.id === id); h += `<div class="r mut"><span>${d ? d.name : id}</span><span>${fv((k, j) => (srcOf(k)[id] || [])[j])}</span></div>`; });
  tip.innerHTML = h; tip.style.display = "block";
  const wrap = $("chartwrap").getBoundingClientRect(); let lx = ev.clientX - wrap.left + 16; if (lx + 210 > wrap.width) lx = ev.clientX - wrap.left - 226;
  tip.style.left = lx + "px"; tip.style.top = Math.max(0, Math.min(wrap.height - tip.offsetHeight, ev.clientY - wrap.top - 20)) + "px";
}

/* ============================================================
   Publish: Excel (hand-built xlsx) + CSV
   ============================================================ */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b){ let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files){
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  for (const [name, text] of files){
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dt, true); lh.setUint16(12, dd, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dt, true); ch.setUint16(14, dd, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const csz = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csz, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
const xesc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = c => { let s = ""; c++; while (c > 0){ const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1)/26); } return s; };
const XSTYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="15"/><color rgb="FF13202E"/><name val="Arial"/></font><font><sz val="9"/><color rgb="FF4B5A68"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF13202E"/><name val="Arial"/></font><font><b/><sz val="9"/><color rgb="FF13202E"/><name val="Arial"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF13202E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6EBED"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F7F7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD4DBDF"/></left><right style="thin"><color rgb="FFD4DBDF"/></right><top style="thin"><color rgb="FFD4DBDF"/></top><bottom style="thin"><color rgb="FFD4DBDF"/></bottom><diagonal/></border><border><left style="thin"><color rgb="FFD4DBDF"/></left><right style="thin"><color rgb="FFD4DBDF"/></right><top style="medium"><color rgb="FF13202E"/></top><bottom style="thin"><color rgb="FFD4DBDF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="9" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="9" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
function sheetXML(sh){
  let x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`;
  x += `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" zoomScale="100"><pane xSplit="${sh.freeze.c}" ySplit="${sh.freeze.r}" topLeftCell="${colName(sh.freeze.c)}${sh.freeze.r + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`;
  x += `<sheetFormatPr defaultRowHeight="15"/><cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>`;
  sh.rows.forEach((row, ri) => {
    const ht = sh.heights && sh.heights[ri];
    x += `<row r="${ri + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ""}>`;
    row.forEach((c, ci) => {
      if (!c) return; const ref = colName(ci) + (ri + 1); const st = c.s ? ` s="${c.s}"` : "";
      if (c.v === null || c.v === undefined || c.v === "") x += `<c r="${ref}"${st}/>`;
      else if (typeof c.v === "number") x += `<c r="${ref}"${st}><v>${c.v}</v></c>`;
      else x += `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xesc(c.v)}</t></is></c>`;
    });
    x += `</row>`;
  });
  x += `</sheetData>`;
  if (sh.merges.length) x += `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`;
  (sh.cf || []).forEach((ref, i) => { x += `<conditionalFormatting sqref="${ref}"><cfRule type="colorScale" priority="${i + 1}"><colorScale><cfvo type="num" val="0"/><cfvo type="num" val="1"/><color rgb="FFFFFFFF"/><color rgb="FF6FAFB6"/></colorScale></cfRule></conditionalFormatting>`; });
  x += `<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  return x;
}
function workbook(sheets){
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Daily Planning Forecast</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0,19)}Z</dcterms:created></cp:coreProperties>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", XSTYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXML(s)]),
  ];
  return zip(files);
}
const xcols = () => ["Day","Time","Period", ...PARAMS.map(p => p.k)];
/* product name for titles, sheets and files */
const FILE_BASE = () => EXPO ? ((prefs.exp && prefs.exp.op ? prefs.exp.op.replace(/[^A-Za-z0-9]+/g, "_") + "_" : "") + "Exposure_Forecast") : "Planning_Forecast";
const productName = s => EXPO ? `${(prefs.exp && prefs.exp.op) ? prefs.exp.op + " " : ""}Exposure Forecast` : "Daily Planning Forecast";
function siteSheet(s, OFs, issued, by){
  const XCOLS = xcols();
  const z = zulu(), tz = z ? "UTC" : tzAbbr(issued), o = OFs.o, rows = S.rows;
  const it = new Date(issued), iss = `${dayLabel(issued, z).wd}, ${dayLabel(issued, z).dt} ${new Date(issued).getUTCFullYear()} at ${hhmm(issued, z)} ${tz}`;
  const R = [], merges = [], heights = {};
  const ncol = XCOLS.length, last = colName(ncol - 1);
  R.push([{ v:`${EXPO ? s.point : s.name} ${productName(s)}`, s:1 }]); heights[0] = 22;
  R.push([{ v:`Issued ${iss} by ${by}`, s:2 }]);
  R.push([{ v:`Forecast point ${s.point} (${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}). Times are ${tz}. Probabilities are the chance of the event at any time in the period.`, s:2 }]);
  R.push([{ v: EXPO ? `Valid ${dayLabel(rows[0].a, z).dt} ${hhmm(rows[0].a, z)} to ${dayLabel(rows[rows.length - 1].b, z).dt} ${hhmm(rows[rows.length - 1].b, z)} ${tz}. ${constraintSummary()}` : "Hourly to 24 h, 3-hour blocks to day 5, 6-hour blocks on days 6 and 7. In blocks, temperature is the daytime high or overnight low, winds are the block maximum.", s:2 }]);
  R.push([]);
  const G = [["Valid",0,2]]; PARAMS.forEach((p, j) => { const ci = j + 3, g = G[G.length - 1]; const lab = grpLabel(p.g).replace(" (%)", ""); if (g[0] === lab && g[2] === ci - 1) g[2] = ci; else G.push([lab, ci, ci]); });
  const gr = new Array(ncol).fill(null).map(() => ({ v:"", s:3 }));
  G.forEach(([n, a, b]) => { gr[a] = { v:n, s:3 }; if (b > a) merges.push(`${colName(a)}6:${colName(b)}6`); });
  R.push(gr); heights[5] = 20;
  const hd = XCOLS.map((k, ci) => { if (ci < 3) return { v: ci === 1 ? `Time (${tz})` : k, s:4 }; const p = P[k]; return { v: (p.k === "xhot" ? `>${hotOf(s)}°F` : p.k === "sev" ? "Damaging wind, hail, tornado" : p.l) + (p.s ? `\n${p.s}` : ""), s:4 }; });
  R.push(hd); heights[6] = 30;
  let lastDay = null;
  rows.forEach((r, i) => {
    const dk = dayKey(r.a, z), top = dk !== lastDay; lastDay = dk;
    const st = (base) => top ? base + 4 : base;
    const rowNo = 8 + i;
    const L = dayLabel(r.a, z);
    const row = [{ v: top ? `${L.wd.slice(0,3)} ${L.dt}` : "", s: st(8) }, { v: rowTime(r), s: st(5) }, { v: `${r.len} h`, s: st(5) }];
    for (const k of XCOLS.slice(3)){
      const p = P[k], v = o[k][i], sp = spanMap(k)[i];
      if (sp.cov){ row.push({ v:"", s: st(5) }); continue; }
      if (sp.s > 1){ const col = colName(XCOLS.indexOf(k)); merges.push(`${col}${rowNo}:${col}${rowNo + sp.s - 1}`); }
      if (v === undefined){ row.push({ v:"-", s: st(5) }); continue; }
      if (v === null){ row.push({ v:"", s: st(5) }); continue; }
      if (p.kind === "prob") row.push({ v: Math.round(v)/100, s: st(7) });
      else if (p.kind === "sky") row.push({ v: skyCat(v), s: st(5) });
      else if (p.kind === "dir") row.push({ v: compass(v), s: st(5) });
      else if (p.kind === "sev") row.push({ v: v === "-" ? "-" : SEV_NAME[v], s: st(5) });
      else row.push({ v: Math.round(isWind(p) ? v*wfac() : v), s: st(6) });
    }
    R.push(row);
  });
  const n0 = 8, n1 = 7 + rows.length;
  merges.push(`A1:${last}1`, `A2:${last}2`, `A3:${last}3`, `A4:${last}4`);
  return { name: `${s.name} (${s.point})`.slice(0, 31), rows:R, merges, heights, freeze:{ r:7, c:3 },
    cols:[11,11,7, ...PARAMS.map(p => p.kind === "sev" ? 14 : p.kind === "prob" ? 8 : 7)],
    cf: PARAMS.map((p, j) => p.kind === "prob" ? `${colName(j + 3)}${n0}:${colName(j + 3)}${n1}` : null).filter(Boolean) };
}
function csvFor(list, issued, by){
  if (EXPO) return csvGeneric(list, issued, by);
  const head = ["site","point","valid_start_utc","valid_end_utc","valid_start_local","period_h","sky","sky_pct","temp_f","dewpoint_f","wbgt_f","pop_1h_pct","pop_3h_pct","pop_6h_pct","ltg_1h_pct","ltg_3h_pct","ltg_6h_pct","wind54_sust_kt","wind54_peak_kt","wind200_sust_kt","wind200_peak_kt","wind_dir_deg","wind_dir","p_sust_gt18kt_pct","p_peak_gt25kt_pct","p_peak_gt35kt_pct","p_peak_gt50kt_pct","p_temp_gt_hot_pct","hot_threshold_f","p_temp_lt40f_pct","p_temp_lt32f_pct","p_vis_lt3mi_pct","severe","issued_utc","forecaster"];
  const q = v => { if (v === undefined || v === null) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [head.join(",")];
  for (const [s, OFs] of list){
    const o = OFs.o;
    S.rows.forEach((r, i) => {
      const p = lp(r.a), loc = `${p.y}-${pad2(p.mo)}-${pad2(p.d)} ${pad2(p.h)}:00`;
      const n = k => o[k][i] == null ? "" : Math.round(o[k][i]);
      lines.push([s.name, s.point, new Date(r.a).toISOString().slice(0,16) + "Z", new Date(r.b).toISOString().slice(0,16) + "Z", loc, r.len, o.sky[i] == null ? "" : skyCat(o.sky[i]), n("sky"), n("t"), n("td"), n("wbgt"), n("pp1"), n("pp3"), n("pp6"), n("lt1"), n("lt3"), n("lt6"), n("s54"), n("g54"), n("s200"), n("g200"), n("dir"), o.dir[i] == null ? "" : compass(o.dir[i]), n("x18"), n("x25"), n("x35"), n("x50"), n("xhot"), hotOf(s), n("x40"), n("x32"), n("xvis"), o.sev[i] || "-", new Date(issued).toISOString().slice(0,16) + "Z", by].map(q).join(","));
    });
  }
  return lines.join("\r\n") + "\r\n";
}
/* exposure CSV: one column per parameter on the page */
function csvGeneric(list, issued, by){
  const colOf = p => { const c = p.csv || (p.kind === "prob" ? `${p.k}_pct` : p.k); return isWind(p) ? c.replace(/_kt$/, "_" + wuLabel().replace("/", "p")) : c; };
  const head = ["point","lat","lon","valid_start_utc","valid_end_utc","valid_start_local","period_h", ...PARAMS.map(colOf), "issued_utc","forecaster"];
  const q = v => { if (v === undefined || v === null) return ""; const t = String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const lines = [`# ${productName()}. ${constraintSummary()}`, head.join(",")];
  for (const [s, OFs] of list){
    const o = OFs.o;
    S.rows.forEach((r, i) => {
      const p = lp(r.a), loc = `${p.y}-${pad2(p.mo)}-${pad2(p.d)} ${pad2(p.h)}:00`;
      const val = pp => { const v = o[pp.k][i]; if (v == null) return ""; if (pp.kind === "sky") return skyCat(v); if (pp.kind === "dir") return Math.round(v); if (pp.kind === "sev") return v; return Math.round(isWind(pp) ? v*wfac() : v); };
      lines.push([s.point, s.lat.toFixed(4), s.lon.toFixed(4), new Date(r.a).toISOString().slice(0,16) + "Z", new Date(r.b).toISOString().slice(0,16) + "Z", loc, r.len, ...PARAMS.map(val), new Date(issued).toISOString().slice(0,16) + "Z", by].map(q).join(","));
    });
  }
  return lines.join("\r\n") + "\r\n";
}
function download(blob, name){ const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function openPublish(){
  const dlg = $("pubDlg");
  $("pubSites").innerHTML = SITES.map(s => `<label><input type="checkbox" value="${s.id}" ${s.id === prefs.site || editCount(s.id) ? "checked" : ""}> ${s.name} <span style="color:var(--ink-3)">${s.point}</span></label>`).join("");
  $("pubInit").value = prefs.initials || "";
  const fm = prefs.fmt || { x:true, c:true, p:true, h:true };
  $("fmtX").checked = fm.x; $("fmtC").checked = fm.c; $("fmtP").checked = fm.p; $("fmtH").checked = fm.h;
  const qcRefresh = () => {
    const ids = [...$("pubSites").querySelectorAll("input:checked")].map(x => x.value);
    const msgs = [];
    ids.forEach(id => { const q = qcIssues(id, officialFor(id)); q.list.forEach(it => msgs.push(`${SITES.find(s => s.id === id).name}, ${dayLabel(S.rows[it.i].a, zulu()).wd.slice(0,3)} ${rowTime(S.rows[it.i])}: ${it.msg}`)); });
    const el = $("qc");
    if (msgs.length){ el.className = "qc show"; el.innerHTML = `<b>${msgs.length} check${msgs.length > 1 ? "s" : ""} to look at.</b> You can still publish.<ul>${msgs.slice(0, 10).map(m => `<li>${m}</li>`).join("")}${msgs.length > 10 ? `<li>and ${msgs.length - 10} more</li>` : ""}</ul>`; }
    else el.className = "qc";
    $("pubGo").disabled = !ids.length;
  };
  $("pubSites").onchange = qcRefresh; qcRefresh();
  dlg.showModal(); $("pubInit").focus();
}
function doPublish(){
  const ids = [...$("pubSites").querySelectorAll("input:checked")].map(x => x.value);
  const by = ($("pubInit").value || "").trim().toUpperCase() || "WX";
  prefs.initials = by; $("initials").value = by; savePrefs();
  const issued = Date.now(), list = ids.map(id => [SITES.find(s => s.id === id), officialFor(id)]);
  const p = lp(issued), stamp = `${p.y}${pad2(p.mo)}${pad2(p.d)}_${pad2(p.h)}${pad2(p.mi)}`;
  const tag = ids.length === 1 ? "_" + SITES.find(s => s.id === ids[0]).point.replace(/[^A-Za-z0-9]/g, "") : "";
  let nfiles = 0;
  if ($("fmtX").checked){ download(workbook(list.map(([s, o]) => siteSheet(s, o, issued, by))), `${FILE_BASE()}${tag}_${stamp}.xlsx`); nfiles++; }
  if ($("fmtC").checked){ setTimeout(() => download(new Blob([csvFor(list, issued, by)], { type:"text/csv" }), `${FILE_BASE()}${tag}_${stamp}.csv`), 300); nfiles++; }
  const wantP = $("fmtP").checked, wantH = $("fmtH").checked;
  if (wantP || wantH){
    const models = reportModel(list, issued, by);
    if (wantP){ setTimeout(() => download(pdfReport(models), `${FILE_BASE()}${tag}_${stamp}.pdf`), 600); nfiles++; }
    if (wantH){ setTimeout(() => download(new Blob([htmlReport(models, issued)], { type:"text/html" }), `${FILE_BASE()}${tag}_${stamp}.html`), 900); nfiles++; }
  }
  prefs.fmt = { x:$("fmtX").checked, c:$("fmtC").checked, p:wantP, h:wantH }; savePrefs();
  ids.forEach(id => published[id] = { t: issued, by }); store.set(LS.pub, published);
  renderStatus();
  toast(`Published ${hhmm(issued, zulu())}${zulu() ? "Z" : ""}, ${nfiles} file${nfiles === 1 ? "" : "s"} downloaded`);
}
/* ============================================================
   Publish: PDF and HTML forecast tables (time across, paged by day)
   ============================================================ */
const MIX = (rgb, a) => rgb.map(c => Math.round(255 - (255 - c)*a));
function tintRGB(p, v){
  if (v == null || v === undefined) return null;
  if (p.kind === "prob"){ const a = Math.min(0.62, v/100*0.62); return a > 0.02 ? MIX([11,110,121], a) : null; }
  if (p.k === "t" || p.k === "wbgt"){ if (v >= 85) return MIX([178,58,46], Math.min(0.32, (v - 84)/40)); if (v <= 50) return MIX([52,102,170], Math.min(0.3, (51 - v)/40)); return null; }
  if (p.unit === "kt" && p.kind === "num"){ const a = Math.max(0, Math.min(0.4, (v - 12)/45)); return a > 0.02 ? MIX([178,58,46], a) : null; }
  if (p.kind === "sky"){ const a = Math.max(0, v)/100*0.16; return a > 0.02 ? MIX([120,135,150], a) : null; }
  if (p.kind === "sev" && v !== "-") return MIX([178,58,46], 0.08 + SEV.indexOf(v)*0.06);
  return null;
}
const MAXCOLS = 30;
/* one model per site: header text plus pages of whole days, each with merged cells clipped to the page */
function reportModel(list, issued, by){
  const z = zulu(), tz = z ? "UTC" : tzAbbr(issued), rows = S.rows;
  const iss = `${dayLabel(issued, z).wd}, ${dayLabel(issued, z).dt} ${new Date(issued).getUTCFullYear()} at ${hhmm(issued, z)} ${tz}`;
  const days = []; rows.forEach((r, i) => { const dk = dayKey(r.a, z); const d = days[days.length - 1]; if (d && d.dk === dk) d.cols.push(i); else days.push({ dk, cols:[i] }); });
  const pages = []; let cur = null;
  for (const d of days){ if (!cur || cur.cols.length + d.cols.length > MAXCOLS){ cur = { days:[], cols:[] }; pages.push(cur); } cur.days.push(d); cur.cols.push(...d.cols); }
  /* fold a short last page (day 7 on its own) into the one before */
  if (pages.length > 1){ const L = pages[pages.length - 1], P2 = pages[pages.length - 2]; if (L.cols.length <= 8 && P2.cols.length + L.cols.length <= 36){ P2.days.push(...L.days); P2.cols.push(...L.cols); pages.pop(); } }
  const tlab = r => { const a = hhmm(r.a, z).slice(0, 2); return r.len === 1 ? a : `${a}–${hhmm(r.b, z).slice(0, 2)}`; };
  return list.map(([s, OFs]) => {
    const o = OFs.o;
    return {
      site:s, title:`${EXPO ? s.point : s.name} ${productName(s)}`,
      sub:`Issued ${iss} by ${by}. Forecast point ${s.point} (${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}). Times ${tz}.${EXPO ? " " + constraintSummary() : ""}`,
      pages: pages.map(pg => {
        const set = new Set(pg.cols);
        const dayHdr = pg.days.map((d, j) => { const L = dayLabel(rows[d.cols[0]].a, z); const nm = d.dk === dayKey(issued, z) ? "Today" : d.dk === dayKey(issued + 24*H, z) ? "Tomorrow" : L.wd; return { label: d.cols.length >= 3 ? `${nm}, ${L.dt}` : L.dt, n:d.cols.length }; });
        const times = pg.cols.map(i => ({ t:tlab(rows[i]), sub: rows[i].len > 1 ? rows[i].len + " h" : "", day: pg.days.some(d => d.cols[0] === i) }));
        const groups = [];
        for (const p of PARAMS){
          let g = groups[groups.length - 1]; if (!g || g.g !== grpLabel(p.g)){ g = { g:grpLabel(p.g), rows:[] }; groups.push(g); }
          const spm = spanMap(p.k), cells = [];
          pg.cols.forEach((i, ci) => {
            const sp = spm[i];
            if (sp.cov && ci > 0) return;             /* inside a merged cell already drawn */
            const own = sp.cov ? ownerIdx(p.k, i) : i;
            const len = sp.cov ? spm[own].s - (i - own) : sp.s;
            let n = 1; while (n < len && set.has(i + n)) n++;
            const v = o[p.k][own];
            const txt = v === undefined ? "–" : p.kind === "sev" ? (v === "-" ? "-" : v) : fmt(p, v);
            cells.push({ text: txt, span:n, fill: v === undefined ? null : tintRGB(p, v), muted: v === undefined, day: times[ci].day });
          });
          g.rows.push({ label: p.kind === "sev" ? "SPC category" : colLabel(p, s), sub: p.s, cells });
        }
        return { dayHdr, times, groups };
      }),
    };
  });
}

/* ---------- HTML ---------- */
const hesc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function htmlReport(models, issued){
  const css = `body{font:13px/1.35 "Segoe UI",Arial,sans-serif;color:#13202E;margin:24px;background:#fff}
h1{font-size:20px;margin:0 0 4px}h1+p{margin:0 0 12px;color:#4B5A68;font-size:12px}
section{margin-bottom:36px}table{border-collapse:collapse;margin:0 0 16px;font-variant-numeric:tabular-nums}
th,td{border:1px solid #D4DBDF;padding:3px 4px;text-align:center;white-space:nowrap;font-size:12px}
thead th{background:#F4F7F7;font-weight:600}th.grp{background:#F4F7F7;text-align:left;vertical-align:top;white-space:normal;width:110px}
th.lab{text-align:left;font-weight:600;color:#4B5A68}th.lab small,thead small{color:#7D8B97;font-weight:400;display:block;font-size:10px}
td.mut{color:#9AA6B0}.wrap{overflow-x:auto;margin-bottom:16px}.wrap table{margin:0}.d{border-left:2px solid #7D8B97}.note{color:#7D8B97;font-size:11px;max-width:110ch}
@media print{body{margin:10mm}section{page-break-after:always}table{page-break-inside:avoid}}`;
  let h = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${productName()}</title><style>${css}</style></head><body>`;
  for (const m of models){
    h += `<section><h1>${hesc(m.title)}</h1><p>${hesc(m.sub)}</p>`;
    for (const pg of m.pages){
      h += `<div class="wrap"><table><thead><tr><th colspan="2"></th>${pg.dayHdr.map(d => `<th colspan="${d.n}" class="d" style="text-align:left">${hesc(d.label)}</th>`).join("")}</tr>`;
      h += `<tr><th colspan="2" style="text-align:left">Parameter</th>${pg.times.map(t => `<th class="${t.day ? "d" : ""}">${t.t}${t.sub ? `<small>${t.sub}</small>` : ""}</th>`).join("")}</tr></thead><tbody>`;
      for (const g of pg.groups){
        g.rows.forEach((r, j) => {
          h += `<tr>${j === 0 ? `<th class="grp" rowspan="${g.rows.length}">${hesc(g.g)}</th>` : ""}<th class="lab">${hesc(r.label)}${r.sub ? ` <small style="display:inline">${hesc(r.sub)}</small>` : ""}</th>`;
          h += r.cells.map(c => `<td${c.span > 1 ? ` colspan="${c.span}"` : ""} class="${c.day ? "d " : ""}${c.muted ? "mut" : ""}"${c.fill ? ` style="background:rgb(${c.fill.join(",")})"` : ""}>${hesc(c.text)}</td>`).join("") + `</tr>`;
        });
      }
      h += `</tbody></table></div>`;
    }
    h += `</section>`;
  }
  h += `<p class="note">${hesc(document.querySelector(".foot p").textContent)}</p></body></html>`;
  return h;
}

/* ---------- PDF (hand-built, Helvetica, US Letter landscape) ---------- */
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const textW = (s, size, bold) => { let w = 0; for (const ch of String(s)){ const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HW[c - 32] : ch === "–" ? 556 : ch === "°" ? 400 : 556; } return w*size/1000*(bold ? 1.06 : 1); };
const pdfStr = s => "(" + [...String(s)].map(ch => { if (ch === "(" || ch === ")" || ch === "\\") return "\\" + ch; if (ch === "–") return "\\226"; if (ch === "—") return "\\227"; if (ch === "°") return "\\260"; if (ch === "≥") return ">="; if (ch === "≤") return "<="; const c = ch.charCodeAt(0); return c < 32 || c > 126 ? "?" : ch; }).join("") + ")";
function pdfReport(models){
  const W = 792, Hp = 612, M = 28, ops = [];
  const pages = [];
  let cs = [];
  const f = n => (+n).toFixed(2);
  const rgb = c => c.map(x => f(x/255)).join(" ");
  const rect = (x, y, w, h, fill) => cs.push(`${rgb(fill)} rg ${f(x)} ${f(Hp - y - h)} ${f(w)} ${f(h)} re f`);
  const line = (x1, y1, x2, y2, gray, wd) => cs.push(`${f(gray)} G ${f(wd)} w ${f(x1)} ${f(Hp - y1)} m ${f(x2)} ${f(Hp - y2)} l S`);
  const text = (s, x, y, size, opt = {}) => {
    const w = textW(s, size, opt.bold); let tx = x;
    if (opt.align === "c") tx = x - w/2; else if (opt.align === "r") tx = x - w;
    cs.push(`BT ${opt.color ? rgb(opt.color) + " rg " : "0.075 0.125 0.18 rg "}/${opt.bold ? "F2" : "F1"} ${f(size)} Tf ${f(tx)} ${f(Hp - y)} Td ${pdfStr(s)} Tj ET`);
  };
  const fitText = (s, maxW, size, bold) => { let z = size; while (z > 4.5 && textW(s, z, bold) > maxW) z -= 0.25; return z; };
  for (const m of models){
    m.pages.forEach((pg, pi) => {
      cs = [];
      text(m.title, M, M + 12, 13, { bold:true });
      text(m.sub, M, M + 25, 7.5, { color:[75,90,104] });
      if (m.pages.length > 1) text(`Page ${pi + 1} of ${m.pages.length}`, W - M, M + 12, 7.5, { align:"r", color:[125,139,151] });
      const gw = 66, lw = 62, x0 = M + gw + lw, ncol = pg.times.length;
      const cw = Math.min(24, (W - M - x0)/ncol), top = M + 38, dh = 12, th = 18, rh = 13.2;
      const xcol = ci => x0 + ci*cw;
      /* day header */
      rect(M, top, gw + lw + ncol*cw, dh + th, [244,247,247]);
      let ci = 0;
      pg.dayHdr.forEach(d => { text(d.label, xcol(ci) + 3, top + 9, 7.5, { bold:true }); ci += d.n; });
      text("Parameter", M + 3, top + dh + 11, 7, { bold:true, color:[75,90,104] });
      pg.times.forEach((t, k) => { text(t.t, xcol(k) + cw/2, top + dh + (t.sub ? 8 : 11), fitText(t.t, cw - 2, 7, true), { bold:true, align:"c" }); if (t.sub) text(t.sub, xcol(k) + cw/2, top + dh + 15.5, 5.5, { align:"c", color:[125,139,151] }); });
      let y = top + dh + th;
      line(M, y, xcol(ncol), y, 0.07, 1);
      for (const g of pg.groups){
        const gy = y;
        rect(M, gy, gw, rh*g.rows.length, [244,247,247]);
        /* group label, wrapped */
        const words = g.g.split(" "); let ln = "", ly = gy + 9;
        for (const w of words){ const t2 = ln ? ln + " " + w : w; if (textW(t2, 6.8, true) > gw - 6 && ln){ text(ln, M + 3, ly, 6.8, { bold:true }); ly += 8; ln = w; } else ln = t2; }
        if (ln) text(ln, M + 3, ly, 6.8, { bold:true });
        for (const r of g.rows){
          let k = 0;
          for (const c of r.cells){ const x = xcol(k), w = c.span*cw; if (c.fill) rect(x, y, w, rh, c.fill); text(c.text, x + w/2, y + 9.2, fitText(c.text, w - 2, 7, false), { align:"c", color: c.muted ? [154,166,176] : undefined }); k += c.span; }
          text(r.label, M + gw + 3, y + 9.2, fitText(r.label + (r.sub ? " " + r.sub : ""), lw - 5, 6.8, true), { bold:true, color:[75,90,104] });
          if (r.sub){ const lwid = textW(r.label, fitText(r.label + " " + r.sub, lw - 5, 6.8, true), true); text(r.sub, M + gw + 3 + lwid + 2, y + 9.2, 5.6, { color:[125,139,151] }); }
          /* cell borders for this row */
          let kk = 0; for (const c of r.cells){ line(xcol(kk), y, xcol(kk), y + rh, 0.84, 0.4); kk += c.span; }
          y += rh;
          line(M + gw, y, xcol(ncol), y, 0.86, 0.4);
        }
        line(M, y, xcol(ncol), y, 0.6, 0.8);
      }
      /* frame + day separators */
      line(M, top, xcol(ncol), top, 0.6, 0.6); line(M, top, M, y, 0.6, 0.6); line(xcol(ncol), top, xcol(ncol), y, 0.6, 0.6);
      line(M + gw, top + dh + th, M + gw, y, 0.6, 0.6); line(x0, top, x0, y, 0.45, 1);
      ci = 0; pg.dayHdr.forEach((d, j) => { if (j) line(xcol(ci), top, xcol(ci), y, 0.45, 1.2); ci += d.n; });
      text("3 hr and 6 hr probabilities are merged across the hours they cover; in longer blocks the 1 hr and 3 hr cells show the highest period inside the block.", M, Math.min(Hp - M, y + 14), 6.5, { color:[125,139,151] });
      pages.push(cs.join("\n"));
    });
  }
  /* assemble objects */
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  const fontR = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontB = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pagesId = objs.length + 1 + pages.length*2;   /* reserved after page objects */
  const kids = [];
  for (const c of pages){
    const sid = add(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${Hp}] /Resources << /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R >> >> /Contents ${sid} 0 R >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map(k => k + " 0 R").join(" ")}] /Count ${kids.length} >>`);
  const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n", offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
  return new Blob([bytes], { type:"application/pdf" });
}

let toastT = null;
function toast(msg){ const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }

/* ============================================================
   Loading
   ============================================================ */
function recomputeAgg(){ for (const s of SITES) if (S.G[s.id]) S.agg[s.id] = aggregate(S.G[s.id], prefs); }
let renderT = null;
function scheduleRender(){ if (renderT) return; renderT = setTimeout(() => { renderT = null; recomputeAgg(); renderAll(); renderSources(); }, 120); }
const rowsNow = () => EXPO ? buildRowsRange(prefs.exp.start, prefs.exp.end, prefs.exp.hourly === "all" ? Infinity : +prefs.exp.hourly) : buildRows(Date.now());
/* keep every source's members so a new range or new wind heights can be applied without refetching */
function addSrc(sid, d, members, extra){ (S.raw[sid] = S.raw[sid] || []).push([d, members, extra]); S.G[sid].addSource(d, members, extra); }
function rebuildGuidance(){
  S.rows = rowsNow(); S.spanCache = {}; CH.layout = null;
  for (const s of SITES){
    const old = S.G[s.id], G = new SiteGuidance(s, S.TL, S.rows); G.sev = old ? old.sev : [];
    for (const [d, members, extra] of (S.raw[s.id] || [])){ members.forEach(m => deriveHeights(m, S.TL.n)); G.addSource(d, members, extra); }
    S.G[s.id] = G;
  }
  if (!P[prefs.param] && !VIEWS[prefs.param]) prefs.param = "t";
  clearSel(); recomputeAgg(); renderAll(); renderSources();
}
async function loadAll(){
  S.raw = {};
  S.loading = true; S.rows = rowsNow(); S.spanCache = {}; S.TL = makeTimeline(Date.now()); S.G = {}; S.agg = {}; S.status = {}; S.fetchedAt = Date.now();
  pruneEdits(); saveEdits();
  for (const s of SITES) S.G[s.id] = new SiteGuidance(s, S.TL, S.rows);
  ALL_SOURCES.forEach(d => S.status[d.id] = { loading:true });
  renderSources(); recomputeAgg(); renderAll();
  const tasks = [];
  const det = (d, ens) => (DEMO ? demoOM(d, ens, S.TL) : fetchOM(d, ens, S.TL)).then(per => {
    let n = 0; SITES.forEach((s, si) => { if (per[si] && per[si].length){ addSrc(s.id, d, per[si]); n = per[si].length; } });
    S.status[d.id] = n ? { ok:true, note: ens ? `${n} members` : "loaded" } : { err:"no data for this area" };
  }).catch(e => { S.status[d.id] = { err: e.name === "AbortError" ? "timed out" : "not available" }; }).finally(scheduleRender);
  OM_DET.forEach(d => tasks.push(det(d, false)));
  OM_ENS.forEach(d => tasks.push(det(d, true)));
  MOS.forEach(d => tasks.push((DEMO ? demoMOS(d, S.TL) : fetchMOS(d, S.TL)).then(per => {
    let n = 0, run = null, from = "";
    SITES.forEach(s => { const x = per[s.stn]; if (x && x.members[0].t.some(v => v != null)){ addSrc(s.id, d, x.members, { iv:x.iv, run:x.run }); n++; run = x.run; from = x.from; } });
    S.status[d.id] = n ? { ok:true, note: run ? `${pad2(new Date(run).getUTCHours())}Z run${from === "mirror" ? ", mirror" : ""}` : "loaded" } : { err:"no stations" };
  }).catch(e => { S.status[d.id] = { err:"not reachable" }; }).finally(scheduleRender)));
  PIPE.forEach(d => S.status[d.id] = { loading:true });
  tasks.push((DEMO ? demoPipeline(S.TL) : fetchPipeline(S.TL)).then(res => {
    for (const d of PIPE){
      const x = res[d.id];
      if (!x || !Object.keys(x.per).length){ S.status[d.id] = { err:"not in this run" }; continue; }
      SITES.forEach(s => { const p = x.per[s.id]; if (p) addSrc(s.id, d, p.members, p.iv ? { iv:p.iv, run:x.run } : null); });
      S.status[d.id] = { ok:true, note: `${pad2(new Date(x.run).getUTCHours())}Z run${x.n > 1 ? `, ${x.n} members` : ""}` };
    }
  }).catch(e => { PIPE.forEach(d => S.status[d.id] = { err:"pipeline file missing" }); }).finally(scheduleRender));
  tasks.push((DEMO ? demoSPC() : fetchSPC()).then(sev => { for (const s of SITES) S.G[s.id].sev = sev; }).finally(scheduleRender));
  await Promise.allSettled(tasks);
  S.loading = false; S.fetchedAt = Date.now(); scheduleRender();
}

/* ---------- demo data (only with ?demo=1) ---------- */
function rng(seed){ let x = seed >>> 0 || 1; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; }
function demoSeries(TL, r, bias){
  const m = {}; ["t","td","sky","s10","d10","g10","s80","vis","sw","pr","pp"].forEach(k => m[k] = new Array(TL.n).fill(null));
  const front = TL.t0 + (70 + r()*10) * H;
  for (let i = 0; i < TL.n; i++){
    const t = TL.t0 + i*H, h = lp(t).h, post = t > front;
    const diur = Math.sin((h - 9) / 24 * 2*Math.PI);
    m.t[i] = 78 + bias + 6*diur - (post ? 9 : 0) + (r() - 0.5)*1.5;
    m.td[i] = (post ? 55 : 70) + bias*0.5 + (r() - 0.5)*2;
    m.sky[i] = Math.max(0, Math.min(100, (post ? 15 : 45) + 35*Math.sin(i/9 + bias) + (r() - 0.5)*25));
    m.s10[i] = Math.max(1, (post ? 15 : 9) + 3*diur + (r() - 0.5)*4 + bias*0.4);
    m.d10[i] = ((post ? 340 : 120) + (r() - 0.5)*30 + 360) % 360;
    m.g10[i] = m.s10[i] * (1.35 + r()*0.2);
    m.s80[i] = m.s10[i] * 1.32;
    m.vis[i] = r() < 0.04 ? 3000 : 16000;
    m.sw[i] = Math.max(0, 850*Math.sin((h - 6)/12*Math.PI));
    m.pr[i] = !post && h >= 13 && h <= 19 && r() < 0.18 ? 0.05 + r()*0.3 : (Math.abs(t - front) < 6*H && r() < 0.4 ? 0.1 : 0);
    m.pp[i] = !post && h >= 13 && h <= 19 ? 25 + r()*20 : 5;
  }
  return m;
}
async function demoOM(d, ens, TL){
  await new Promise(r => setTimeout(r, 60 + Math.random()*300));
  if (d.id === "ukmo") throw new Error("demo outage");
  return SITES.map((s, si) => {
    const r = rng((d.id.charCodeAt(0) * 97 + d.id.length * 31 + si * 7) | 0); const n = ens ? 20 : 1;
    const ms = []; for (let k = 0; k < n; k++){ const m = demoSeries(TL, r, (r() - 0.5)*4 + (si === 4 ? 1.5 : 0)); if (d.fam === "hires") for (let i = 48; i < TL.n; i++) Object.keys(m).forEach(x => m[x][i] = null); if (d.id !== "nbm") m.pp = new Array(TL.n).fill(null); m.gap = 3; deriveMember(m, TL.n); ms.push(m); }
    return ms;
  });
}
async function demoMOS(d, TL){
  await new Promise(r => setTimeout(r, 100 + Math.random()*300));
  const out = {};
  STATIONS.forEach((stn, si) => {
    const r = rng(d.model.charCodeAt(0)*13 + si); const m = demoSeries(TL, r, 0);
    const step = d.model === "LAV" ? 1 : 3, span = d.model === "LAV" ? 25 : d.model === "NBS" ? 72 : d.model === "GFSX" || d.model === "NBE" ? 190 : 72;
    Object.keys(m).forEach(k => { for (let i = 0; i < TL.n; i++) if (i < 6 || i > 6 + span || (i % step)) m[k][i] = null; });
    const iv = { pop:[], tst:[] }; const L = d.model === "LAV" ? 1 : d.model === "GFSX" || d.model === "NBE" ? 12 : 6, Lt = d.model === "LAV" ? 2 : d.model === "NBS" ? 3 : L;
    for (let t = TL.t0 + 6*H; t < TL.t0 + (6 + span)*H; t += L*H){ const h = lp(t).h; iv.pop.push({ a:t, b:t + L*H, p: h >= 12 && h <= 20 ? 0.2 + r()*0.3 : 0.05 }); }
    for (let t = TL.t0 + 6*H; t < TL.t0 + (6 + span)*H; t += Lt*H){ const h = lp(t).h; iv.tst.push({ a:t, b:t + Lt*H, p: h >= 13 && h <= 19 && t < TL.t0 + 76*H ? 0.1 + r()*0.25 : 0.01 }); }
    m.gap = L; deriveMember(m, TL.n);
    out[stn] = { members:[m], iv, run: Math.floor(Date.now()/(6*H))*6*H - 6*H, from:"demo" };
  });
  return out;
}
async function demoPipeline(TL){
  await new Promise(r => setTimeout(r, 200));
  const out = {};
  const run = Math.floor(Date.now()/(6*H))*6*H - 6*H;
  for (const d of PIPE){
    const per = {};
    SITES.forEach((s, si) => {
      const r = rng(d.id.length*101 + si*17);
      if (d.fam === "ct"){
        const tst = [], tst4 = [], maxh = d.id === "hrefct" ? 48 : 60;
        for (let h = 1; h <= maxh; h++){ const b = run + h*H, lh = lp(b).h; const base = lh >= 13 && lh <= 20 && h < 40 ? 0.08 + r()*0.25 : 0.01; tst.push({ a:b - H, b, p:base }); if (h >= 4) tst4.push({ a:b - 4*H, b, p:Math.min(0.9, base*2.2) }); }
        per[s.id] = { members:[], iv:{ tst, tst4 } };
      } else {
        const n = d.id === "refsm" ? 5 : 1, ms = [];
        for (let k = 0; k < n; k++){ const m = demoSeries(TL, r, (r() - 0.5)*3); const lim = TL.idx(run + (d.id === "rrfs" ? 84 : 60)*H); Object.keys(m).forEach(x => { for (let i = Math.max(0, lim); i < TL.n; i++) m[x][i] = null; }); m.pp = new Array(TL.n).fill(null); m.gap = 3; ms.push(deriveMember(m, TL.n)); }
        per[s.id] = { members: ms, iv:null };
      }
    });
    out[d.id] = { run, per, n: d.id === "refsm" ? 5 : 1 };
  }
  return out;
}
async function demoSPC(){ const t = Date.now(); const d = new Date(t); const v = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 12); return [{ cat:"MRGL", a:v, b:v + 24*H, geom:{ type:"Polygon", coordinates:[[[-81.5,27.5],[-80,27.5],[-80,29.5],[-81.5,29.5],[-81.5,27.5]]] } }]; }

/* ============================================================
   Events
   ============================================================ */
function bind(){
  document.querySelectorAll(".pagenav a").forEach(a => { if (a.dataset.page === PAGE) a.setAttribute("aria-current", "page"); });
  $("sites").addEventListener("click", ev => { const b = ev.target.closest("[data-site]"); if (!b) return; prefs.site = b.dataset.site; savePrefs(); S.cur = null; clearSel(); renderAll(); renderExpSetup(); });
  $("locator").addEventListener("click", ev => { const b = ev.target.closest("[data-site]"); if (!b) return; prefs.site = b.dataset.site; savePrefs(); renderAll(); });
  $("params").addEventListener("click", ev => { const b = ev.target.closest("[data-p]"); if (!b) return; if (prefs.param !== b.dataset.p) clearSel(); prefs.param = b.dataset.p; savePrefs(); renderParams(); renderChart(); renderMatrix(); });
  $("undo").onclick = undo; $("redo").onclick = redo;
  $("drawSel").addEventListener("click", ev => { const b = ev.target.closest("[data-d]"); if (!b) return; prefs.draw = b.dataset.d; savePrefs(); renderChart(); });
  $("resetSite").onclick = () => {
    const n = editCount(prefs.site); if (!n){ toast("No edits to clear"); return; }
    if (!confirm(`Clear all ${n} edits for ${site().name}? You can undo this.`)) return;
    const g = []; const e = edits[prefs.site] || {}; for (const k in e) for (const key in e[k]) setEdit(prefs.site, k, key, undefined, g); commit(g); toast("Reset to guidance");
  };
  $("modeSel").addEventListener("click", ev => { const b = ev.target.closest("[data-m]"); if (!b) return; prefs.cmode = b.dataset.m; savePrefs(); renderChart(); });
  $("resetParam").onclick = () => {
    if (CH.sel.size){ applyToPoints(() => null, selList()); return; }
    const g = []; for (const k of toolKeysG()){ const m = (edits[prefs.site] || {})[k] || {}; for (const key in m) setEdit(prefs.site, k, key, undefined, g); } commit(g);
  };
  $("nudgeUp").onclick = () => nudgeSel(1); $("nudgeDn").onclick = () => nudgeSel(-1);
  const setTo = () => {
    const ks = keysOf(prefs.param), v = parseInput(P[ks[0]], $("setVal").value);
    if (v === undefined || v === null){ toast("Type a value first"); $("setVal").focus(); return; }
    applyToPoints(k => v, scopePoints());
  };
  $("setGo").onclick = setTo; $("setVal").addEventListener("keydown", ev => { if (ev.key === "Enter"){ ev.preventDefault(); setTo(); } });
  $("smooth").onclick = () => {
    if (P[keysOf(prefs.param)[0]].kind === "dir") return toast("Smoothing isn't available for direction");
    const list = CH.sel.size ? selList() : scopePoints().filter(q => rawEdit(q.k, S.rows[q.i].key) !== undefined);
    if (!list.length) return toast("Select or edit some points first, then smooth them");
    const keep = {}; for (const q of list) (keep[q.k] = keep[q.k] || new Set()).add(q.i);
    const g = [];
    for (const k in keep){
      const pts = CH.hits.filter(h => h.k === k).map(h => h.i).sort((a, b) => a - b), v = OF.o[k];
      pts.forEach((i, j) => { if (!keep[k].has(i)) return; const a = v[pts[j - 1] ?? i], b = v[pts[j + 1] ?? i]; writeCell(k, i, clampV(k, (a + 2*v[i] + b)/4), g); });
    }
    commit(g);
  };
  $("publish").onclick = openPublish;
  $("pubDlg").addEventListener("close", () => { if ($("pubDlg").returnValue === "ok") doPublish(); });
  $("pubForm").addEventListener("submit", ev => { if (ev.submitter && ev.submitter.value === "ok" && !$("pubInit").value.trim()){ ev.preventDefault(); $("pubInit").focus(); } });
  $("orD").onclick = () => { prefs.orient = "down"; savePrefs(); renderAll(); };
  $("orA").onclick = () => { prefs.orient = "across"; savePrefs(); renderAll(); };
  document.querySelectorAll("#wuSel button").forEach(b => b.setAttribute("aria-pressed", b.dataset.u === wuLabel()));
  $("wuSel").onclick = ev => { const b = ev.target.closest("[data-u]"); if (!b) return; prefs.wu = b.dataset.u; savePrefs(); CH.layout = null; document.querySelectorAll("#wuSel button").forEach(x => x.setAttribute("aria-pressed", x.dataset.u === wuLabel())); renderAll(); };
  $("tzL").onclick = () => { prefs.tz = "L"; savePrefs(); renderAll(); renderExpSetup(); };
  $("tzZ").onclick = () => { prefs.tz = "Z"; savePrefs(); renderAll(); renderExpSetup(); };
  $("refresh").onclick = () => { if (S.loading) return; loadAll(); };
  $("initials").value = prefs.initials || ""; $("initials").oninput = e => { prefs.initials = e.target.value.toUpperCase(); savePrefs(); };
  $("linkProbs").checked = prefs.link; $("linkProbs").onchange = e => { prefs.link = e.target.checked; savePrefs(); renderAll(); };
  $("linkWin").checked = prefs.linkWin !== false; $("linkWin").onchange = e => { prefs.linkWin = e.target.checked; savePrefs(); renderAll(); };
  $("clampProbs").checked = prefs.clamp; $("clampProbs").onchange = e => { prefs.clamp = e.target.checked; savePrefs(); renderAll(); };
  $("hotThr").onchange = e => { const v = parseFloat(e.target.value); if (isFinite(v)){ prefs.hot[prefs.site] = v; savePrefs(); renderAll(); } };
  $("srcgrid").addEventListener("change", ev => {
    const t = ev.target;
    if (t.dataset.src){ prefs.enabled[t.dataset.src] = t.checked; }
    if (t.dataset.w){ prefs.weight[t.dataset.w] = parseFloat(t.value); }
    savePrefs(); recomputeAgg(); renderAll(); renderSources();
  });
  /* matrix */
  const mx = $("matrix");
  mx.addEventListener("click", ev => {
    const th = ev.target.closest("th[data-p]"); if (th){ if (P[th.dataset.p].kind !== "sev"){ if (viewOf(th.dataset.p) !== prefs.param) clearSel(); prefs.param = viewOf(th.dataset.p); savePrefs(); renderParams(); renderChart(); renderMatrix(); $("chart").scrollIntoView({ block:"nearest", behavior:"smooth" }); } return; }
    const td = ev.target.closest("td.c"); if (!td || ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT") return;
    const i = +td.dataset.i, k = td.dataset.k;
    if (S.cur && S.cur.i === i && S.cur.k === k && !td.classList.contains("na")) openEditor(i, k);
    else { selectCell(i, k); mx.focus({ preventScroll:true }); }
  });
  mx.addEventListener("dblclick", ev => { const td = ev.target.closest("td.c"); if (td) openEditor(+td.dataset.i, td.dataset.k); });
  mx.addEventListener("mouseover", ev => {
    const el = across() ? ev.target.closest("[data-i]") : ev.target.closest("tbody tr");
    if (!el) return; const i = across() ? +el.dataset.i : +el.dataset.r;
    if (!isFinite(i) || S.hoverRow === i) return; S.hoverRow = i; markHover(i); moveCursor(i);
  });
  mx.addEventListener("mouseleave", () => { S.hoverRow = null; markHover(null); moveCursor(null); });
  mx.addEventListener("keydown", ev => {
    if (editor || !S.cur) return;
    const ks = PARAMS.map(p => p.k); let { i, k } = S.cur; let ki = ks.indexOf(k);
    const mv = (di, dk) => {
      ev.preventDefault();
      if (di > 0){ const sp = spanMap(ks[ki])[i]; i += sp && sp.s ? sp.s : 1; } else if (di < 0) i -= 1;
      i = Math.max(0, Math.min(S.rows.length - 1, i)); ki = Math.max(0, Math.min(ks.length - 1, ki + dk));
      i = ownerIdx(ks[ki], i); selectCell(i, ks[ki], true);
    };
    if (ev.key === "ArrowDown") return mv(...visStep(1, 0));
    if (ev.key === "ArrowUp") return mv(...visStep(-1, 0));
    if (ev.key === "ArrowRight" || (ev.key === "Tab" && !ev.shiftKey)) return mv(...visStep(0, 1));
    if (ev.key === "ArrowLeft" || (ev.key === "Tab" && ev.shiftKey)) return mv(...visStep(0, -1));
    if (ev.key === "Enter" || ev.key === "F2"){ ev.preventDefault(); return openEditor(i, k); }
    if (ev.key === "Delete" || ev.key === "Backspace"){ ev.preventDefault(); const g = []; writeCell(k, i, null, g); commit(g); selectCell(i, k); return; }
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey && /[0-9a-zA-Z.\-]/.test(ev.key)){ ev.preventDefault(); openEditor(i, k, P[k].kind === "sky" || P[k].kind === "sev" ? null : ev.key); }
  });
  mx.addEventListener("paste", ev => {
    if (editor || !S.cur) return;
    const txt = (ev.clipboardData || window.clipboardData).getData("text"); if (!txt) return;
    ev.preventDefault();
    const lines = txt.replace(/\r/g, "").split("\n"); if (lines[lines.length - 1] === "") lines.pop();
    const ks = PARAMS.map(p => p.k), k0 = ks.indexOf(S.cur.k), g = []; let bad = 0, ri = S.cur.i;
    if (across()){
      /* lines are parameters, tab-separated cells run along time */
      lines.forEach((ln, li) => {
        const k = ks[k0 + li]; if (!k) return; let i = S.cur.i;
        for (const cell of ln.split("\t")){
          while (i < S.rows.length && OF.o[k][i] === undefined) i++;
          if (i >= S.rows.length) break;
          const v = parseInput(P[k], cell); if (v === undefined){ if (cell.trim()) bad++; } else writeCell(k, i, v, g);
          i++;
        }
      });
      commit(g); toast(`Pasted ${g.length} value${g.length === 1 ? "" : "s"}${bad ? `, skipped ${bad} unreadable` : ""}`);
      return;
    }
    for (const ln of lines){
      while (ri < S.rows.length && OF.o[S.cur.k][ri] === undefined) ri++;
      if (ri >= S.rows.length) break;
      ln.split("\t").forEach((cell, c) => { const k = ks[k0 + c]; if (!k) return; const v = parseInput(P[k], cell); if (v === undefined){ if (cell.trim()) bad++; return; } writeCell(k, ri, v, g); });
      ri++;
    }
    commit(g); toast(`Pasted ${g.length} value${g.length === 1 ? "" : "s"}${bad ? `, skipped ${bad} unreadable` : ""}`);
  });
  document.addEventListener("keydown", ev => {
    const mod = ev.ctrlKey || ev.metaKey; if (!mod || editor) return;
    if (ev.target.tagName === "INPUT" && ev.target.type === "text" && ev.target.id !== "") return;
    if (ev.key.toLowerCase() === "z" && !ev.shiftKey){ ev.preventDefault(); undo(); }
    else if ((ev.key.toLowerCase() === "z" && ev.shiftKey) || ev.key.toLowerCase() === "y"){ ev.preventDefault(); redo(); }
  });
  bindChart();
}
bind();
bindExp();
loadAll();
