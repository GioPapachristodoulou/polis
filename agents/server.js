import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import bus from "./eventbus.js";
import Orchestrator from "./orchestrator.js";

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server });

const orchestrator = new Orchestrator();

// WebSocket: stream all events to dashboard
wss.on("connection", (ws) => {
  console.log("[WS] Dashboard connected");

  // Send current state immediately
  ws.send(JSON.stringify({ type: "state", data: orchestrator.getState() }));

  // Stream all events
  const handler = (event) => {
    try {
      ws.send(JSON.stringify(event));
    } catch {}
  };
  bus.on("*", handler);

  // Periodic state sync
  const interval = setInterval(() => {
    try {
      ws.send(JSON.stringify({ type: "state", data: orchestrator.getState() }));
    } catch {}
  }, 5000);

  ws.on("close", () => {
    bus.off("*", handler);
    clearInterval(interval);
    console.log("[WS] Dashboard disconnected");
  });
});

// REST API
app.get("/api/state", (_, res) => res.json(orchestrator.getState()));
app.get("/api/markets", (_, res) => res.json(orchestrator.deployedMarkets));
app.get("/api/prices", (_, res) => res.json(orchestrator.oracle.latestPrices));
app.get("/api/agents", (_, res) => res.json(orchestrator.getState().agents));
app.get("/api/conviction", (_, res) => res.json({
  pending: orchestrator.getState().pendingProposals,
  history: orchestrator.getState().convictionHistory,
}));
app.get("/api/events", (_, res) => res.json(bus.getRecent(null, 50)));

server.listen(PORT, () => {
  console.log(`\n[Server] POLIS API running on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket on ws://localhost:${PORT}`);
  console.log(`[Server] REST API on http://localhost:${PORT}/api/state\n`);

  // Start the orchestrator
  orchestrator.start(12000);
});
