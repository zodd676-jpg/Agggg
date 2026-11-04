/* Mirage Trading: демо-трейдинг по реальным ценам + прогнозы BTC.
   Всё на игровые деньги. Данные: Binance (крипто, реальные), Finnhub (акции, по желанию), иначе симуляция. */
(function () {
  if (window.__trd) return; window.__trd = 1;
  const $ = (i) => document.getElementById(i);
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const FEE = 0.0005, START = 10000, PAYOUT = 1.9;

  /* ---------- активы ---------- */
  const CR = [["BTC", "Bitcoin", 76000, "#f7931a"], ["ETH", "Ethereum", 2420, "#627eea"], ["SOL", "Solana", 99, "#14b8a6"], ["BNB", "BNB", 600, "#f3ba2f"], ["XRP", "XRP", 2, "#9aa4b2"], ["DOGE", "Dogecoin", 0.2, "#c2a633"], ["ADA", "Cardano", 0.6, "#3b82f6"], ["AVAX", "Avalanche", 25, "#e84142"], ["LINK", "Chainlink", 15, "#2a5ada"], ["TON", "Toncoin", 2.5, "#0098ea"], ["SUI", "Sui", 3.4, "#4da2ff"], ["LTC", "Litecoin", 90, "#8a98b8"]];
  const SK = [["AAPL", "Apple", 230, "#a3aab8"], ["TSLA", "Tesla", 330, "#e31937"], ["NVDA", "NVIDIA", 190, "#76b900"], ["MSFT", "Microsoft", 480, "#00a4ef"], ["AMZN", "Amazon", 230, "#ff9900"], ["GOOGL", "Alphabet", 250, "#4285f4"], ["META", "Meta", 650, "#0a7cff"], ["AMD", "AMD", 200, "#ed1c24"], ["COIN", "Coinbase", 300, "#1652f2"], ["MSTR", "Strategy", 300, "#d9232e"]];
  const A = {}, PR = {}, TK = {};
  CR.forEach((c) => { A[c[0]] = { s: c[0], n: c[1], k: "c", c: c[3] }; PR[c[0]] = { p: c[2], o: c[2], live: 0 }; });
  SK.forEach((c) => { A[c[0]] = { s: c[0], n: c[1], k: "s", c: c[3] }; PR[c[0]] = { p: c[2], o: c[2], live: 0 }; });
  try { (window.st && st.toks || []).forEach((t) => { if (A[t.s] && A[t.s].k === "c" && t.p > 0) PR[t.s].p = PR[t.s].o = t.p; }); } catch (e) {}
  // симуляционная предыстория для акций (пока нет живых данных)
  SK.forEach((c) => { let p = c[2] * (0.97 + Math.random() * 0.06); PR[c[0]].o = p; TK[c[0]] = []; for (let i = 0; i < 120; i++) { p *= 1 + (Math.random() - 0.5) * 0.002; TK[c[0]].push([Date.now() - (120 - i) * 2000, p]); } PR[c[0]].p = p; });
  CR.forEach((c) => { TK[c[0]] = []; });

  /* ---------- состояние ---------- */
  function T() {
    if (!st.trd || st.trd.v !== 1) st.trd = { v: 1, cash: START, pos: [], hist: [], bets: [], eq: [], id: 1, ts: Date.now() };
    return st.trd;
  }
  const sv = () => { try { save(); } catch (e) {} };
  let cur = "BTC", seg = "c", tf = "15m", side = 1, lev = 5, btf = 900, mode = "candle";
  let lastTick = 0, wsOk = false, fhKey = ""; try { fhKey = localStorage.getItem("fhk") || ""; } catch (e) {}

  /* ---------- форматирование ---------- */
  const fp = (p) => { p = +p; if (!isFinite(p)) return "–"; const a = Math.abs(p); return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: a >= 1000 ? 2 : a >= 1 ? 3 : a >= 0.1 ? 4 : 6 }); };
  const fm = (v, sg) => (v < 0 ? "−" : sg && v > 0 ? "+" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pc = (v) => (v < 0 ? "−" : "+") + Math.abs(v).toFixed(2) + "%";
  const cls = (v) => (v >= 0 ? "pos" : "neg");
  const dt = (t) => new Date(t).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isOn = (v) => { const e = $("v-" + v); return e && e.classList.contains("on"); };
  const feedLive = () => Date.now() - lastTick < 15000;
  const live = (s) => (A[s].k === "c" ? feedLive() : !!(fhKey && PR[s].live));

  /* ---------- котировки ---------- */
  const HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"];
  async function bget(path) { for (const h of HOSTS) { try { const r = await fetch(h + path); if (r.ok) return await r.json(); } catch (e) {} } throw new Error("net"); }

  function upd(s, p, o) {
    const r = PR[s]; if (!r || !(p > 0)) return;
    r.p = p; if (o > 0) r.o = o; r.live = 1;
    const a = TK[s], n = Date.now();
    if (!a.length || n - a[a.length - 1][0] >= 1000) { a.push([n, p]); if (a.length > 600) a.shift(); } else a[a.length - 1][1] = p;
    if (A[s].k === "c") { lastTick = n; liveCandle(s, p); }
    risk(s); sched();
  }
  function connWS() {
    try {
      const ws = new WebSocket("wss://stream.binance.com:9443/stream?streams=" + CR.map((c) => c[0].toLowerCase() + "usdt@miniTicker").join("/"));
      ws.onmessage = (e) => { try { const d = JSON.parse(e.data).data; if (d && d.s) upd(d.s.slice(0, -4), +d.c, +d.o); } catch (x) {} };
      ws.onopen = () => { wsOk = true; };
      ws.onclose = () => { wsOk = false; setTimeout(connWS, 5000); };
      ws.onerror = () => { try { ws.close(); } catch (x) {} };
    } catch (e) { setTimeout(connWS, 8000); }
  }
  async function poll() {
    if (Date.now() - lastTick < 6000) return;
    try {
      const q = encodeURIComponent(JSON.stringify(CR.map((c) => c[0] + "USDT")));
      const d = await bget("/api/v3/ticker/24hr?symbols=" + q);
      d.forEach((x) => upd(x.symbol.slice(0, -4), +x.lastPrice, +x.openPrice));
    } catch (e) {}
  }
  let fhI = 0;
  async function fhPoll() {
    if (!fhKey) return;
    const s = SK[fhI++ % SK.length][0];
    try { const r = await fetch("https://finnhub.io/api/v1/quote?symbol=" + s + "&token=" + encodeURIComponent(fhKey)); const j = await r.json(); if (j && j.c > 0) upd(s, j.c, j.pc || j.o); } catch (e) {}
  }
  function simulate() {
    // акции без ключа и крипто без сети двигаются случайно (честно помечено «симуляция»)
    Object.keys(A).forEach((s) => {
      const k = A[s].k; if (k === "c" ? feedLive() : (fhKey && PR[s].live)) return;
      const r = PR[s]; r.p *= 1 + (Math.random() - 0.5) * (k === "c" ? 0.0012 : 0.0016); r.live = 0;
      const a = TK[s], n = Date.now(); if (!a.length || n - a[a.length - 1][0] >= 1000) { a.push([n, r.p]); if (a.length > 600) a.shift(); }
      if (k === "c") liveCandle(s, r.p);
      risk(s);
    });
    sched();
  }

  /* ---------- свечи ---------- */
  const TFM = { "1m": 6e4, "5m": 3e5, "15m": 9e5, "1h": 36e5, "1d": 864e5 }, KL = {};
  async function loadK(s, f) {
    const key = s + f; if (KL[key] && Date.now() - KL[key].t < 60000) return KL[key];
    try {
      const d = await bget("/api/v3/klines?symbol=" + s + "USDT&interval=" + f + "&limit=120");
      KL[key] = { t: Date.now(), d: d.map((k) => [k[0], +k[1], +k[2], +k[3], +k[4]]) };
    } catch (e) { if (!KL[key]) KL[key] = { t: Date.now() - 50000, d: [] }; }
    return KL[key];
  }
  function liveCandle(s, p) {
    Object.keys(TFM).forEach((f) => {
      const o = KL[s + f]; if (!o || !o.d.length) return;
      const b = Math.floor(Date.now() / TFM[f]) * TFM[f], l = o.d[o.d.length - 1];
      if (l[0] === b) { l[4] = p; l[2] = Math.max(l[2], p); l[3] = Math.min(l[3], p); }
      else if (b > l[0]) { o.d.push([b, p, p, p, p]); if (o.d.length > 200) o.d.shift(); }
    });
  }

  /* ---------- график ---------- */
  function col(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888"; }
  function chart(cv, pts, o) {
    // pts: свечи [t,o,h,l,c] или линия [[t,p]]; o: {line, lines:[{p,c,l}], N}
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr; const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    const pos = col("--pos"), neg = col("--neg"), mut = col("--m"), grid = col("--l");
    x.font = "500 10px Inter,system-ui"; x.textBaseline = "middle";
    if (!pts || pts.length < 2) { x.fillStyle = mut; x.textAlign = "center"; x.fillText(o && o.empty || "Загрузка графика…", w / 2, h / 2); return; }
    const N = Math.min(pts.length, o.N || 90), v = pts.slice(-N), padR = 58, W = w - padR;
    const val = (q) => (o.line ? q[1] : q[4]);
    let mn = Infinity, mx = -Infinity;
    v.forEach((q) => { const lo = o.line ? q[1] : q[3], hi = o.line ? q[1] : q[2]; mn = Math.min(mn, lo); mx = Math.max(mx, hi); });
    (o.lines || []).forEach((l) => { if (l.p > mn - (mx - mn) * 0.4 && l.p < mx + (mx - mn) * 0.4) { mn = Math.min(mn, l.p); mx = Math.max(mx, l.p); } });
    const pad = (mx - mn) * 0.08 || mx * 0.001; mn -= pad; mx += pad;
    const Y = (p) => 8 + (1 - (p - mn) / (mx - mn)) * (h - 16);
    x.textAlign = "left"; x.strokeStyle = grid; x.fillStyle = mut; x.lineWidth = 1;
    for (let i = 0; i < 5; i++) { const p = mn + ((mx - mn) * i) / 4, y = Y(p); x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); x.fillText(fp(p), W + 6, y); }
    const cw = W / N;
    if (o.line) {
      const up = val(v[v.length - 1]) >= val(v[0]), c = up ? pos : neg;
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, c + "44"); g.addColorStop(1, c + "00");
      x.beginPath(); v.forEach((q, i) => { const px = i * cw + cw / 2; i ? x.lineTo(px, Y(q[1])) : x.moveTo(px, Y(q[1])); });
      x.strokeStyle = c; x.lineWidth = 2; x.stroke(); x.lineTo((v.length - 1) * cw + cw / 2, h); x.lineTo(cw / 2, h); x.closePath(); x.fillStyle = g; x.fill();
    } else {
      v.forEach((q, i) => {
        const c = q[4] >= q[1] ? pos : neg, px = i * cw + cw / 2; x.strokeStyle = x.fillStyle = c; x.lineWidth = 1;
        x.beginPath(); x.moveTo(px, Y(q[2])); x.lineTo(px, Y(q[3])); x.stroke();
        const y1 = Y(q[1]), y2 = Y(q[4]); x.fillRect(px - cw * 0.35, Math.min(y1, y2), cw * 0.7, Math.max(1, Math.abs(y2 - y1)));
      });
    }
    const tag = (p, c, txt, dash) => { const y = Y(p); x.strokeStyle = c; x.setLineDash(dash ? [4, 4] : []); x.lineWidth = 1; x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); x.setLineDash([]); x.fillStyle = c; x.fillRect(W + 1, y - 8, padR - 1, 16); x.fillStyle = "#000"; x.fillText(txt || fp(p), W + 5, y); };
    (o.lines || []).forEach((l) => { if (Y(l.p) > 0 && Y(l.p) < h) tag(l.p, l.c, l.l, 1); });
    const lp = val(v[v.length - 1]); tag(lp, val(v[v.length - 1]) >= (o.line ? v[0][1] : v[v.length - 1][1]) ? pos : neg, fp(lp), 1);
  }

  /* ---------- торговля ---------- */
  const pnlOf = (p, price) => p.side * (price - p.entry) * p.qty;
  const liqOf = (p) => p.entry * (1 - (p.side * 0.9) / p.lev);
  function equity() { const t = T(); return t.cash + t.pos.reduce((s, p) => s + p.margin + pnlOf(p, PR[p.s].p), 0) + t.bets.filter((b) => b.st === "open").reduce((s, b) => s + b.stake, 0); }

  function openPos() {
    const t = T(), amt = +($("kAmt").value || 0), r = PR[cur];
    const tp = +$("kTp").value || 0, sl = +$("kSl").value || 0;
    if (!(amt >= 10)) return toast("Минимум $10");
    const fee = amt * lev * FEE; if (amt + fee > t.cash + 1e-9) return toast("Не хватает демо-баланса");
    const p = { id: t.id++, s: cur, side, lev, entry: r.p, margin: amt, qty: (amt * lev) / r.p, fee0: fee, tp, sl, ts: Date.now() };
    if (tp && (side > 0 ? tp <= p.entry : tp >= p.entry)) return toast("Take Profit должен быть " + (side > 0 ? "выше" : "ниже") + " цены входа");
    if (sl && (side > 0 ? sl >= p.entry : sl <= p.entry)) return toast("Stop Loss должен быть " + (side > 0 ? "ниже" : "выше") + " цены входа");
    if (sl && (side > 0 ? sl <= liqOf(p) : sl >= liqOf(p))) return toast("Stop Loss за ценой ликвидации");
    t.cash -= amt + fee; t.pos.unshift(p); sv(); toast((side > 0 ? "Лонг " : "Шорт ") + cur + " " + lev + "× открыт"); renderAll();
  }
  function closePos(id, price, why) {
    const t = T(), i = t.pos.findIndex((p) => p.id === id); if (i < 0) return;
    const p = t.pos[i]; t.pos.splice(i, 1);
    const net = pnlOf(p, price) - p.qty * price * FEE, back = Math.max(0, p.margin + net), res = back - p.margin - p.fee0;
    t.cash += back; t.hist.unshift({ s: p.s, side: p.side, lev: p.lev, entry: p.entry, exit: price, margin: p.margin, pnl: res, why, ts: p.ts, te: Date.now() }); t.hist = t.hist.slice(0, 200);
    sv(); if (why !== "ручн.") toast({ "ликв.": "Ликвидация ", "SL": "Stop Loss ", "TP": "Take Profit " }[why] + p.s + ": " + fm(res, 1)); else toast("Закрыто " + p.s + ": " + fm(res, 1));
    renderAll();
  }
  function risk(s) {
    const t = T(), r = PR[s];
    t.pos.filter((p) => p.s === s).forEach((p) => {
      const x = r.p, lq = liqOf(p);
      if (p.side > 0 ? x <= lq : x >= lq) return closePos(p.id, lq, "ликв.");
      if (p.sl && (p.side > 0 ? x <= p.sl : x >= p.sl)) return closePos(p.id, p.sl, "SL");
      if (p.tp && (p.side > 0 ? x >= p.tp : x <= p.tp)) return closePos(p.id, p.tp, "TP");
    });
  }

  /* ---------- ставки на BTC ---------- */
  function placeBet(dir) {
    const t = T(), stake = +($("bAmt").value || 0);
    if (!(stake >= 1)) return toast("Минимум $1"); if (stake > t.cash) return toast("Не хватает демо-баланса");
    const n = Date.now(); t.cash -= stake;
    t.bets.unshift({ id: t.id++, dir, stake, open: PR.BTC.p, ts: n, exp: n + btf * 1000, st: "open", sim: !feedLive() });
    sv(); toast("Ставка принята: BTC " + (dir > 0 ? "вверх ▲" : "вниз ▼")); renderAll();
  }
  async function settle(b) {
    if (b.busy) return; b.busy = 1; let px = PR.BTC.p;
    if (Date.now() - b.exp > 4000) { try { const k = await bget("/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=" + b.exp + "&limit=1"); if (k[0]) px = +k[0][1]; } catch (e) {} }
    const t = T(); b.close = px; const d = Math.sign(px - b.open);
    if (d === 0) { b.st = "push"; t.cash += b.stake; } else if (d === b.dir) { b.st = "win"; t.cash += b.stake * PAYOUT; } else b.st = "loss";
    delete b.busy; sv();
    toast(b.st === "win" ? "Ставка выиграла +" + fm(b.stake * (PAYOUT - 1)) : b.st === "loss" ? "Ставка проиграла −" + fm(b.stake) : "Ничья, ставка возвращена"); renderAll();
  }
  setInterval(() => { T().bets.filter((b) => b.st === "open" && b.exp <= Date.now()).forEach(settle); if (isOn("pre")) rBets(); }, 1000);

  /* ---------- UI: Рынки ---------- */
  const CSS = `
.tc{background:var(--p);border:1px solid var(--l);border-radius:20px;padding:14px;margin-bottom:12px}
.tc.hero{background:linear-gradient(160deg,color-mix(in srgb,var(--a) 22%,var(--p)),var(--p) 60%)}
.tc h4{margin:0 0 8px;font:600 13px Inter,system-ui;color:var(--m)}
.tr{display:flex;justify-content:space-between;align-items:center;gap:10px}
.tbig{font:700 34px/1.1 Inter,system-ui;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.tsm{font-size:12px;color:var(--m)}
.tbd{display:inline-flex;align-items:center;gap:6px;font:600 11px Inter,system-ui;border-radius:99px;padding:4px 10px;background:rgba(127,127,127,.15);color:var(--m)}
.tbd i{width:7px;height:7px;border-radius:50%;background:#f5a524;display:block}.tbd.on i{background:var(--pos);box-shadow:0 0 0 0 var(--pos);animation:tpl 1.6s infinite}
@keyframes tpl{70%{box-shadow:0 0 0 7px transparent}}
.tseg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:var(--p);border:1px solid var(--l);border-radius:14px;padding:3px;gap:3px;margin-bottom:10px}
.tseg button,.ttf button{border:0;background:none;color:var(--m);font:600 14px Inter,system-ui;padding:10px 6px;border-radius:11px;cursor:pointer}
.tseg [aria-pressed=true],.ttf [aria-pressed=true]{background:var(--a);color:#fff}
.ttf{display:flex;gap:4px;margin:10px 0 6px}.ttf button{padding:6px 12px;font-size:13px}.ttf .sp{flex:1}
.tchips{display:flex;gap:8px;overflow-x:auto;margin:0 -16px 12px;padding:0 16px 2px;scrollbar-width:none}.tchips::-webkit-scrollbar{display:none}
.tchip{flex:none;border:1px solid var(--l);background:var(--p);color:var(--t);border-radius:16px;padding:9px 12px;text-align:left;cursor:pointer;font:inherit;min-width:92px}
.tchip b{display:block;font:700 14px Inter,system-ui}.tchip span{display:block;font:500 12px Inter,system-ui;color:var(--m);font-variant-numeric:tabular-nums}.tchip em{font:600 11px Inter,system-ui;font-style:normal}
.tchip[aria-pressed=true]{border-color:var(--a);background:color-mix(in srgb,var(--a) 14%,var(--p))}
.tcv{width:100%;height:230px;display:block}
.tsd{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.tsd button{border:2px solid transparent;border-radius:14px;padding:13px;font:700 15px Inter,system-ui;cursor:pointer;background:rgba(127,127,127,.12);color:var(--m)}
.tsd .L[aria-pressed=true]{background:var(--pos);color:#04210f}.tsd .S[aria-pressed=true]{background:var(--neg);color:#2a0008}
.tfl{display:flex;gap:6px;margin-top:6px}.tfl button{flex:1;border:1px solid var(--l);background:none;color:var(--m);border-radius:10px;padding:7px 0;font:600 12px Inter,system-ui;cursor:pointer}
.tkv{display:grid;gap:6px;font-size:13px;color:var(--m);margin:10px 0}.tkv div{display:flex;justify-content:space-between}.tkv b{color:var(--t);font-weight:600;font-variant-numeric:tabular-nums}
input[type=range]{padding:0;border:0;accent-color:var(--a);height:28px}
.tgo{width:100%;border:0;border-radius:14px;padding:15px;font:700 16px Inter,system-ui;cursor:pointer;color:#fff}
.tgo.L{background:var(--pos);color:#04210f}.tgo.S{background:var(--neg);color:#2a0008}
.tpos{background:var(--p);border:1px solid var(--l);border-radius:18px;padding:13px;margin-bottom:10px}
.tpos .h{display:flex;justify-content:space-between;align-items:flex-start}
.tpos .pl{font:700 20px Inter,system-ui;text-align:right;font-variant-numeric:tabular-nums}.tpos .pl small{display:block;font:600 12px Inter,system-ui}
.tsd2{font:700 11px Inter,system-ui;border-radius:6px;padding:2px 7px;margin-left:6px}.tsd2.L{background:var(--pos);color:#04210f}.tsd2.S{background:var(--neg);color:#2a0008}
.tpos .g{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin:10px 0;font-size:12px;color:var(--m)}.tpos .g b{display:block;color:var(--t);font-weight:600;font-variant-numeric:tabular-nums}
.tcl{width:100%;border:1px solid var(--l);background:none;color:var(--t);border-radius:11px;padding:9px;font:600 14px Inter,system-ui;cursor:pointer}
.thr{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--l);font-size:14px}.thr:last-child{border:0}.thr small{color:var(--m);display:block}
.tst{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:6px}.tst div{background:rgba(127,127,127,.1);border-radius:12px;padding:10px;text-align:center}.tst b{display:block;font:700 16px Inter,system-ui}.tst small{font-size:11px;color:var(--m)}
details.tl{background:var(--p);border:1px solid var(--l);border-radius:14px;padding:12px 14px;margin-bottom:8px}details.tl summary{font:600 14px Inter,system-ui;cursor:pointer}details.tl p{margin:8px 0 0;font-size:13px;color:var(--m);line-height:1.5}
.tb2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.tb2 button{border:0;border-radius:16px;padding:16px 8px;cursor:pointer;font:800 17px Inter,system-ui;display:grid;gap:2px}.tb2 small{font:600 12px Inter,system-ui;opacity:.8}
.tb2 .U{background:var(--pos);color:#04210f}.tb2 .D{background:var(--neg);color:#2a0008}
.tgauge{height:10px;border-radius:99px;background:linear-gradient(90deg,var(--neg),#f5a524 50%,var(--pos));position:relative;margin:14px 0 6px}.tgauge i{position:absolute;top:-5px;width:6px;height:20px;border-radius:3px;background:var(--t);transform:translateX(-50%);box-shadow:0 0 0 3px var(--p);transition:left .6s}
.tbar{height:4px;border-radius:9px;background:rgba(127,127,127,.2);overflow:hidden;margin-top:8px}.tbar i{display:block;height:100%;background:var(--a)}
.tfc{display:grid;gap:4px;font-size:13px;margin-top:10px}.tfc div{display:flex;justify-content:space-between;color:var(--m)}.tfc b{color:var(--t);font-weight:600}
.tw{font-size:12px;color:var(--m);line-height:1.45;margin-top:10px}.tbn{background:rgba(245,165,36,.14);color:#f5a524;border-radius:10px;padding:8px 10px;font-size:12px;margin-bottom:10px;display:none}
@media(prefers-color-scheme:dark){.tc,.tpos,details.tl,.tseg,.tchip{background:#0f0f10;border-color:rgba(255,255,255,.06)}.tc.hero{background:linear-gradient(160deg,#1b1740,#0f0f10 62%)}}`;
  const st1 = document.createElement("style"); st1.textContent = CSS; document.head.appendChild(st1);

  const sel = (q) => document.querySelector(q);
  $("v-trd") || sel(".w").insertAdjacentHTML("beforeend", '<section class="view" id="v-trd"></section>');
  $("v-trd").innerHTML = `
<div class="tc hero"><div class="tr"><div><div class="tsm">Демо-счёт · игровые деньги</div><div class="tbig" id="eqV">$10,000.00</div><div class="tsm" id="eqP"></div></div><div style="text-align:right"><span class="tbd" id="tSt"><i></i><span>…</span></span><svg id="eqS" viewBox="0 0 120 40" width="120" height="40" style="display:block;margin-top:8px"></svg></div></div>
<div class="tkv" style="margin-bottom:0"><div><span>Свободно</span><b id="eqC"></b></div><div><span>В позициях и ставках</span><b id="eqM"></b></div></div></div>
<div class="tseg" id="tSeg"><button data-k="c" aria-pressed="true">Крипто</button><button data-k="s" aria-pressed="false">Акции</button></div>
<div class="tchips" id="tChips"></div>
<div class="tc"><div class="tr"><div><b id="tSym" style="font-size:18px"></b><div class="tsm" id="tNm"></div></div><div style="text-align:right"><div class="tbig" style="font-size:26px" id="tPx"></div><b id="tCh" style="font-size:13px"></b></div></div>
<div class="ttf" id="tTf"><button data-f="1m">1м</button><button data-f="5m">5м</button><button data-f="15m" aria-pressed="true">15м</button><button data-f="1h">1ч</button><button data-f="1d">1д</button><span class="sp"></span><button data-m="line" id="tMd">Линия</button></div>
<canvas class="tcv" id="tCv"></canvas><div class="tsm" id="tNote" style="margin-top:6px"></div></div>
<div class="tc"><h4>Новая сделка</h4><div class="tbn" id="kWarn"></div>
<div class="tsd"><button class="L" data-sd="1" aria-pressed="true">▲ Лонг (рост)</button><button class="S" data-sd="-1" aria-pressed="false">▼ Шорт (падение)</button></div>
<label>Маржа, $<input id="kAmt" inputmode="decimal" placeholder="500"></label>
<div class="tfl" id="kPc"><button data-p=".1">10%</button><button data-p=".25">25%</button><button data-p=".5">50%</button><button data-p="1">Макс</button></div>
<label style="margin-top:12px">Плечо: <b id="kLvT" style="color:var(--t)">5×</b><input id="kLev" type="range" min="1" max="50" value="5"></label>
<div class="row" style="margin-top:8px"><label>Take Profit<input id="kTp" inputmode="decimal" placeholder="необяз."></label><label>Stop Loss<input id="kSl" inputmode="decimal" placeholder="необяз."></label></div>
<div class="tkv"><div><span>Размер позиции</span><b id="kSz">–</b></div><div><span>Комиссия (0.05%)</span><b id="kFee">–</b></div><div><span>Цена ликвидации</span><b id="kLq">–</b></div></div>
<button class="tgo L" id="kGo">Открыть</button></div>
<h2>Открытые позиции</h2><div id="tPos"></div>
<h2>Статистика и история</h2><div class="tc"><div class="tst" id="tSta"></div><div id="tHis"></div></div>
<h2>Школа трейдинга</h2>
<details class="tl"><summary>Что такое лонг и шорт</summary><p>Лонг — ты зарабатываешь, когда цена растёт. Шорт — когда падает. Оба варианта открываются одной кнопкой, поэтому можно торговать и на падении рынка.</p></details>
<details class="tl"><summary>Плечо и ликвидация</summary><p>Плечо 10× значит, что позиция в 10 раз больше твоей маржи: прибыль и убыток тоже в 10 раз больше. Если цена идёт против тебя на ~9% (при 10×), позицию принудительно закрывают и маржа сгорает. Чем больше плечо, тем ближе ликвидация.</p></details>
<details class="tl"><summary>Stop Loss и Take Profit</summary><p>Stop Loss автоматически закрывает сделку, если убыток дошёл до заданной цены. Take Profit — когда прибыль достигла цели. Профессионалы почти всегда ставят стоп до входа в сделку.</p></details>
<details class="tl"><summary>Правило риска 1–2%</summary><p>Старайся терять в одной сделке не больше 1–2% счёта. Тогда серия из 10 неудач не уничтожит депозит. Размер риска = расстояние до стопа × размер позиции.</p></details>
<details class="tl"><summary>Реальные цены акций</summary><p>Крипто-цены реальные (Binance), график свечей тоже. Для акций нужен бесплатный ключ на finnhub.io. Без него акции двигаются в режиме симуляции.</p><label style="margin-top:8px">Finnhub API key<input id="fhK" placeholder="вставь ключ" autocomplete="off"></label><button class="btn" id="fhS" style="margin-top:8px">Сохранить ключ</button></details>
<button class="btn g" id="tRst" style="margin-top:6px;color:var(--m)">Сбросить демо-счёт до $10,000</button>
<p class="note">Это учебный симулятор: деньги игровые, реальные сделки не совершаются. Прошлые результаты не гарантируют будущих.</p>`;

  function setSeg(k) {
    seg = k; document.querySelectorAll("#tSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.k === k));
    const list = k === "c" ? CR : SK;
    $("tChips").innerHTML = list.map((c) => `<button class="tchip" data-s="${c[0]}"><b>${c[0]}</b><span data-px="${c[0]}"></span><em data-ch="${c[0]}"></em></button>`).join("");
    if (A[cur].k !== k) cur = list[0][0];
    $("kLev").max = k === "c" ? 50 : 10; if (lev > +$("kLev").max) { lev = +$("kLev").max; $("kLev").value = lev; }
    $("tTf").style.display = k === "c" ? "" : "none";
    pick(cur);
  }
  async function pick(s) {
    cur = s; document.querySelectorAll("#tChips .tchip").forEach((b) => b.setAttribute("aria-pressed", b.dataset.s === s));
    $("tSym").textContent = s + (A[s].k === "c" ? "/USDT" : ""); $("tNm").textContent = A[s].n;
    $("kTp").value = $("kSl").value = ""; rQuote(); rTicket();
    if (A[s].k === "c") { await loadK(s, tf); }
    rQuote();
  }
  function rHead() {
    const t = T(), e = equity(), g = e - START, locked = e - t.cash;
    $("eqV").textContent = fm(e); $("eqP").innerHTML = `<span class="${cls(g)}">${fm(g, 1)} (${pc((g / START) * 100)})</span> за всё время`;
    $("eqC").textContent = fm(t.cash); $("eqM").textContent = fm(locked);
    const n = Date.now(), L = t.eq[t.eq.length - 1]; if (!L || n - L[0] > 20000) { t.eq.push([n, e]); if (t.eq.length > 400) t.eq.shift(); }
    const q = t.eq.slice(-60); if (q.length > 1) { const mn = Math.min(...q.map((x) => x[1])), mx = Math.max(...q.map((x) => x[1])) || 1, c = q[q.length - 1][1] >= q[0][1] ? "var(--pos)" : "var(--neg)"; $("eqS").innerHTML = `<polyline fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" points="${q.map((x, i) => (i * 120 / (q.length - 1)).toFixed(1) + "," + (36 - ((x[1] - mn) / (mx - mn || 1)) * 32).toFixed(1)).join(" ")}"/>`; }
    const bd = $("tSt"), lv = feedLive(); bd.className = "tbd" + (lv ? " on" : ""); bd.lastChild.textContent = lv ? "LIVE · Binance" : "симуляция цен";
  }
  function rChips() {
    document.querySelectorAll("[data-px]").forEach((e) => { const r = PR[e.dataset.px]; e.textContent = fp(r.p); });
    document.querySelectorAll("[data-ch]").forEach((e) => { const r = PR[e.dataset.ch], c = ((r.p - r.o) / r.o) * 100; e.textContent = pc(c); e.className = cls(c); });
  }
  function rQuote() {
    const r = PR[cur], c = ((r.p - r.o) / r.o) * 100; $("tPx").textContent = "$" + fp(r.p); const e = $("tCh"); e.textContent = pc(c) + " · 24ч"; e.className = cls(c);
    const t = T(), lines = t.pos.filter((p) => p.s === cur).flatMap((p) => [{ p: p.entry, c: p.side > 0 ? col("--pos") : col("--neg"), l: "вход" }].concat(p.tp ? [{ p: p.tp, c: col("--pos"), l: "TP" }] : [], p.sl ? [{ p: p.sl, c: col("--neg"), l: "SL" }] : [], [{ p: liqOf(p), c: "#f5a524", l: "ликв." }]));
    const k = A[cur].k === "c"; let pts, o = { lines, line: mode === "line" };
    if (k) { const d = KL[cur + tf]; pts = d && d.d; if (pts && !pts.length) o.empty = "Нет данных (нет связи с Binance)"; if (mode === "line" && pts) pts = pts.map((q) => [q[0], q[4]]); }
    else { o.line = 1; pts = TK[cur]; o.N = 150; o.empty = "График копится в реальном времени…"; }
    chart($("tCv"), pts, o);
    $("tNote").textContent = k ? (live(cur) ? "Реальная цена Binance, обновляется в реальном времени." : "Нет связи с Binance: цены условные (симуляция).") : (live(cur) ? "Реальная котировка Finnhub." : "Симуляция цены. Для реальных котировок добавь ключ Finnhub в разделе «Школа».");
    $("kWarn").style.display = live(cur) ? "none" : "block"; $("kWarn").textContent = "Режим симуляции: цена этого актива сейчас не из реального рынка.";
  }
  function rTicket() {
    const t = T(), r = PR[cur], m = +($("kAmt").value || 0), n = m * lev;
    $("kLvT").textContent = lev + "×"; $("kSz").textContent = fm(n); $("kFee").textContent = fm(n * FEE);
    $("kLq").textContent = m ? "$" + fp(r.p * (1 - (side * 0.9) / lev)) : "–";
    const b = $("kGo"); b.className = "tgo " + (side > 0 ? "L" : "S"); b.textContent = (side > 0 ? "Открыть лонг " : "Открыть шорт ") + cur + " " + lev + "×";
    document.querySelectorAll(".tsd button").forEach((x) => x.setAttribute("aria-pressed", +x.dataset.sd === side));
  }
  function rPos() {
    const t = T(); $("tPos").innerHTML = t.pos.length ? t.pos.map((p) => {
      const r = PR[p.s], pn = pnlOf(p, r.p) - p.qty * r.p * FEE, roe = (pn / p.margin) * 100;
      return `<div class="tpos"><div class="h"><div><b>${p.s}</b><span class="tsd2 ${p.side > 0 ? "L" : "S"}">${p.side > 0 ? "ЛОНГ" : "ШОРТ"} ${p.lev}×</span><div class="tsm">маржа ${fm(p.margin)} · ${dt(p.ts)}</div></div><div class="pl ${cls(pn)}">${fm(pn, 1)}<small>${pc(roe)}</small></div></div>
<div class="g"><div>Вход<b>${fp(p.entry)}</b></div><div>Сейчас<b>${fp(r.p)}</b></div><div>Ликвидация<b>${fp(liqOf(p))}</b></div>${p.tp ? `<div>Take Profit<b>${fp(p.tp)}</b></div>` : ""}${p.sl ? `<div>Stop Loss<b>${fp(p.sl)}</b></div>` : ""}</div><button class="tcl" data-cl="${p.id}">Закрыть позицию</button></div>`;
    }).join("") + (t.pos.length > 1 ? '<button class="tcl" data-cl="all" style="margin-bottom:10px">Закрыть все</button>' : "") : '<div class="tc tsm" style="text-align:center">Нет открытых позиций. Открой первую сделку выше.</div>';
  }
  function stats(arr) { const w = arr.filter((x) => x.pnl > 0).length, tot = arr.reduce((s, x) => s + x.pnl, 0); return { n: arr.length, wr: arr.length ? (w / arr.length) * 100 : 0, tot, best: arr.length ? Math.max(...arr.map((x) => x.pnl)) : 0, worst: arr.length ? Math.min(...arr.map((x) => x.pnl)) : 0 }; }
  function rHist() {
    const h = T().hist, s = stats(h);
    $("tSta").innerHTML = `<div><b>${s.n}</b><small>сделок</small></div><div><b>${s.n ? s.wr.toFixed(0) + "%" : "–"}</b><small>прибыльных</small></div><div><b class="${cls(s.tot)}">${fm(s.tot, 1)}</b><small>итог</small></div>`;
    $("tHis").innerHTML = h.length ? h.slice(0, 15).map((x) => `<div class="thr"><div><b>${x.s}</b> <span class="tsd2 ${x.side > 0 ? "L" : "S"}">${x.side > 0 ? "ЛОНГ" : "ШОРТ"} ${x.lev}×</span><small>${fp(x.entry)} → ${fp(x.exit)} · ${x.why} · ${dt(x.te)}</small></div><b class="${cls(x.pnl)}">${fm(x.pnl, 1)}</b></div>`).join("") : '<div class="tsm" style="text-align:center;padding:6px">Пока пусто</div>';
  }

  /* ---------- UI: Прогнозы ---------- */
  $("v-pre").innerHTML = `
<div class="tc hero"><div class="tr"><div><div class="tsm">Bitcoin · BTC/USDT</div><div class="tbig" id="pPx">–</div><b id="pCh" style="font-size:13px"></b></div><span class="tbd" id="pSt"><i></i><span>…</span></span></div><canvas class="tcv" id="pCv" style="height:150px;margin-top:8px"></canvas></div>
<h2 style="margin-top:4px">Ставка: куда пойдёт Bitcoin?</h2>
<div class="tc"><div class="tbn" id="pWarn">Нет связи с Binance: цена условная, ставка не по реальному рынку.</div>
<div class="ttf" id="pTf" style="margin-top:0"><button data-t="60">1 мин</button><button data-t="300">5 мин</button><button data-t="900" aria-pressed="true">15 мин</button><button data-t="3600">1 час</button><button data-t="86400">24 ч</button></div>
<label>Ставка, $ <span class="tsm" id="pBal"></span><input id="bAmt" inputmode="decimal" placeholder="50" value="50"></label>
<div class="tfl" id="bPc"><button data-p="10">$10</button><button data-p="50">$50</button><button data-p="100">$100</button><button data-p="500">$500</button></div>
<div class="tb2" style="margin-top:12px"><button class="U" data-d="1">▲ ВВЕРХ<small id="bU"></small></button><button class="D" data-d="-1">▼ ВНИЗ<small id="bD"></small></button></div>
<div class="tw">Фиксируется цена сейчас. Через выбранное время сравнивается цена Bitcoin на Binance: угадал — получаешь ставку ×${PAYOUT}, нет — теряешь ставку, одинаково — возврат.</div></div>
<div id="pBets"></div>
<h2>Прогноз Mirage</h2>
<div class="tc" id="pSig"><div class="tsm" style="text-align:center;padding:12px">Считаю по реальным свечам…</div></div>
<h2>Мои ставки</h2><div class="tc"><div class="tst" id="pSta"></div><div id="pHis"></div></div>`;

  function rBets() {
    const t = T(), o = t.bets.filter((b) => b.st === "open");
    $("pBets").innerHTML = o.length ? '<h2>Активные ставки</h2>' + o.map((b) => {
      const left = Math.max(0, b.exp - Date.now()), tot = b.exp - b.ts, p = PR.BTC.p, win = Math.sign(p - b.open) === b.dir, mm = Math.floor(left / 6e4), ss = Math.floor((left % 6e4) / 1e3), hh = Math.floor(mm / 60);
      return `<div class="tpos"><div class="h"><div><b>BTC ${b.dir > 0 ? "▲ вверх" : "▼ вниз"}</b><div class="tsm">ставка ${fm(b.stake)} · старт $${fp(b.open)}</div></div><div class="pl ${win ? "pos" : "neg"}">${win ? "выигрывает" : "проигрывает"}<small>${hh ? hh + "ч " + (mm % 60) + "м" : mm + ":" + String(ss).padStart(2, "0")}</small></div></div><div class="tbar"><i style="width:${cl(100 - (left / tot) * 100, 0, 100)}%"></i></div></div>`;
    }).join("") : "";
    const h = t.bets.filter((b) => b.st !== "open"), w = h.filter((b) => b.st === "win").length, net = h.reduce((s, b) => s + (b.st === "win" ? b.stake * (PAYOUT - 1) : b.st === "loss" ? -b.stake : 0), 0);
    $("pSta").innerHTML = `<div><b>${h.length}</b><small>ставок</small></div><div><b>${h.length ? ((w / h.length) * 100).toFixed(0) + "%" : "–"}</b><small>угадано</small></div><div><b class="${cls(net)}">${fm(net, 1)}</b><small>итог</small></div>`;
    $("pHis").innerHTML = h.length ? h.slice(0, 12).map((b) => `<div class="thr"><div><b>${b.dir > 0 ? "▲ вверх" : "▼ вниз"}</b> · ${fm(b.stake)}<small>${fp(b.open)} → ${fp(b.close)} · ${dt(b.ts)}</small></div><b class="${b.st === "win" ? "pos" : b.st === "loss" ? "neg" : ""}">${b.st === "win" ? "+" + fm(b.stake * (PAYOUT - 1)) : b.st === "loss" ? "−" + fm(b.stake) : "ничья"}</b></div>`).join("") : '<div class="tsm" style="text-align:center;padding:6px">Пока пусто</div>';
  }
  function rPre() {
    const r = PR.BTC, c = ((r.p - r.o) / r.o) * 100, lv = feedLive(), a = +$("bAmt").value || 0;
    $("pPx").textContent = "$" + fp(r.p); $("pCh").textContent = pc(c) + " · 24ч"; $("pCh").className = cls(c);
    const bd = $("pSt"); bd.className = "tbd" + (lv ? " on" : ""); bd.lastChild.textContent = lv ? "LIVE · Binance" : "симуляция";
    $("pWarn").style.display = lv ? "none" : "block"; $("pBal").textContent = "· доступно " + fm(T().cash);
    $("bU").textContent = $("bD").textContent = a ? "выигрыш +" + fm(a * (PAYOUT - 1)) : "×" + PAYOUT;
    const d = KL.BTC1m, pts = d && d.d.length ? d.d.map((q) => [q[0], q[4]]) : TK.BTC; chart($("pCv"), pts, { line: 1, N: 90, empty: "Загрузка графика…" });
    rBets();
  }

  /* ---------- прогноз по индикаторам ---------- */
  const emaA = (c, n) => { const k = 2 / (n + 1), r = [c[0]]; for (let i = 1; i < c.length; i++) r.push(c[i] * k + r[i - 1] * (1 - k)); return r; };
  function rsiA(c, n) { n = n || 14; const r = new Array(c.length).fill(50); let g = 0, l = 0; for (let i = 1; i <= n && i < c.length; i++) { const d = c[i] - c[i - 1]; d > 0 ? (g += d) : (l -= d); } g /= n; l /= n; for (let i = n; i < c.length; i++) { if (i > n) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; } r[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return r; }
  const sigAt = (e1, e2, rs, i) => cl(0.5 * cl(((e1[i] - e2[i]) / e2[i]) / 0.01, -1, 1) + 0.3 * cl((rs[i] - 50) / 25, -1, 1) + 0.4 * (rs[i] > 75 ? -0.6 : rs[i] < 25 ? 0.6 : 0), -1, 1);
  let sigT = 0, fng = null;
  async function rSig() {
    if (Date.now() - sigT < 120000) return; sigT = Date.now();
    let k; try { k = await bget("/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000"); } catch (e) { $("pSig").innerHTML = '<div class="tsm" style="text-align:center;padding:12px">Для прогноза нужны реальные свечи Binance. Сейчас нет связи, попробуй позже.</div>'; sigT = 0; return; }
    try { const f = await (await fetch("https://api.alternative.me/fng/?limit=1")).json(); fng = f.data[0]; } catch (e) {}
    const c = k.map((x) => +x[4]), n = c.length, e1 = emaA(c, 20), e2 = emaA(c, 50), rs = rsiA(c), s = sigAt(e1, e2, rs, n - 1), pUp = 50 + s * 18;
    let hit = 0, tot = 0, up = 0; for (let i = 60; i < n - 1; i++) { const q = sigAt(e1, e2, rs, i); if (Math.abs(q) < 0.05) continue; const real = Math.sign(c[i + 1] - c[i]); tot++; if (real === Math.sign(q)) hit++; if (real > 0) up++; }
    const lr = []; for (let i = n - 168; i < n; i++) lr.push(Math.log(c[i] / c[i - 1])); const mu = lr.reduce((a, b) => a + b, 0) / lr.length, sh = Math.sqrt(lr.reduce((a, b) => a + (b - mu) ** 2, 0) / lr.length), s24 = sh * Math.sqrt(24), p = c[n - 1];
    const verdict = s > 0.35 ? "Бычий перевес" : s > 0.1 ? "Слегка бычий" : s < -0.35 ? "Медвежий перевес" : s < -0.1 ? "Слегка медвежий" : "Нейтрально";
    const tr = (e1[n - 1] - e2[n - 1]) / e2[n - 1] * 100, ch24 = (c[n - 1] / c[n - 25] - 1) * 100;
    $("pSig").innerHTML = `<div class="tr"><div><div class="tsm">Сигнал на ближайшие часы</div><b style="font-size:22px">${verdict}</b></div><div style="text-align:right"><div class="tsm">шанс роста</div><b style="font-size:22px">${pUp.toFixed(0)}%</b></div></div>
<div class="tgauge"><i style="left:${cl(((pUp - 32) / 36) * 100, 0, 100)}%"></i></div><div class="tr tsm"><span>медведи</span><span>быки</span></div>
<canvas class="tcv" id="pCone" style="height:170px;margin-top:10px"></canvas>
<div class="tfc"><div><span>Тренд (EMA20 vs EMA50)</span><b class="${cls(tr)}">${tr >= 0 ? "вверх" : "вниз"} ${pc(tr)}</b></div><div><span>RSI (14, 1ч)</span><b>${rs[n - 1].toFixed(0)}${rs[n - 1] > 70 ? " · перегрев" : rs[n - 1] < 30 ? " · перепродан" : ""}</b></div><div><span>Изменение за 24ч</span><b class="${cls(ch24)}">${pc(ch24)}</b></div>
<div><span>Ожидаемый диапазон 24ч (68%)</span><b>$${fp(p * Math.exp(-s24))} – $${fp(p * Math.exp(s24))}</b></div><div><span>Диапазон 24ч (95%)</span><b>$${fp(p * Math.exp(-1.96 * s24))} – $${fp(p * Math.exp(1.96 * s24))}</b></div>${fng ? `<div><span>Индекс страха и жадности</span><b>${fng.value} · ${esc(fng.value_classification)}</b></div>` : ""}</div>
<div class="tw"><b>Проверка на истории:</b> по последним ${tot} часам сигнал угадал направление следующего часа в ${(hit / tot * 100).toFixed(0)}% случаев (рынок рос в ${(up / tot * 100).toFixed(0)}% часов). Это показывает честную правду: простые индикаторы дают лишь небольшой перевес, а не предсказание. Диапазон считается из реальной волатильности. Не является финансовой рекомендацией.</div>`;
    // конус прогноза
    const cv = $("pCone"); if (!cv) return; const past = c.slice(-48).map((v, i) => [i, v]); const H = 24, mu1 = s * sh * 0.15;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bands = []; for (let i = 0; i <= H; i++) { const sg = sh * Math.sqrt(i), m = p * Math.exp(mu1 * i); bands.push([m, p * Math.exp(mu1 * i - 1.96 * sg), p * Math.exp(mu1 * i + 1.96 * sg), p * Math.exp(mu1 * i - sg), p * Math.exp(mu1 * i + sg)]); }
    let mn = Math.min(...past.map((q) => q[1]), bands[H][1]), mx = Math.max(...past.map((q) => q[1]), bands[H][2]); const pd = (mx - mn) * 0.06; mn -= pd; mx += pd;
    const padR = 58, W = w - padR, tot2 = 48 + H, X = (i) => (i / tot2) * W, Y = (v) => 8 + (1 - (v - mn) / (mx - mn)) * (h - 16), pos = col("--pos"), neg = col("--neg"), mut = col("--m"), a = col("--a");
    x.font = "500 10px Inter,system-ui"; x.textBaseline = "middle"; x.fillStyle = mut;
    const band = (lo, hi, al) => { x.beginPath(); bands.forEach((b, i) => (i ? x.lineTo(X(47 + i), Y(b[hi])) : x.moveTo(X(47), Y(b[hi])))); for (let i = H; i >= 0; i--) x.lineTo(X(47 + i), Y(bands[i][lo])); x.closePath(); x.fillStyle = a + al; x.fill(); };
    band(1, 2, "22"); band(3, 4, "40");
    x.beginPath(); past.forEach((q, i) => (i ? x.lineTo(X(i), Y(q[1])) : x.moveTo(X(i), Y(q[1])))); x.strokeStyle = col("--t"); x.lineWidth = 2; x.stroke();
    x.beginPath(); bands.forEach((b, i) => (i ? x.lineTo(X(47 + i), Y(b[0])) : x.moveTo(X(47), Y(b[0])))); x.setLineDash([4, 4]); x.strokeStyle = a; x.lineWidth = 1.5; x.stroke(); x.setLineDash([]);
    x.fillStyle = pos; x.fillText("$" + fp(bands[H][2]), W + 4, Y(bands[H][2])); x.fillStyle = neg; x.fillText("$" + fp(bands[H][1]), W + 4, Y(bands[H][1])); x.fillStyle = mut; x.textAlign = "left"; x.fillText("+24ч", X(47 + H) - 22, h - 6);
  }

  /* ---------- общий рендер ---------- */
  let schedT = 0; function sched() { if (schedT) return; schedT = setTimeout(() => { schedT = 0; tickUI(); }, 500); }
  function tickUI() { rHead(); if (isOn("trd")) { rChips(); rQuote(); rTicket(); rPos(); } if (isOn("pre")) rPre(); }
  function renderAll() { rHead(); rChips(); rQuote(); rTicket(); rPos(); rHist(); rPre(); }
  function showT() { rChips(); pick(cur); rPos(); rHist(); }
  function showP() { loadK("BTC", "1m").then(rPre); rPre(); rSig(); }

  /* ---------- события ---------- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.closest("#tSeg")) setSeg(b.dataset.k);
    else if (b.closest("#tChips")) pick(b.dataset.s);
    else if (b.closest("#tTf") && b.dataset.f) { tf = b.dataset.f; document.querySelectorAll("#tTf [data-f]").forEach((x) => x.setAttribute("aria-pressed", x === b)); loadK(cur, tf).then(rQuote); }
    else if (b.id === "tMd") { mode = mode === "line" ? "candle" : "line"; b.textContent = mode === "line" ? "Свечи" : "Линия"; rQuote(); }
    else if (b.dataset.sd) { side = +b.dataset.sd; rTicket(); }
    else if (b.closest("#kPc")) { const t = T(); $("kAmt").value = Math.floor(Math.min(t.cash / (1 + lev * FEE), t.cash * +b.dataset.p) * 100) / 100 || ""; rTicket(); }
    else if (b.id === "kGo") openPos();
    else if (b.dataset.cl) { if (b.dataset.cl === "all") T().pos.slice().forEach((p) => closePos(p.id, PR[p.s].p, "ручн.")); else closePos(+b.dataset.cl, PR[T().pos.find((p) => p.id === +b.dataset.cl).s].p, "ручн."); }
    else if (b.closest("#pTf")) { btf = +b.dataset.t; document.querySelectorAll("#pTf button").forEach((x) => x.setAttribute("aria-pressed", x === b)); }
    else if (b.closest("#bPc")) { $("bAmt").value = Math.min(+b.dataset.p, Math.floor(T().cash)); rPre(); }
    else if (b.dataset.d && b.closest(".tb2")) placeBet(+b.dataset.d);
    else if (b.id === "fhS") { fhKey = $("fhK").value.trim(); try { localStorage.setItem("fhk", fhKey); } catch (x) {} toast(fhKey ? "Ключ сохранён" : "Ключ удалён"); fhPoll(); }
    else if (b.id === "tRst") { if (confirm("Сбросить демо-счёт, сделки и ставки?")) { st.trd = null; T(); sv(); renderAll(); toast("Счёт сброшен"); } }
  });
  $("kLev").oninput = () => { lev = +$("kLev").value; rTicket(); };
  ["kAmt", "bAmt"].forEach((i) => ($(i).oninput = () => (i === "kAmt" ? rTicket() : rPre())));

  /* ---------- навигация ---------- */
  const nb = sel('.nav [data-g="nft"]'); if (nb) { nb.dataset.g = "trd"; nb.innerHTML = "<i>↗</i>Рынки"; }
  const hp = sel('.w>.pills [data-g="home"]'); if (hp && !sel('.w>.pills [data-g="trd"]')) { const x = document.createElement("button"); x.dataset.g = "trd"; x.textContent = "Markets"; x.onclick = () => go("trd"); hp.after(x); }
  const _go = go; go = function (v) { _go(v); if (v === "trd") showT(); if (v === "pre") showP(); };

  /* ---------- старт ---------- */
  $("fhK").value = fhKey; setSeg("c"); renderAll();
  loadK("BTC", "1m"); connWS(); poll(); setInterval(poll, 5000); setInterval(simulate, 2000); setInterval(fhPoll, 2500);
  window.__trdDebug = { PR, T, upd, closePos, equity };
})();
