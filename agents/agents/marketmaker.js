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
    let score = 50;
    let reasoning = "";

    // Assess market-making viability
    const prices = this.oracle?.latestPrices || {};
    const priceData = prices[data.feedId];

    if (priceData) {
      const currentPrice = priceData.price;
      const strike = data.strikePrice;
      const distance = Math.abs(currentPrice - strike) / currentPrice;

      // Markets near the money are best for liquidity provision
      if (distance < 0.02) {
        score += 25;
        reasoning += "Near-the-money: excellent for liquidity. ";
      } else if (distance < 0.05) {
        score += 15;
        reasoning += "Moderate distance from strike. ";
      } else {
        score -= 10;
        reasoning += "Far from strike: low trading interest expected. ";
      }

      // Duration assessment
      if (data.durationMinutes >= 30 && data.durationMinutes <= 120) {
        score += 10;
        reasoning += "Good duration for fee capture. ";
      }
    } else {
      score -= 15;
      reasoning += "No price data available for liquidity calibration. ";
    }

    // Volume potential
    if (data.confidence >= 60) {
      score += 10;
      reasoning += "High-confidence market likely attracts volume. ";
    }

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
