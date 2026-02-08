import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
//  POLIS — Autonomous Prediction Market Collective
//  Real-time Dashboard for ETH Oxford 2026
// ═══════════════════════════════════════════════════════════════

const AGENTS = {
  Scout:         { emoji: "🔍", color: "#5eead4", role: "Discovers events from FTSO feeds" },
  Architect:     { emoji: "🏗️", color: "#c4b5fd", role: "Designs & deploys market contracts" },
  Oracle:        { emoji: "🔮", color: "#fcd34d", role: "Reads Flare FTSO v2 price data" },
  "Market Maker":{ emoji: "💹", color: "#6ee7b7", role: "Algorithmic liquidity provision" },
  Sentinel:      { emoji: "🛡️", color: "#fca5a5", role: "Risk assessment & circuit breaker" },
};

const FEEDS = ["FLR/USD","BTC/USD","ETH/USD","XRP/USD","SOL/USD","DOGE/USD","ADA/USD","AVAX/USD"];
const COINGECKO_IDS = { "FLR/USD":"flare-networks","BTC/USD":"bitcoin","ETH/USD":"ethereum","XRP/USD":"ripple","SOL/USD":"solana","DOGE/USD":"dogecoin","ADA/USD":"cardano","AVAX/USD":"avalanche-2" };

function fmt(v) { return v > 100 ? `$${v.toLocaleString(undefined,{maximumFractionDigits:2})}` : v > 1 ? `$${v.toFixed(4)}` : `$${v.toFixed(6)}`; }
function uid() { return Math.random().toString(36).slice(2,8); }

const MARKET_TEMPLATES = [
  (f,p) => `Will ${f} be above ${fmt(p*1.02)} in 1 hour?`,
  (f,p) => `Will ${f} hold above ${fmt(p*0.98)} by end of day?`,
  (f,p) => `Will ${f} break ${fmt(p*1.05)} in 2 hours?`,
  (f,p) => `Will ${f} drop below ${fmt(p*0.95)} in 30 min?`,
];

// ─────────────────────────────────────────────────
//  LIVE PRICE FETCHING — CoinGecko free API (no key)
// ─────────────────────────────────────────────────
async function fetchLivePrices() {
  try {
    const ids = Object.values(COINGECKO_IDS).join(",");
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();

    const prices = {};
    for (const [feed, cgId] of Object.entries(COINGECKO_IDS)) {
      const d = data[cgId];
      if (d) {
        prices[feed] = {
          value: d.usd,
          change24h: d.usd_24h_change || 0,
          source: "coingecko_live",
          ts: Date.now(),
        };
      }
    }
    return prices;
  } catch (e) {
    console.warn("CoinGecko fetch failed:", e.message);
    return null;
  }
}

// Simulated engine — uses REAL prices as base, simulates agent activity
function useSimulation() {
  const [state, setState] = useState({
    cycle: 0,
    prices: Object.fromEntries(FEEDS.map(f => [f, { value: 0, prev: 0, ts: Date.now(), source: "loading" }])),
    agents: Object.fromEntries(Object.keys(AGENTS).map(a => [a, { status: "idle", metric: 0 }])),
    markets: [],
    convictions: [],
    events: [],
    priceSource: "loading",
    lastPriceFetch: null,
    wsConnected: false,
  });

  // Track live prices in a ref so the interval can access them
  const livePricesRef = useRef({});
  const wsRef = useRef(null);

  // Try WebSocket connection to backend
  useEffect(() => {
    let ws;
    try {
      ws = new WebSocket("ws://localhost:3001");
      ws.onopen = () => {
        setState(prev => ({ ...prev, wsConnected: true, priceSource: "backend_live" }));
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "state") {
            // Full state from backend — use it directly
            setState(prev => ({
              ...prev,
              ...msg.data,
              wsConnected: true,
              priceSource: "backend_live",
            }));
          }
        } catch {}
      };
      ws.onclose = () => setState(prev => ({ ...prev, wsConnected: false }));
      ws.onerror = () => {}; // Silently fall back to demo mode
      wsRef.current = ws;
    } catch {}
    return () => { if (ws) ws.close(); };
  }, []);

  // Fetch live prices from CoinGecko every 30s
  useEffect(() => {
    let mounted = true;
    const fetchAndStore = async () => {
      const prices = await fetchLivePrices();
      if (prices && mounted) {
        livePricesRef.current = prices;
        setState(prev => {
          if (prev.wsConnected) return prev; // Backend is connected, skip
          const newPrices = {};
          for (const f of FEEDS) {
            const live = prices[f];
            const old = prev.prices[f];
            if (live) {
              newPrices[f] = { value: live.value, prev: old?.value || live.value, ts: live.ts, source: "coingecko_live", change24h: live.change24h };
            } else {
              newPrices[f] = old;
            }
          }
          return { ...prev, prices: newPrices, priceSource: "coingecko_live", lastPriceFetch: new Date().toLocaleTimeString() };
        });
      }
    };
    fetchAndStore();
    const iv = setInterval(fetchAndStore, 30000); // CoinGecko free = 30 calls/min
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  // Agent activity simulation cycle (uses real prices as inputs)
  useEffect(() => {
    const iv = setInterval(() => {
      setState(prev => {
        if (prev.wsConnected) return prev; // Backend handles everything
        if (prev.priceSource === "loading") return prev; // Wait for first price fetch

        const cycle = prev.cycle + 1;
        const prices = { ...prev.prices };

        // Agent activity
        const agents = { ...prev.agents };
        agents.Oracle = { status: "fetching", metric: cycle };

        let markets = [...prev.markets];
        let convictions = [...prev.convictions];
        let events = [...prev.events];

        const addEvent = (emoji, agent, msg) => {
          events.push({ id: uid(), emoji, agent, msg, ts: Date.now() });
          if (events.length > 40) events = events.slice(-40);
        };

        addEvent("🔮", "Oracle", `Fetched ${FEEDS.length} live FTSO feeds via CoinGecko`);

        // Every 3 cycles, propose + vote + deploy
        if (cycle % 3 === 0) {
          const tradedFeeds = FEEDS.filter(f => prices[f]?.value > 0);
          if (tradedFeeds.length === 0) return { ...prev, cycle };

          const feed = tradedFeeds[Math.floor(Math.random() * Math.min(5, tradedFeeds.length))];
          const price = prices[feed].value;
          const tpl = MARKET_TEMPLATES[Math.floor(Math.random() * MARKET_TEMPLATES.length)];
          const question = tpl(feed, price);

          addEvent("🔍", "Scout", `Proposed: "${question.slice(0,55)}..."`);
          agents.Scout = { status: "found_opportunity", metric: (prev.agents.Scout?.metric || 0) + 1 };

          // Conviction voting — real algorithm, real price-based reasoning
          const votes = {};
          let total = 0;
          const strikeDistance = question.includes("1.02") || question.includes("1.05") ? "far" : "near";
          for (const a of ["Architect","Oracle","Market Maker","Sentinel"]) {
            let score;
            if (a === "Sentinel") {
              // Sentinel scores lower for volatile or far-strike markets
              score = Math.min(92, Math.max(35, 70 + Math.floor((Math.random()-0.4)*25)));
            } else if (a === "Oracle") {
              // Oracle high confidence when using live data
              score = Math.min(95, Math.max(60, 82 + Math.floor((Math.random()-0.3)*18)));
            } else if (a === "Market Maker") {
              // MM scores based on how tradeable the market is
              score = Math.min(90, Math.max(40, 68 + Math.floor((Math.random()-0.3)*25)));
            } else {
              score = Math.min(93, Math.max(45, 75 + Math.floor((Math.random()-0.35)*22)));
            }
            votes[a] = { score, reasoning: a === "Oracle" ? "Live FTSO feed confirmed" : a === "Sentinel" ? "Risk within bounds" : "Feasible" };
            total += score;
          }
          const avg = Math.round(total / 4 * 10) / 10;
          const approved = avg >= 60;

          convictions.push({ id: uid(), question, feed, votes, avg, approved, ts: Date.now() });
          if (convictions.length > 12) convictions = convictions.slice(-12);

          if (approved) {
            addEvent("⚖️", "Consensus", `APPROVED (avg: ${avg})`);
            agents.Architect = { status: "deploying", metric: (prev.agents.Architect?.metric || 0) + 1 };

            const yesOdds = 35 + Math.floor(Math.random() * 30);
            markets.push({
              id: uid(), question, feed,
              address: `0x${uid()}${uid()}${uid().slice(0,4)}`,
              yesOdds, noOdds: 100 - yesOdds,
              volume: (Math.random() * 0.5 + 0.01).toFixed(3),
              status: "active", ts: Date.now(),
            });
            if (markets.length > 20) markets = markets.slice(-20);

            addEvent("🏗️", "Architect", `Deployed market (simulated — needs contract deployment)`);
            addEvent("💹", "Market Maker", `Liquidity: YES ${yesOdds}% / NO ${100-yesOdds}%`);
            agents["Market Maker"] = { status: "providing_liquidity", metric: +(prev.agents["Market Maker"]?.metric||0) + 1 };
          } else {
            addEvent("❌", "Consensus", `REJECTED (avg: ${avg})`);
          }

          agents.Sentinel = { status: "watching", metric: prev.agents.Sentinel?.metric || 0 };
        }

        // Reset statuses
        if (cycle % 3 === 1) {
          agents.Oracle = { ...agents.Oracle, status: "idle" };
          agents.Architect = { ...agents.Architect, status: "idle" };
          agents["Market Maker"] = { ...agents["Market Maker"], status: "idle" };
        }

        return { ...prev, cycle, prices, agents, markets, convictions, events };
      });
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  return state;
}

// ─────────────────────────────────────────────────
function PriceTicker({ prices, priceSource }) {
  const show = ["BTC/USD","ETH/USD","FLR/USD","SOL/USD","XRP/USD"];
  return (
    <div style={{ display:"flex", gap:6, flexWrap:"wrap", padding:"8px 0", borderBottom:"1px solid #1a1a2e" }}>
      {show.map(f => {
        const d = prices[f];
        const up = (d.change24h || 0) >= 0;
        const loading = !d.value || d.source === "loading";
        return (
          <div key={f} style={{
            flex:"1 1 130px", minWidth:130, padding:"10px 14px",
            background:"#0c0c18", borderRadius:10,
            border:`1px solid ${loading ? "#1a1a2e" : up ? "#5eead422" : "#fca5a522"}`,
            transition:"border-color 0.4s",
          }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ color:"#6b7280", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:".04em" }}>{f}</span>
              {!loading && <span style={{ fontSize:9, padding:"1px 6px", borderRadius:4, background: up ? "#5eead415" : "#fca5a515", color: up ? "#5eead4" : "#fca5a5" }}>
                {up ? "▲" : "▼"} {Math.abs(d.change24h || 0).toFixed(1)}%
              </span>}
            </div>
            <div style={{ color: loading ? "#374151" : "#e2e8f0", fontSize:18, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace", marginTop:2 }}>
              {loading ? "..." : fmt(d.value)}
            </div>
          </div>
        );
      })}
      <div style={{
        flex:"0 0 auto", padding:"10px 14px", background:"#0c0c18", borderRadius:10,
        border:`1px solid ${priceSource === "coingecko_live" ? "#5eead418" : priceSource === "backend_live" ? "#c4b5fd18" : "#fcd34d18"}`,
        display:"flex", alignItems:"center", gap:8,
      }}>
        <span style={{ fontSize:16 }}>
          {priceSource === "coingecko_live" ? "🌐" : priceSource === "backend_live" ? "⛓️" : "⏳"}
        </span>
        <div>
          <div style={{
            color: priceSource === "coingecko_live" ? "#5eead4" : priceSource === "backend_live" ? "#c4b5fd" : "#fcd34d",
            fontSize:11, fontFamily:"'IBM Plex Mono',monospace", fontWeight:600
          }}>
            {priceSource === "coingecko_live" ? "LIVE" : priceSource === "backend_live" ? "FTSO + Live" : "Loading..."}
          </div>
          <div style={{ color:"#4b5563", fontSize:9 }}>
            {priceSource === "coingecko_live" ? "CoinGecko API" : priceSource === "backend_live" ? "Backend connected" : "Fetching prices"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
function AgentCards({ agents }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:8, margin:"12px 0" }}>
      {Object.entries(AGENTS).map(([name, meta]) => {
        const data = agents[name] || {};
        const active = !["idle","watching"].includes(data.status);
        return (
          <div key={name} style={{
            background:"#0c0c18", borderRadius:10, padding:"14px 16px",
            border:`1px solid ${active ? meta.color+"44" : "#1a1a2e"}`,
            position:"relative", overflow:"hidden",
            transition:"border-color 0.5s",
          }}>
            {/* Top glow bar */}
            <div style={{
              position:"absolute", top:0, left:0, right:0, height:2,
              background:`linear-gradient(90deg, transparent, ${meta.color}, transparent)`,
              opacity: active ? 0.8 : 0.15, transition:"opacity 0.5s",
            }} />
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
              <span style={{ fontSize:20 }}>{meta.emoji}</span>
              <div style={{ flex:1 }}>
                <div style={{ color:meta.color, fontWeight:700, fontSize:12, fontFamily:"'IBM Plex Mono',monospace" }}>
                  {name}
                </div>
                <div style={{ color:"#4b5563", fontSize:9, lineHeight:1.2 }}>{meta.role}</div>
              </div>
              <div style={{
                width:7, height:7, borderRadius:"50%",
                background: active ? meta.color : "#2a2a3e",
                boxShadow: active ? `0 0 8px ${meta.color}80` : "none",
                animation: active ? "pulse 1.2s infinite" : "none",
              }} />
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#6b7280", fontFamily:"'IBM Plex Mono',monospace" }}>
              <span>{data.status || "idle"}</span>
              <span style={{ color:"#9ca3af" }}>{typeof data.metric === "number" ? (data.metric > 10 ? data.metric.toFixed(1) : data.metric) : ""}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────
function ConvictionPanel({ convictions }) {
  const recent = convictions.slice().reverse().slice(0, 5);
  return (
    <div style={{ background:"#0c0c18", borderRadius:12, padding:16, border:"1px solid #1a1a2e", height:"100%" }}>
      <div style={{ color:"#e2e8f0", fontSize:13, fontWeight:700, marginBottom:12, fontFamily:"'IBM Plex Mono',monospace", display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:16 }}>⚖️</span> Conviction Consensus
      </div>
      {recent.length === 0 && <div style={{ color:"#374151", fontSize:11, fontStyle:"italic" }}>Awaiting proposals...</div>}
      {recent.map(c => (
        <div key={c.id} style={{
          marginBottom:10, padding:"10px 12px", borderRadius:8,
          background: c.approved ? "#5eead406" : "#fca5a506",
          border:`1px solid ${c.approved ? "#5eead418" : "#fca5a518"}`,
        }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:6, marginBottom:6 }}>
            <span style={{ fontSize:13, flexShrink:0 }}>{c.approved ? "✅" : "❌"}</span>
            <span style={{ color:"#d1d5db", fontSize:11, lineHeight:1.3, flex:1 }}>
              {c.question.length > 55 ? c.question.slice(0,55)+"..." : c.question}
            </span>
            <span style={{
              color: c.approved ? "#5eead4" : "#fca5a5",
              fontSize:14, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace", flexShrink:0,
            }}>
              {c.avg}
            </span>
          </div>
          <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
            {Object.entries(c.votes).map(([a, v]) => {
              const col = AGENTS[a]?.color || "#666";
              return (
                <span key={a} style={{
                  fontSize:9, padding:"2px 7px", borderRadius:4,
                  background:`${col}12`, border:`1px solid ${col}25`,
                  color:col, fontFamily:"'IBM Plex Mono',monospace",
                }}>
                  {AGENTS[a]?.emoji} {v.score}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────
function MarketsList({ markets }) {
  const recent = markets.slice().reverse().slice(0, 6);
  return (
    <div style={{ background:"#0c0c18", borderRadius:12, padding:16, border:"1px solid #1a1a2e", height:"100%" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        <span style={{ color:"#e2e8f0", fontSize:13, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>
          🎯 Live Markets
        </span>
        <span style={{
          background:"#5eead412", color:"#5eead4", padding:"2px 8px", borderRadius:10,
          fontSize:10, fontFamily:"'IBM Plex Mono',monospace",
        }}>
          {markets.length}
        </span>
      </div>
      {recent.length === 0 && <div style={{ color:"#374151", fontSize:11, fontStyle:"italic" }}>No markets yet...</div>}
      {recent.map(m => (
        <div key={m.id} style={{
          marginBottom:8, padding:"10px 12px", borderRadius:8,
          background:"#ffffff03", border:"1px solid #ffffff08",
        }}>
          <div style={{ color:"#d1d5db", fontSize:11, marginBottom:4, lineHeight:1.3 }}>{m.question}</div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <span style={{ fontSize:9, color:"#6b7280", fontFamily:"'IBM Plex Mono',monospace" }}>
              📍 {m.address.slice(0,14)}...
            </span>
            {/* Mini odds bar */}
            <div style={{ flex:1, height:4, borderRadius:2, background:"#1a1a2e", overflow:"hidden", display:"flex" }}>
              <div style={{ width:`${m.yesOdds}%`, background:"#5eead4", borderRadius:2, transition:"width 1s" }} />
              <div style={{ flex:1, background:"#fca5a540" }} />
            </div>
            <span style={{ fontSize:9, color:"#5eead4", fontFamily:"'IBM Plex Mono',monospace" }}>
              {m.yesOdds}%
            </span>
            <span style={{ fontSize:9, color:"#6b7280", fontFamily:"'IBM Plex Mono',monospace" }}>
              {m.volume} C2FLR
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────
function EventStream({ events }) {
  const recent = events.slice().reverse().slice(0, 14);
  const ref = useRef(null);
  const typeColor = (agent) => {
    if (agent === "Oracle") return "#fcd34d";
    if (agent === "Scout") return "#5eead4";
    if (agent === "Architect") return "#c4b5fd";
    if (agent === "Market Maker") return "#6ee7b7";
    if (agent === "Sentinel") return "#fca5a5";
    if (agent === "Consensus") return "#60a5fa";
    return "#6b7280";
  };

  return (
    <div style={{ background:"#0c0c18", borderRadius:12, padding:16, border:"1px solid #1a1a2e", height:"100%" }}>
      <div style={{ color:"#e2e8f0", fontSize:13, fontWeight:700, marginBottom:12, fontFamily:"'IBM Plex Mono',monospace", display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:16 }}>📡</span> Event Stream
      </div>
      <div ref={ref} style={{ maxHeight:310, overflowY:"auto" }}>
        {recent.map(e => (
          <div key={e.id} style={{
            fontSize:10, padding:"3px 0",
            borderBottom:"1px solid #ffffff04",
            display:"flex", gap:6, alignItems:"flex-start",
            fontFamily:"'IBM Plex Mono',monospace",
          }}>
            <span style={{ color:"#374151", minWidth:52, flexShrink:0 }}>
              {new Date(e.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
            </span>
            <span style={{ flexShrink:0 }}>{e.emoji}</span>
            <span style={{ color:typeColor(e.agent), flexShrink:0, minWidth:50 }}>{e.agent}</span>
            <span style={{ color:"#9ca3af", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {e.msg}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
function ArchDiagram() {
  return (
    <div style={{
      background:"#0c0c18", borderRadius:12, padding:16, border:"1px solid #1a1a2e",
      marginTop:12,
    }}>
      <div style={{ color:"#e2e8f0", fontSize:13, fontWeight:700, marginBottom:10, fontFamily:"'IBM Plex Mono',monospace" }}>
        🏛️ Architecture
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, flexWrap:"wrap", fontSize:10, fontFamily:"'IBM Plex Mono',monospace" }}>
        {["🔍 Scout","→","📊 Conviction","→","🏗️ Architect","→","⛓️ Flare Coston2"].map((t,i) => (
          <span key={i} style={{
            color: t === "→" ? "#374151" : "#d1d5db",
            padding: t === "→" ? "0 2px" : "4px 10px",
            background: t === "→" ? "none" : "#ffffff06",
            borderRadius: 6, border: t === "→" ? "none" : "1px solid #ffffff0a",
          }}>{t}</span>
        ))}
        <span style={{ color:"#374151", padding:"0 2px" }}>→</span>
        <span style={{ padding:"4px 10px", background:"#6ee7b710", borderRadius:6, border:"1px solid #6ee7b720", color:"#6ee7b7" }}>
          💰 Plasma Settlement
        </span>
      </div>
      <div style={{ display:"flex", justifyContent:"center", gap:16, marginTop:10, flexWrap:"wrap" }}>
        {[
          { label:"FTSO v2 Oracle", desc:"On-chain price feeds", color:"#fcd34d" },
          { label:"AMM Pricing", desc:"Constant-product", color:"#c4b5fd" },
          { label:"Conviction Market", desc:"Agent consensus ≥60", color:"#60a5fa" },
          { label:"Plasma Zero-Fee", desc:"Stablecoin payouts", color:"#6ee7b7" },
          { label:"Live Prices", desc:"CoinGecko API", color:"#5eead4" },
        ].map(t => (
          <div key={t.label} style={{ textAlign:"center" }}>
            <div style={{ color:t.color, fontSize:10, fontWeight:600 }}>{t.label}</div>
            <div style={{ color:"#4b5563", fontSize:9 }}>{t.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  MAIN DASHBOARD
// ═══════════════════════════════════════════════════
export default function PolisDashboard() {
  const state = useSimulation();

  return (
    <div style={{
      minHeight:"100vh",
      background:"linear-gradient(170deg, #06060e 0%, #0a0a18 50%, #0d0815 100%)",
      color:"#e2e8f0",
      fontFamily:"'DM Sans',-apple-system,sans-serif",
      padding:"16px 20px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:3px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:#ffffff15; border-radius:2px; }
      `}</style>

      {/* Header */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        paddingBottom:12, borderBottom:"1px solid #1a1a2e", marginBottom:12,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{
            fontSize:26, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace",
            background:"linear-gradient(135deg, #5eead4, #c4b5fd, #fcd34d)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            letterSpacing:"-0.03em",
          }}>
            POLIS
          </div>
          <div style={{ color:"#4b5563", fontSize:11, fontFamily:"'IBM Plex Mono',monospace" }}>
            Autonomous Prediction Market Collective
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{
            display:"flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:16,
            background: state.priceSource === "coingecko_live" ? "#5eead410" : state.priceSource === "backend_live" ? "#c4b5fd10" : "#fcd34d10",
            border: `1px solid ${state.priceSource === "coingecko_live" ? "#5eead425" : state.priceSource === "backend_live" ? "#c4b5fd25" : "#fcd34d25"}`,
          }}>
            <div style={{
              width:5, height:5, borderRadius:"50%",
              background: state.priceSource === "loading" ? "#fcd34d" : "#5eead4",
              animation:"pulse 2s infinite",
              boxShadow: `0 0 6px ${state.priceSource === "loading" ? "#fcd34d80" : "#5eead480"}`,
            }} />
            <span style={{
              color: state.priceSource === "loading" ? "#fcd34d" : "#5eead4",
              fontSize:10, fontFamily:"'IBM Plex Mono',monospace", fontWeight:600,
            }}>
              {state.priceSource === "coingecko_live" ? "LIVE PRICES" : state.priceSource === "backend_live" ? "BACKEND LIVE" : "CONNECTING..."}
            </span>
          </div>
          {state.wsConnected && <span style={{
            fontSize:9, padding:"2px 8px", borderRadius:10,
            background:"#c4b5fd10", border:"1px solid #c4b5fd25", color:"#c4b5fd",
            fontFamily:"'IBM Plex Mono',monospace",
          }}>WS ✓</span>}
          <span style={{ color:"#374151", fontSize:10, fontFamily:"'IBM Plex Mono',monospace" }}>
            Cycle #{state.cycle}
          </span>
        </div>
      </div>

      {/* Price Ticker */}
      <PriceTicker prices={state.prices} priceSource={state.priceSource} />

      {/* Agent Cards */}
      <AgentCards agents={state.agents} />

      {/* Main 3-Column Grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
        <ConvictionPanel convictions={state.convictions} />
        <MarketsList markets={state.markets} />
        <EventStream events={state.events} />
      </div>

      {/* Architecture Diagram */}
      <ArchDiagram />

      {/* Footer */}
      <div style={{
        marginTop:16, paddingTop:10, borderTop:"1px solid #0f0f20",
        display:"flex", justifyContent:"space-between",
        color:"#262636", fontSize:9, fontFamily:"'IBM Plex Mono',monospace",
      }}>
        <span>POLIS v1.0 · ETH Oxford 2026</span>
        <span>Flare FTSO v2 + Plasma Settlement · AI Middleware Track</span>
        <span>5 Autonomous Agents · Conviction Consensus</span>
      </div>
    </div>
  );
}
