import React, { useEffect, useRef, useState } from "react";

/* RoboWare Control Tower
   Single-file React component. No dependencies beyond React.
   Drop it in as <ControlTower /> and add the Geist fonts if you want the exact look:
   https://fonts.google.com/specimen/Geist  (Geist + Geist Mono) */

const W = 696, H = 534;
const NAMES = ["Juniper", "Pepper", "Clover", "Otis", "Maple", "Basil", "Sage", "Fennel"];

// Aisle layout: shelves are obstacles, routes run through the aisles.
const SHELVES = [
  [84, 70, 140, 84], [268, 70, 140, 84], [452, 70, 140, 84],
  [84, 226, 140, 84], [268, 226, 140, 84], [452, 226, 140, 84],
  [84, 364, 140, 70], [268, 364, 140, 70],
];
// Base routes share one corridor (y=196, x 246..430) so traffic builds up there.
const ROUTES = [
  [[56, 40], [56, 196], [246, 196], [430, 196], [430, 330], [606, 330], [606, 486]],
  [[56, 500], [56, 196], [246, 196], [430, 196], [612, 196], [612, 486]],
  [[246, 40], [246, 196], [430, 196], [430, 486]],
  [[430, 40], [430, 196], [612, 196], [612, 330], [606, 486]],
];
// Alternate routes that avoid the hot corridor (what the "Reroute" suggestion applies).
const ALT = [
  [[56, 40], [56, 330], [430, 330], [606, 330], [606, 486]],
  [[56, 500], [56, 330], [246, 330], [246, 460], [612, 460], [612, 486]],
  [[246, 40], [246, 330], [430, 330], [430, 486]],
  [[430, 40], [430, 330], [606, 330], [606, 486]],
];

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function prep(route) {
  let acc = 0;
  const segs = route.slice(1).map((p, i) => {
    const l = dist(route[i], p);
    const s = { a: route[i], b: p, l, start: acc };
    acc += l;
    return s;
  });
  return { segs, len: acc };
}
const BASE = ROUTES.map(prep), ALTP = ALT.map(prep);
function at(pr, d) {
  const s = pr.segs.find((s) => d <= s.start + s.l) || pr.segs[pr.segs.length - 1];
  const t = clamp((d - s.start) / s.l, 0, 1);
  return [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
}

const mkOrder = (id) => ({ id, items: 1 + ((id * 7) % 9), aisle: 1 + (id % 6), rush: id % 5 === 0 });

function makeSim() {
  return {
    t: 0, surgeLeft: 0, reroute: false, acc: 0, nextId: 20432,
    queue: Array.from({ length: 14 }, (_, i) => mkOrder(20418 + i)),
    done: [], laps: [], cong: 0.08, feed: [],
    robots: NAMES.map((name, i) => ({
      id: i, name, code: "R-" + String(i * 3 + 3).padStart(2, "0"),
      ri: i % 4, d: (i * 61) % 300, speed: 62 + (i % 3) * 8,
      battery: 55 + ((i * 13) % 45), wait: false, by: null,
      charging: false, lapStart: 0, pos: [0, 0], lastWarn: -99,
    })),
  };
}

function log(sim, msg, color) {
  sim.feed.unshift({ t: sim.t, msg, color });
  sim.feed.length = Math.min(sim.feed.length, 30);
}

function step(sim, dt) {
  sim.t += dt;
  if (sim.surgeLeft > 0) {
    sim.surgeLeft -= dt;
    if (sim.surgeLeft <= 0) { sim.surgeLeft = 0; log(sim, "Surge ended. Demand is back to normal.", "#7B8490"); }
  }
  sim.acc += 0.35 * (sim.surgeLeft > 0 ? 3 : 1) * dt;
  while (sim.acc >= 1) { sim.acc -= 1; sim.queue.push(mkOrder(sim.nextId++)); }

  const routes = sim.reroute ? ALTP : BASE;
  for (const r of sim.robots) {
    r.d = Math.min(r.d, routes[r.ri].len);
    r.pos = at(routes[r.ri], r.d);
  }
  let waiting = 0;
  for (const r of sim.robots) {
    if (r.charging) {
      r.battery += 9 * dt;
      r.wait = false;
      if (r.battery >= 85) { r.charging = false; log(sim, `${r.name} finished charging and is heading back out.`, "#3DD68C"); }
      continue;
    }
    // Simple collision avoidance: lower id has right of way, so no deadlocks.
    const blocker = sim.robots.find((o) => o.id < r.id && !o.charging && dist(o.pos, r.pos) < 22);
    r.wait = !!blocker;
    r.by = blocker ? blocker.name : null;
    if (r.wait) {
      waiting++;
      if (sim.t - r.lastWarn > 10) { r.lastWarn = sim.t; log(sim, `${r.name} is waiting for ${blocker.name} to clear the corridor.`, "#FF6B6B"); }
    } else {
      r.d += r.speed * (sim.surgeLeft > 0 ? 1.2 : 1) * dt;
    }
    r.battery -= 0.35 * dt;
    if (r.d >= routes[r.ri].len) {
      r.d = 0;
      const o = sim.queue.shift();
      sim.done.push(sim.t);
      sim.laps.push(sim.t - r.lapStart);
      sim.laps = sim.laps.slice(-20);
      r.lapStart = sim.t;
      if (o && o.rush) log(sim, `Rush order #A-${o.id} delivered by ${r.name}.`, "#F5A524");
      if (r.battery < 24) { r.charging = true; log(sim, `${r.name} is heading to a charging bay.`, "#3DD68C"); }
    }
  }
  sim.cong += (waiting / sim.robots.length - sim.cong) * Math.min(1, dt * 2);
}

function draw(ctx, sim, selId, time) {
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = "#1A1F26"; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 28) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 28) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke(); }
  // Heat from congestion
  const heat = (x, y, r, rgb, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  if (!sim.reroute) heat(338, 196, 130, "245,165,36", 0.1 + sim.cong * 1.2);
  for (const r of sim.robots) if (r.wait) heat(r.pos[0], r.pos[1], 44, "255,107,107", 0.28);
  // Shelves
  ctx.fillStyle = "#1B2028"; ctx.strokeStyle = "#262C35";
  for (const [x, y, w, h] of SHELVES) { ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke(); }
  // Routes (dash offset animates the flow)
  ctx.setLineDash([5, 5]); ctx.lineDashOffset = -time * 16;
  ctx.strokeStyle = "rgba(245,165,36,.45)";
  for (const route of sim.reroute ? ALT : ROUTES) {
    ctx.beginPath(); route.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
  }
  ctx.setLineDash([]);
  // Charging bay and dock
  ctx.font = "11px 'Geist Mono', monospace";
  ctx.strokeStyle = "#3DD68C"; ctx.fillStyle = "#3DD68C";
  ctx.strokeRect(24, 470, 44, 30); ctx.strokeRect(76, 470, 44, 30);
  ctx.fillText("CHARGING BAY", 24, 518);
  ctx.strokeStyle = "rgba(245,165,36,.6)"; ctx.fillStyle = "#F5A524";
  ctx.strokeRect(540, 486, 132, 28);
  ctx.textAlign = "center"; ctx.fillText("OUTBOUND DOCK", 606, 504); ctx.textAlign = "left";
  // Robots
  for (const r of sim.robots) {
    const [x, y] = r.pos;
    const col = r.charging ? "#3DD68C" : r.wait ? "#FF6B6B" : "#F5A524";
    if (r.wait) {
      const p = (time * 0.8) % 1;
      ctx.strokeStyle = `rgba(255,107,107,${0.5 * (1 - p)})`;
      ctx.beginPath(); ctx.arc(x, y, 8 + p * 12, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
    if (r.id === selId) {
      ctx.strokeStyle = "#F5A524"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 15, 0, 7); ctx.stroke(); ctx.lineWidth = 1;
    }
    if (r.wait || r.id === selId) { ctx.fillStyle = col; ctx.fillText(r.name.toUpperCase(), x + 12, y + 22); }
  }
}

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function ControlTower() {
  const canvasRef = useRef(null);
  const simRef = useRef(makeSim());
  const ctl = useRef({ playing: true, speed: 1, sel: 0 });
  const searchRef = useRef(null);
  const [ui, setUi] = useState(() => {
    const sim = simRef.current;
    return {
      t: sim.t, queue: sim.queue.length, rising: false,
      orders: sim.queue.slice(0, 3), cong: sim.cong, surge: sim.surgeLeft,
      reroute: sim.reroute, tput: 0, lap: 0, feed: sim.feed.slice(0, 5),
      robots: sim.robots.map((robot) => ({ ...robot })),
    };
  });
  const [sel, setSel] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [dismissed, setDismissed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => { ctl.current = { playing, speed, sel }; }, [playing, speed, sel]);

  useEffect(() => {
    const cv = canvasRef.current, ctx = cv.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
    const sim = simRef.current;
    let raf, last = performance.now(), clock = 0, lastQueue = sim.queue.length;
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      clock += dt;
      const c = ctl.current;
      if (c.playing) for (let i = 0; i < c.speed; i++) step(sim, dt);
      draw(ctx, sim, c.sel, clock);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const snap = setInterval(() => {
      const recent = sim.done.filter((t) => sim.t - t < 60).length;
      const laps = sim.laps;
      setUi({
        t: sim.t, queue: sim.queue.length, rising: sim.queue.length > lastQueue,
        orders: sim.queue.slice(0, 3), cong: sim.cong, surge: sim.surgeLeft,
        reroute: sim.reroute, tput: Math.round(recent * (60 / Math.min(60, Math.max(sim.t, 10)))),
        lap: laps.length ? laps.reduce((a, b) => a + b, 0) / laps.length : 0,
        feed: sim.feed.slice(0, 5), robots: sim.robots.map((r) => ({ ...r })),
      });
      lastQueue = sim.queue.length;
    }, 150);
    const key = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(raf); clearInterval(snap); window.removeEventListener("keydown", key); };
  }, []);

  const pick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W, y = ((e.clientY - rect.top) / rect.height) * H;
    let best = null, bd = 22;
    for (const r of simRef.current.robots) { const d = dist(r.pos, [x, y]); if (d < bd) { bd = d; best = r.id; } }
    if (best !== null) setSel(best);
  };
  const toggleSurge = () => {
    const s = simRef.current;
    if (s.surgeLeft > 0) { s.surgeLeft = 0.01; return; }
    s.surgeLeft = 40; setDismissed(false); log(s, "Surge started. Demand is now 3× normal.", "#F5A524");
  };
  const setReroute = (v) => {
    const s = simRef.current; s.reroute = v;
    log(s, v ? "Reroute applied. Robots are using the lower corridor." : "Reroute undone. Robots are back on the default routes.", "#F5A524");
    if (!v) setDismissed(true);
  };

  const me = ui.robots[sel];
  const congPct = Math.round(ui.cong * 100);
  const status = (r) => (r.charging ? ["Charging", "#3DD68C"] : r.wait ? ["Waiting", "#FF6B6B"] : ["Moving", "#F5A524"]);
  const fleet = ui.robots.filter((r) => (r.name + r.code).toLowerCase().includes(query.toLowerCase()));
  const showTip = !ui.reroute && !dismissed && congPct >= 15;
  const cardX = clamp(me.pos[0] + 18, 8, W - 232), cardY = clamp(me.pos[1] - 40, 8, H - 170);

  return (
    <div className="ct">
      <style>{css}</style>
      <header className="bar">
        <div className="logo" /><b>RoboWare</b><span className="dim">Warehouse A · Afternoon shift</span>
        <label className="search">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#7B8490" strokeWidth="1.6"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search robots" aria-label="Search robots" />
          <kbd style={mono}>⌘K</kbd>
        </label>
        <div style={{ flex: 1 }} />
        {ui.surge > 0 && <div className="pill">Surge active · 3.0× · ends in <span style={mono}>{mmss(ui.surge)}</span></div>}
        <div className="live"><i />Live</div>
        <button className="btn" onClick={toggleSurge}>{ui.surge > 0 ? "End surge" : "Trigger surge"}</button>
      </header>

      <section className="kpis">
        <Kpi label="THROUGHPUT" value={ui.tput} unit="/min" note={ui.surge > 0 ? "surge" : "steady"} color={ui.surge > 0 ? "#F5A524" : "#3DD68C"} />
        <Kpi label="AVG DELIVERY" value={ui.lap ? ui.lap.toFixed(0) : "--"} unit="s" note="last 20 trips" color="#7B8490" />
        <Kpi label="ORDERS IN QUEUE" value={ui.queue} note={ui.rising ? "rising" : "falling"} color={ui.rising ? "#F5A524" : "#3DD68C"} />
        <Kpi label="CONGESTION" value={congPct} unit="%" note={congPct >= 15 ? "high" : "ok"} color={congPct >= 15 ? "#FF6B6B" : "#3DD68C"} last />
      </section>

      <main className="main">
        <aside className="left">
          <div className="h"><span>Live order queue</span><span className="dim" style={mono}>{ui.queue}</span></div>
          {ui.orders.map((o) => (
            <div className="row" key={o.id}>
              <div className="between"><span style={mono}>#A-{o.id}</span><span style={{ color: o.rush ? "#F5A524" : "#7B8490", fontSize: 11 }}>{o.rush ? "RUSH" : "STD"}</span></div>
              <div className="dim">{o.items} items · Aisle {o.aisle}</div>
            </div>
          ))}
          <div className="h" style={{ marginTop: 14 }}>What's happening</div>
          {ui.feed.map((f, i) => (
            <div className="feed" key={f.t + f.msg + i}>
              <i style={{ background: f.color }} /><span style={{ flex: 1 }}>{f.msg}</span><span className="dim" style={mono}>{mmss(f.t)}</span>
            </div>
          ))}
        </aside>

        <div className="map">
          <canvas ref={canvasRef} onClick={pick} style={{ width: W, height: H, cursor: "pointer", display: "block" }} />
          <div className="chips">
            <span>{ui.robots.length} robots</span>
            <span style={{ color: "#3DD68C" }}>{ui.robots.filter((r) => r.charging).length} charging</span>
            <span style={{ color: "#FF6B6B" }}>{ui.robots.filter((r) => r.wait).length} waiting</span>
          </div>
          <div className="card" style={{ left: cardX, top: cardY }}>
            <div className="between"><b>{me.name}</b><span className="dim" style={mono}>{me.code}</span></div>
            <div style={{ color: status(me)[1], margin: "2px 0 8px" }}>{status(me)[0]}{me.by ? ` · behind ${me.by}` : ""}</div>
            <div className="between dim"><span>Battery</span><span style={{ ...mono, color: "#E6E8EB" }}>{Math.round(me.battery)}%</span></div>
            <div className="bar3"><div style={{ width: clamp(me.battery, 0, 100) + "%", background: me.battery < 30 ? "#F5A524" : "#3DD68C" }} /></div>
          </div>
        </div>

        <aside className="right">
          {showTip && (
            <div className="tip">
              <div className="eyebrow">Suggestion</div>
              <b>Reroute robots around the hot corridor</b>
              <p>Congestion is at {congPct}%. Using the lower corridor should clear most of the waiting.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn sm" onClick={() => setReroute(true)}>Apply</button>
                <button className="ghost" onClick={() => setDismissed(true)}>Not now</button>
              </div>
            </div>
          )}
          {ui.reroute && (
            <div className="tip ok">
              <b>Reroute is on</b>
              <p>Robots are taking the lower corridor. Watch congestion drop.</p>
              <button className="ghost" onClick={() => setReroute(false)}>Undo</button>
            </div>
          )}
          <div className="h">Fleet health</div>
          <div className="fleet">
            {fleet.map((r) => (
              <button key={r.id} className={"fr" + (r.id === sel ? " on" : "")} onClick={() => setSel(r.id)}>
                <div className="between"><span>{r.name} <span className="dim" style={{ ...mono, fontSize: 11 }}>{r.code}</span></span><span style={{ color: status(r)[1] }}>{status(r)[0]}</span></div>
                <div className="bar3"><div style={{ width: clamp(r.battery, 0, 100) + "%", background: r.battery < 30 ? "#F5A524" : "#3DD68C" }} /></div>
              </button>
            ))}
            {!fleet.length && <div className="dim">No robots match "{query}".</div>}
          </div>
        </aside>
      </main>

      <footer className="foot">
        <button className="icon" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <svg width="14" height="14" viewBox="0 0 14 14" fill="#E6E8EB"><rect x="2" y="1" width="3.5" height="12" /><rect x="8.5" y="1" width="3.5" height="12" /></svg>
            : <svg width="14" height="14" viewBox="0 0 16 16" fill="#E6E8EB"><path d="M4 2l10 6-10 6z" /></svg>}
        </button>
        <div className="track"><div style={{ width: ((ui.t % 300) / 300) * 100 + "%" }} /></div>
        <button className="ghost" onClick={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1)}>{speed}×</button>
        <span className="dim" style={mono}>{mmss(ui.t)}</span>
      </footer>
    </div>
  );
}

function Kpi({ label, value, unit, note, color, last }) {
  return (
    <div className="kpi" style={last ? { borderRight: 0 } : null}>
      <div className="eyebrow">{label}</div>
      <div style={{ ...mono, fontSize: 26 }}>{value}{unit && <span className="dim" style={{ fontSize: 13 }}> {unit}</span>} <span style={{ fontSize: 12, color }}>{note}</span></div>
    </div>
  );
}

const css = `
.ct{--line:#232830;--soft:#1C2128;--dim:#7B8490;min-height:100vh;background:#0E1013;color:#E6E8EB;font:13px 'Geist',system-ui,sans-serif;display:flex;flex-direction:column}
.ct *{box-sizing:border-box}.ct button{font-family:inherit}
.dim{color:var(--dim)}.between{display:flex;justify-content:space-between;align-items:center}
.bar{height:56px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:14px;padding:0 20px}
.logo{width:20px;height:20px;border-radius:5px;background:#F5A524}
.search{margin-left:18px;width:280px;height:32px;border:1px solid var(--line);background:#14171B;border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 10px}
.search input{flex:1;background:none;border:0;outline:0;color:#E6E8EB;font:inherit}
.search:focus-within{border-color:#F5A52488}
kbd{font-size:11px;color:var(--dim);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
.pill{padding:6px 12px;border-radius:999px;background:rgba(245,165,36,.12);color:#F5A524;font-weight:500}
.live{display:flex;align-items:center;gap:6px;color:#3DD68C}.live i{width:7px;height:7px;border-radius:50%;background:#3DD68C;animation:bl 1.6s ease-in-out infinite}
@keyframes bl{50%{opacity:.3}}
.btn{background:#F5A524;color:#0E1013;border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer;transition:transform .15s}
.btn:active{transform:scale(.97)}.btn.sm{padding:7px 12px;border-radius:7px}
.ghost{background:none;color:#9AA3AF;border:1px solid var(--line);border-radius:7px;padding:7px 12px;cursor:pointer}
.ghost:hover{border-color:#3A424D;color:#E6E8EB}
.icon{background:none;border:0;cursor:pointer;padding:6px;display:flex}
.kpis{display:flex;border-bottom:1px solid var(--line)}
.kpi{flex:1;padding:14px 20px;border-right:1px solid var(--line)}
.eyebrow{font-size:11px;letter-spacing:.08em;color:var(--dim);margin-bottom:2px;text-transform:uppercase}
.main{flex:1;display:flex;min-height:0}
.left{width:288px;border-right:1px solid var(--line);padding:16px;overflow:hidden}
.right{width:296px;border-left:1px solid var(--line);padding:16px;overflow:auto}
.h{display:flex;justify-content:space-between;font-weight:600;margin-bottom:6px}
.row{padding:9px 0;border-top:1px solid var(--soft)}
.feed{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--soft);font-size:12px;line-height:1.4;animation:in .35s ease-out}
.feed i{width:6px;height:6px;border-radius:50%;margin-top:5px;flex:none}
@keyframes in{from{opacity:0;transform:translateY(-4px)}}
.map{flex:1;position:relative;overflow:auto;display:flex;justify-content:center}
.map>*{flex:none}.map{position:relative}
.chips{position:absolute;left:16px;top:14px;display:flex;gap:8px;font-size:12px}
.chips span{background:#14171B;border:1px solid var(--line);border-radius:6px;padding:5px 9px}
.card{position:absolute;width:216px;background:#14171B;border:1px solid rgba(245,165,36,.45);border-radius:10px;padding:12px 14px;box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:none;transition:left .15s linear,top .15s linear}
.bar3{height:3px;background:var(--soft);border-radius:2px;margin-top:7px}.bar3>div{height:3px;border-radius:2px;transition:width .3s}
.tip{background:rgba(245,165,36,.07);border:1px solid rgba(245,165,36,.3);border-radius:10px;padding:14px;margin-bottom:16px;animation:in .35s ease-out}
.tip.ok{background:rgba(61,214,140,.07);border-color:rgba(61,214,140,.3)}
.tip p{color:#9AA3AF;line-height:1.45;font-size:12px;margin:4px 0 12px}
.tip .eyebrow{color:#F5A524}
.fr{display:block;width:100%;text-align:left;background:none;border:0;border-top:1px solid var(--soft);color:inherit;padding:9px 6px;cursor:pointer;font-size:13px}
.fr:hover,.fr.on{background:#14171B}
.foot{height:52px;border-top:1px solid var(--line);display:flex;align-items:center;gap:14px;padding:0 20px}
.track{flex:1;height:4px;background:var(--soft);border-radius:2px}.track>div{height:4px;background:#E6E8EB;border-radius:2px}
.ct button:focus-visible,.ct input:focus-visible{outline:2px solid #F5A524;outline-offset:2px}
@media (prefers-reduced-motion:reduce){.live i,.feed,.tip{animation:none}}
`;
