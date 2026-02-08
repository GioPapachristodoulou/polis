import bus, { EVENTS } from "../eventbus.js";
import { AGENT_CONFIG } from "../config.js";
import convictionMarket from "../conviction.js";

const CFG = AGENT_CONFIG.marketmaker;

/**
 * Market Maker Agent — Provides algorithmic liquidity.
 * Uses FTSO price data to calibrate initial odds and maintain liquidity.
 */
export class MarketMakerAgent {
  constructor(oracleAgent) {
    this.oracle = oracleAgent;
    this.activePositions = [];
    this.totalLiquidityProvided = 0;
    this.status = "idle";
  }

  /**
   * Vote on proposals with market-making viability assessment
   */
  voteOnProposal(proposalId) {
    const proposal = convictionMarket.getProposal(proposalId);
    if (!proposal || proposal.type !== "create_market") return;

    const data = proposal.data;
    let score = 40;
    let reasoning = "";

    // Assess market-making viability
    const prices = this.oracle?.latestPrices || {};
    const priceData = prices[data.feedId];

    if (priceData) {
      const currentPrice = priceData.floatPrice || priceData.price;
      const strike = data.strikePrice;
      const distance = Math.abs(currentPrice - strike) / currentPrice;

      // Markets near the money are best for liquidity provision
      if (distance < 0.01) {
        score += 30;
        reasoning += "At-the-money: ideal for liquidity. ";
      } else if (distance < 0.03) {
        score += 20;
        reasoning += "Near-the-money: good for liquidity. ";
      } else if (distance < 0.07) {
        score += 8;
        reasoning += "Moderate distance from strike. ";
      } else {
        score -= 15;
        reasoning += "Far from strike: low trading interest expected. ";
      }

      // Duration sweet spot — 30-120 min is ideal for fee capture
      if (data.durationMinutes >= 30 && data.durationMinutes <= 90) {
        score += 12;
        reasoning += "Ideal duration for fee capture. ";
      } else if (data.durationMinutes < 30) {
        score -= 5;
        reasoning += "Short duration limits fee opportunity. ";
      } else if (data.durationMinutes > 120) {
        score += 3;
        reasoning += "Long duration — slow fee accumulation. ";
      }

      // Prefer higher-value assets (more trading interest)
      if (currentPrice > 10000) {
        score += 8;
        reasoning += "High-value asset attracts traders. ";
      } else if (currentPrice < 0.1) {
        score -= 5;
        reasoning += "Low-value asset: thin market expected. ";
      }

      // Portfolio diversity — penalize if too many of same feed
      const sameFeedCount = this.activePositions.filter(p => p.feedId === data.feedId).length;
      if (sameFeedCount > 2) {
        score -= 10;
        reasoning += "Overexposed to this feed. ";
      } else if (sameFeedCount === 0) {
        score += 5;
        reasoning += "New feed — diversifies portfolio. ";
      }
    } else {
      score -= 20;
      reasoning += "No price data available for liquidity calibration. ";
    }

    // Per-proposal variance based on content
    const seed = (data.question || "").length + (data.durationMinutes || 0);
    score += ((seed * 13) % 11) - 5; // -5 to +5

    score = Math.max(10, Math.min(95, score));
    return convictionMarket.vote(proposalId, CFG.name, score, reasoning.trim());
  }

  /**
   * Provide initial liquidity to a new market
   */
  async provideLiquidity(marketData) {
    this.status = "providing_liquidity";

    const prices = this.oracle?.latestPrices || {};
    const priceData = prices[marketData.feedId];

    let initialOdds = 50; // Default 50/50
    if (priceData) {
      const current = priceData.price;
      const strike = marketData.strikePrice;
      const distance = (current - strike) / current;

      // Calibrate initial odds based on distance from strike
      if (marketData.isAboveStrike) {
        initialOdds = current > strike
          ? Math.min(80, 50 + Math.round(distance * 500))
          : Math.max(20, 50 + Math.round(distance * 500));
      } else {
        initialOdds = current < strike
          ? Math.min(80, 50 + Math.round(Math.abs(distance) * 500))
          : Math.max(20, 50 - Math.round(Math.abs(distance) * 500));
      }
    }

    const liquidity = {
      market: marketData.marketAddress,
      amount: CFG.liquidityAmount,
      initialYesOdds: initialOdds,
      initialNoOdds: 100 - initialOdds,
      timestamp: Date.now(),
    };

    this.activePositions.push(liquidity);
    this.totalLiquidityProvided += parseFloat(CFG.liquidityAmount);
    this.status = "idle";

    bus.publish(EVENTS.LIQUIDITY_ADDED, {
      agent: CFG.name, emoji: CFG.emoji,
      ...liquidity,
      question: marketData.question,
    });

    return liquidity;
  }
}
export default MarketMakerAgent;
