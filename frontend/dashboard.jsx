import { useState, useEffect, useRef, useCallback } from "react";

const WS_URL = "ws://localhost:3001";

// ═══════════════════════════════════════════════════════════════
//  POLIS DASHBOARD — Real-time AI Agent Prediction Market Collective
// ═══════════════════════════════════════════════════════════════

const AGENT_META = {
  Scout:       { emoji: "🔍", color: "#60a5fa", role: "Discovers events & proposes markets" },
  Architect:   { emoji: "🏗️", color: "#a78bfa", role: "Designs parameters & deploys contracts" },
  Oracle:      { emoji: "🔮", color: "#fbbf24", role: "Reads Flare FTSO price feeds" },
  "Market Maker": { emoji: "💹", color: "#34d399", role: "Provides algorithmic liquidity" },
  Sentinel:    { emoji: "🛡️", color: "#f87171", role: "Risk assessment & guardrails" },
};

function formatPrice(price, decimals) {
  if (!price) return "$0.00";
  const val = price / Math.pow(10, decimals || 2);
  if (val > 100) return `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (val > 1) return `$${val.toFixed(4)}`;
  return `$${val.toFixed(6)}`;
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

// ─────────────────────────────────────────────────────────────
//  AGENT CARD
// ─────────────────────────────────────────────────────────────
function AgentCard({ name, data, meta }) {
  const pulseColor = data?.status === "scanning" || data?.status === "fetching" 
    ? meta.color : "rgba(255,255,255,0.1)";

  return (
    <div style={{
      background: "rgba(15,15,25,0.85)",
      border: `1px solid ${meta.color}33`,
      borderRadius: 12,
      padding: "16px 18px",
      position: "relative",
      overflow: "hidden",
      backdropFilter: "blur(20px)",
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${meta.color}, transparent)`,
        opacity: data?.status === "idle" || data?.status === "watching" ? 0.3 : 1,
        transition: "opacity 0.5s",
      }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 22 }}>{meta.emoji}</span>
        <div>
          <div style={{ color: meta.color, fontWeight: 700, fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>
            {name}
          </div>
          <div style={{ color: "#666", fontSize: 11 }}>{meta.role}</div>
        </div>
        <div style={{
          marginLeft: "auto", width: 8, height: 8, borderRadius: "50%",
          background: pulseColor,
          boxShadow: `0 0 8px ${pulseColor}`,
          animation: data?.status !== "idle" && data?.status !== "watching" ? "pulse 1s infinite" : "none",
        }} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {Object.entries(data || {}).map(([k, v]) => (
          <div key={k} style={{ fontSize: 11, color: "#888" }}>
            <span style={{ color: "#555" }}>{k}: </span>
            <span style={{ color: "#ccc" }}>{typeof v === "number" ? v.toLocaleString() : String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  PRICE TICKER
// ─────────────────────────────────────────────────────────────
function PriceTicker({ prices }) {
  const entries = Object.entries(prices || {}).filter(([, d]) => 
    ["BTC/USD", "ETH/USD", "FLR/USD", "XRP/USD", "SOL/USD"].includes(d.feedName)
  );

  return (
    <div style={{
      display: "flex", gap: 8, flexWrap: "wrap", padding: "10px 0",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      marginBottom: 16,
    }}>
      {entries.map(([id, d]) => (
        <div key={id} style={{
          background: "rgba(255,255,255,0.03)",
          borderRadius: 8, padding: "8px 14px",
          border: "1px solid rgba(255,255,255,0.06)",
          flex: "1 1 120px", minWidth: 120,
        }}>
          <div style={{ color: "#888", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
            {d.feedName} <span style={{ color: "#444", fontSize: 9 }}>FTSO</span>
          </div>
          <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
            {formatPrice(d.price, d.decimals)}
          </div>
        </div>
      ))}
      <div style={{
        background: "rgba(251,191,36,0.06)",
        borderRadius: 8, padding: "8px 14px",
        border: "1px solid rgba(251,191,36,0.15)",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{ fontSize: 12 }}>🔮</span>
        <span style={{ color: "#fbbf24", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
          Flare FTSO v2
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  CONVICTION VOTE VISUALIZATION
// ─────────────────────────────────────────────────────────────
function ConvictionPanel({ history }) {
  const recent = (history || []).slice(-6).reverse();

  return (
    <div style={{
      background: "rgba(15,15,25,0.85)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 12, padding: 18,
      backdropFilter: "blur(20px)",
    }}>
      <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700, marginBottom: 14, fontFamily: "'JetBrains Mono', monospace" }}>
        ⚖️ Conviction Consensus
      </div>
      {recent.length === 0 && (
        <div style={{ color: "#444", fontSize: 12, fontStyle: "italic" }}>Waiting for proposals...</div>
      )}
      {recent.map((item, i) => {
        const approved = item.consensus?.approved;
        const avg = item.consensus?.avgScore || 0;
        const votes = item.consensus?.votes || {};

        return (
          <div key={i} style={{
            marginBottom: 12, padding: 12,
            background: approved ? "rgba(52,211,153,0.05)" : "rgba(248,113,113,0.05)",
            border: `1px solid ${approved ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)"}`,
            borderRadius: 8,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>{approved ? "✅" : "❌"}</span>
              <span style={{ color: "#ccc", fontSize: 12, flex: 1 }}>
                {item.data?.question?.slice(0, 55)}{item.data?.question?.length > 55 ? "..." : ""}
              </span>
              <span style={{
                color: approved ? "#34d399" : "#f87171",
                fontSize: 13, fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {avg}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(votes).map(([agent, v]) => {
                const agentColor = AGENT_META[agent]?.color || "#666";
                return (
                  <div key={agent} style={{
                    fontSize: 10, padding: "2px 8px", borderRadius: 4,
                    background: `${agentColor}15`, border: `1px solid ${agentColor}30`,
                    color: agentColor, fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {AGENT_META[agent]?.emoji || "🤖"} {v.score}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  DEPLOYED MARKETS LIST
// ─────────────────────────────────────────────────────────────
function MarketsList({ markets }) {
  const recent = (markets || []).slice(-8).reverse();

  return (
    <div style={{
      background: "rgba(15,15,25,0.85)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 12, padding: 18,
      backdropFilter: "blur(20px)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 14,
      }}>
        <span style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
          🎯 Live Markets
        </span>
        <span style={{
          background: "rgba(96,165,250,0.15)", color: "#60a5fa",
          padding: "2px 8px", borderRadius: 10, fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {markets?.length || 0}
        </span>
      </div>
      {recent.length === 0 && (
        <div style={{ color: "#444", fontSize: 12, fontStyle: "italic" }}>No markets deployed yet...</div>
      )}
      {recent.map((m, i) => (
        <div key={i} style={{
          marginBottom: 8, padding: "10px 12px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.04)",
          borderRadius: 8,
        }}>
          <div style={{ color: "#ccc", fontSize: 12, marginBottom: 4 }}>
            {m.question}
          </div>
          <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono', monospace" }}>
            <span>📍 {m.marketAddress?.slice(0, 14)}...</span>
            <span>{m.onChain ? "⛓️ On-chain" : "🔄 Simulated"}</span>
            <span>Feed: {m.feedId?.slice(0, 10)}...</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  EVENT LOG
// ─────────────────────────────────────────────────────────────
function EventLog({ events }) {
  const recent = (events || []).slice(-15).reverse();
  const scrollRef = useRef(null);

  const getEventColor = (type) => {
    if (type?.includes("price")) return "#fbbf24";
    if (type?.includes("market")) return "#a78bfa";
    if (type?.includes("conviction")) return "#60a5fa";
    if (type?.includes("risk")) return "#f87171";
    if (type?.includes("liquidity")) return "#34d399";
    return "#666";
  };

  return (
    <div style={{
      background: "rgba(15,15,25,0.85)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 12, padding: 18,
      backdropFilter: "blur(20px)",
      maxHeight: 350, overflow: "hidden",
    }}>
      <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700, marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>
        📡 Event Stream
      </div>
      <div ref={scrollRef} style={{ maxHeight: 290, overflowY: "auto" }}>
        {recent.map((evt, i) => (
          <div key={evt.id || i} style={{
            fontSize: 11, padding: "4px 0",
            borderBottom: "1px solid rgba(255,255,255,0.02)",
            color: "#888", fontFamily: "'JetBrains Mono', monospace",
            display: "flex", gap: 8,
          }}>
            <span style={{ color: "#444", minWidth: 50 }}>
              {new Date(evt.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span style={{ color: getEventColor(evt.type), minWidth: 20, textAlign: "center" }}>
              {evt.data?.emoji || "•"}
            </span>
            <span style={{ color: "#777" }}>
              {evt.type?.split(":").pop()}
            </span>
            <span style={{ color: "#999", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {evt.data?.message || evt.data?.question?.slice(0, 40) || evt.data?.detail || ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────
export default function PolisDashboard() {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        console.log("[POLIS] Connected to agent swarm");
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === "state") {
            setState(data.data);
          } else {
            setEvents((prev) => [...prev.slice(-100), data]);
            // Update state from individual events
            if (data.data?.prices) {
              setState((s) => s ? { ...s, prices: data.data.prices } : s);
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    } catch {
      reconnectRef.current = setTimeout(connect, 3000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  // Demo mode: generate fake state for standalone viewing
  const demoState = state || {
    cycleCount: 0, deployedMarkets: [], prices: {},
    pendingProposals: [], convictionHistory: [],
    agents: {
      scout: { status: "waiting", scanCount: 0 },
      architect: { status: "waiting", deployedCount: 0 },
      oracle: { status: "waiting", updateCount: 0 },
      marketmaker: { status: "waiting", totalLiquidity: 0 },
      sentinel: { status: "waiting", alertCount: 0 },
    },
    recentEvents: [],
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #05050f 0%, #0a0a1a 40%, #0f0a1a 100%)",
      color: "#e2e8f0",
      fontFamily: "'DM Sans', -apple-system, sans-serif",
      padding: "20px 24px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 20, paddingBottom: 16,
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            fontSize: 28, fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            background: "linear-gradient(135deg, #60a5fa, #a78bfa, #fbbf24)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            letterSpacing: "-0.02em",
          }}>
            POLIS
          </div>
          <div style={{ color: "#555", fontSize: 12 }}>
            Autonomous Prediction Market Collective
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 12px", borderRadius: 20,
            background: connected ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
            border: `1px solid ${connected ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: connected ? "#34d399" : "#f87171",
              animation: connected ? "pulse 2s infinite" : "none",
            }} />
            <span style={{
              color: connected ? "#34d399" : "#f87171",
              fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            }}>
              {connected ? "LIVE" : "CONNECTING..."}
            </span>
          </div>
          <div style={{
            color: "#444", fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
          }}>
            Cycle #{demoState.cycleCount}
          </div>
        </div>
      </div>

      {/* Price Ticker */}
      <PriceTicker prices={demoState.prices} />

      {/* Agent Cards */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 10, marginBottom: 20,
      }}>
        {Object.entries(AGENT_META).map(([name, meta]) => {
          const key = name.toLowerCase().replace(/ /g, "");
          const data = demoState.agents?.[key] || demoState.agents?.[name.toLowerCase()] || {};
          return <AgentCard key={name} name={name} data={data} meta={meta} />;
        })}
      </div>

      {/* Main Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 16,
      }}>
        <ConvictionPanel history={demoState.convictionHistory} />
        <MarketsList markets={demoState.deployedMarkets} />
        <EventLog events={events.length > 0 ? events : demoState.recentEvents} />
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 24, padding: "12px 0",
        borderTop: "1px solid rgba(255,255,255,0.03)",
        display: "flex", justifyContent: "space-between",
        color: "#333", fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
      }}>
        <span>POLIS v1.0 | ETH Oxford 2026</span>
        <span>Flare FTSO + Plasma Settlement | AI Middleware Track</span>
        <span>Built with Claude × Human</span>
      </div>
    </div>
  );
}
