import bus, { EVENTS } from "../eventbus.js";
import { AGENT_CONFIG } from "../config.js";
import convictionMarket from "../conviction.js";

const CFG = AGENT_CONFIG.sentinel;

/**
 * Sentinel Agent — The guardrails of POLIS.
 * Monitors all agent behavior, assesses risk, and can trigger circuit breakers.
 * This agent is the reason POLIS is commercially viable.
 */
export class SentinelAgent {
  constructor() {
    this.riskLog = [];
    this.recentRisks = [];
    this.alertCount = 0;
    this.circuitBroken = false;
    this.marketsDeployedLastHour = 0;
    this.lastHourReset = Date.now();
    this.status = "watching";
  }

  /**
   * Vote on proposals with risk assessment
   */
  voteOnProposal(proposalId) {
    const proposal = convictionMarket.getProposal(proposalId);
    if (!proposal || proposal.type !== "create_market") return;

    const data = proposal.data;
    let score = 75; // Start optimistic, penalize for risks
    let reasoning = "";
    const risks = [];

    // Risk 1: Rate limiting — too many markets too fast
    this._updateHourlyCount();
    if (this.marketsDeployedLastHour > 20) {
      score -= 40;
      risks.push("HIGH: Market creation rate exceeds safe threshold");
      reasoning += "Severe rate limit concern. ";
    } else if (this.marketsDeployedLastHour > 12) {
      score -= 25;
      risks.push("HIGH: Market creation rate exceeds safe threshold");
      reasoning += "Rate limit concern. ";
    } else if (this.marketsDeployedLastHour > 6) {
      score -= 12;
      risks.push("MED: Elevated market creation rate");
      reasoning += "Moderate rate. ";
    } else {
      score += 5;
      reasoning += "Healthy creation rate. ";
    }

    // Risk 2: Duration check
    if (data.durationMinutes < 10) {
      score -= 30;
      risks.push("HIGH: Ultra-short market susceptible to manipulation");
      reasoning += "Duration dangerously short. ";
    } else if (data.durationMinutes < 20) {
      score -= 15;
      risks.push("MED: Short market duration");
      reasoning += "Duration somewhat short. ";
    } else if (data.durationMinutes > 360) {
      score -= 12;
      risks.push("MED: Long duration increases oracle risk");
      reasoning += "Long duration. ";
    } else if (data.durationMinutes >= 30 && data.durationMinutes <= 120) {
      score += 8;
      reasoning += "Duration within ideal range. ";
    }

    // Risk 3: Strike distance from current price
    if (data.currentPrice && data.strikePrice) {
      const distance = Math.abs(data.currentPrice - data.strikePrice) / data.currentPrice;
      if (distance > 0.2) {
        score -= 20;
        risks.push("HIGH: Strike very far from current price — manipulation risk");
        reasoning += "Extreme strike distance. ";
      } else if (distance > 0.1) {
        score -= 10;
        risks.push("MED: Strike somewhat far from current price");
        reasoning += "Wide strike. ";
      } else if (distance < 0.001) {
        score -= 12;
        risks.push("MED: Strike too close, near-certain outcome");
        reasoning += "Trivial market. ";
      } else if (distance < 0.03) {
        score += 8;
        reasoning += "Strike is well-placed near current price. ";
      } else {
        score += 3;
        reasoning += "Reasonable strike distance. ";
      }
    }

    // Risk 4: Question quality
    if (!data.question || data.question.length < 20) {
      score -= 15;
      risks.push("MED: Poorly formed market question");
      reasoning += "Question too short. ";
    }

    // Risk 5: Market diversity — penalize if too many markets on same asset
    if (data.feedId) {
      const recentAlerts = this.recentRisks || [];
      const sameFeedAlerts = recentAlerts.filter(r => r.feedId === data.feedId).length;
      if (sameFeedAlerts > 3) {
        score -= 10;
        reasoning += "Concentration risk: too many markets on same asset. ";
        risks.push("MED: Asset concentration risk");
      }
    }

    // Risk 6: Circuit breaker check
    if (this.circuitBroken) {
      score = 0;
      risks.push("CRITICAL: Circuit breaker active — all market creation halted");
      reasoning = "CIRCUIT BREAKER ACTIVE";
    }

    // Per-proposal variance
    const seed = (data.question || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    score += ((seed * 11) % 9) - 4; // -4 to +4

    score = Math.max(0, Math.min(95, score));

    // Log risk assessment
    const assessment = {
      proposalId, score, risks, reasoning: reasoning.trim(),
      timestamp: Date.now(),
    };
    this.riskLog.push(assessment);
    if (this.riskLog.length > 100) this.riskLog.shift();
    this.recentRisks.push({ feedId: data.feedId, ts: Date.now() });
    this.recentRisks = this.recentRisks.filter(r => Date.now() - r.ts < 600000); // Keep last 10min

    bus.publish(EVENTS.RISK_ASSESSED, {
      agent: CFG.name, emoji: CFG.emoji,
      proposalId, score, risks, reasoning: reasoning.trim(),
      question: data.question?.slice(0, 60),
    });

    if (risks.some(r => r.startsWith("HIGH") || r.startsWith("CRITICAL"))) {
      this.alertCount++;
      bus.publish(EVENTS.RISK_ALERT, {
        agent: CFG.name, emoji: CFG.emoji,
        alert: risks.filter(r => r.startsWith("HIGH") || r.startsWith("CRITICAL")),
        proposalId,
      });
    }

    return convictionMarket.vote(proposalId, CFG.name, score, reasoning.trim());
  }

  /**
   * Monitor system health
   */
  healthCheck() {
    bus.publish(EVENTS.AGENT_STATUS, {
      agent: CFG.name, emoji: CFG.emoji, status: "watching",
      detail: `Alerts: ${this.alertCount} | Markets/hr: ${this.marketsDeployedLastHour} | Circuit: ${this.circuitBroken ? "BROKEN" : "OK"}`,
    });
    return {
      alertCount: this.alertCount,
      marketsDeployedLastHour: this.marketsDeployedLastHour,
      circuitBroken: this.circuitBroken,
      recentRisks: this.riskLog.slice(-5),
    };
  }

  /**
   * Acknowledge a market was deployed (for rate tracking)
   */
  onMarketDeployed() {
    this.marketsDeployedLastHour++;
  }

  /**
   * Trigger circuit breaker (emergency stop)
   */
  triggerCircuitBreaker(reason) {
    this.circuitBroken = true;
    bus.publish(EVENTS.CIRCUIT_BREAKER, {
      agent: CFG.name, emoji: CFG.emoji,
      reason, timestamp: Date.now(),
    });
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker() {
    this.circuitBroken = false;
  }

  _updateHourlyCount() {
    if (Date.now() - this.lastHourReset > 3600_000) {
      this.marketsDeployedLastHour = 0;
      this.lastHourReset = Date.now();
    }
  }
}
export default SentinelAgent;
