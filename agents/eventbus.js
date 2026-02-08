import { EventEmitter } from "events";

/**
 * POLIS Event Bus — Central nervous system for agent communication.
 * All agents publish and subscribe to events through this bus.
 * The dashboard WebSocket also taps into this for real-time visualization.
 */
class PolisEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.eventLog = [];
  }

  /**
   * Publish a typed event to the bus
   */
  publish(type, data) {
    const event = {
      type,
      data,
      timestamp: Date.now(),
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    this.eventLog.push(event);
    // Keep last 200 events in memory
    if (this.eventLog.length > 200) this.eventLog.shift();
    this.emit(type, event);
    this.emit("*", event); // Wildcard for dashboard
    return event;
  }

  /**
   * Get recent events of a given type
   */
  getRecent(type, count = 10) {
    return this.eventLog
      .filter((e) => !type || e.type === type)
      .slice(-count);
  }
}

// Event types used across the system
export const EVENTS = {
  // Scout events
  EVENT_DISCOVERED: "event:discovered",
  MARKET_PROPOSED: "market:proposed",

  // Architect events
  MARKET_DESIGNED: "market:designed",
  MARKET_DEPLOYED: "market:deployed",

  // Oracle events
  PRICE_UPDATE: "price:update",
  MARKET_RESOLUTION_READY: "market:resolution_ready",
  MARKET_RESOLVED: "market:resolved",

  // Market Maker events
  LIQUIDITY_ADDED: "liquidity:added",
  TRADE_EXECUTED: "trade:executed",

  // Sentinel events
  RISK_ASSESSED: "risk:assessed",
  RISK_ALERT: "risk:alert",
  CIRCUIT_BREAKER: "circuit:breaker",

  // Conviction events
  CONVICTION_VOTE: "conviction:vote",
  CONVICTION_CONSENSUS: "conviction:consensus",

  // System events
  AGENT_STATUS: "agent:status",
  SYSTEM_LOG: "system:log",
  ERROR: "system:error",
};

export const bus = new PolisEventBus();
export default bus;
