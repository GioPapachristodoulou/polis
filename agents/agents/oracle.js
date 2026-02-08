import { ethers } from "ethers";
import bus, { EVENTS } from "../eventbus.js";
import { AGENT_CONFIG, NETWORKS, CONTRACTS, FACTORY_ABI, FEED_IDS, FEED_NAMES } from "../config.js";
import convictionMarket from "../conviction.js";

const CFG = AGENT_CONFIG.oracle;

/**
 * Oracle Agent — Connects to Flare FTSO for real-time data.
 * Fetches live prices, feeds them to other agents, and resolves expired markets.
 */
export class OracleAgent {
  constructor(wallet) {
    this.wallet = wallet;
    this.provider = new ethers.JsonRpcProvider(NETWORKS.flare.rpc);
    this.factory = null;
    this.latestPrices = {};
    this._priceHistory = {};
    this.priceUpdateCount = 0;
    this.status = "idle";

    if (wallet && CONTRACTS.factory) {
      const signer = new ethers.Wallet(wallet, this.provider);
      this.factory = new ethers.Contract(CONTRACTS.factory, FACTORY_ABI, signer);
    }
  }

  /**
   * Fetch latest prices from Flare FTSO
   */
  async fetchPrices() {
    this.status = "fetching_prices";
    this.priceUpdateCount++;

    bus.publish(EVENTS.AGENT_STATUS, {
      agent: CFG.name, emoji: CFG.emoji, status: "fetching",
      detail: `Price fetch #${this.priceUpdateCount}`,
    });

    const feedIds = Object.values(FEED_IDS);
    const feedNames = Object.keys(FEED_IDS);

    // Try on-chain FTSO read
    if (this.factory) {
      try {
        const [prices, decimals, timestamp] = await this.factory.getFTSOPrices(feedIds);

        for (let i = 0; i < feedIds.length; i++) {
          const price = Number(prices[i]);
          const dec = Number(decimals[i]);
          const floatPrice = price / Math.pow(10, dec);

          this.latestPrices[feedIds[i]] = {
            price,
            decimals: dec,
            floatPrice,
            timestamp: Number(timestamp),
            feedName: feedNames[i],
            source: "ftso_onchain",
          };

          // Track price history for volatility calculation
          if (!this._priceHistory[feedIds[i]]) this._priceHistory[feedIds[i]] = [];
          this._priceHistory[feedIds[i]].push(floatPrice);
          if (this._priceHistory[feedIds[i]].length > 10) this._priceHistory[feedIds[i]].shift();
        }

        bus.publish(EVENTS.PRICE_UPDATE, {
          agent: CFG.name, emoji: CFG.emoji,
          prices: this.latestPrices,
          source: "ftso_onchain",
          count: Object.keys(this.latestPrices).length,
        });

        this.status = "idle";
        return this.latestPrices;
      } catch (err) {
        bus.publish(EVENTS.SYSTEM_LOG, {
          agent: CFG.name,
          message: `FTSO on-chain read failed, using simulated prices: ${err.message?.slice(0, 60)}`,
        });
      }
    }

    // Simulated prices (for demo when not connected to Flare)
    this._generateSimulatedPrices(feedIds, feedNames);

    bus.publish(EVENTS.PRICE_UPDATE, {
      agent: CFG.name, emoji: CFG.emoji,
      prices: this.latestPrices,
      source: "simulated",
      count: Object.keys(this.latestPrices).length,
    });

    this.status = "idle";
    return this.latestPrices;
  }

  /**
   * Vote on proposals with data availability assessment
   */
  voteOnProposal(proposalId) {
    const proposal = convictionMarket.getProposal(proposalId);
    if (!proposal || proposal.type !== "create_market") return;

    const data = proposal.data;
    let score = 35;
    let reasoning = "";

    // Check if we have price data for this feed
    const feedData = this.latestPrices[data.feedId];
    if (feedData) {
      score += 25;
      reasoning += "Active price feed confirmed. ";

      const priceAge = Date.now() / 1000 - (feedData.timestamp || 0);
      if (priceAge < 30) {
        score += 20;
        reasoning += "Very fresh data (<30s). ";
      } else if (priceAge < 120) {
        score += 10;
        reasoning += `Data age: ${Math.round(priceAge)}s. `;
      } else {
        score -= 5;
        reasoning += `Stale data: ${Math.round(priceAge)}s old. `;
      }

      // Price momentum confidence — is the price stable or volatile?
      if (this._priceHistory && this._priceHistory[data.feedId]) {
        const hist = this._priceHistory[data.feedId];
        if (hist.length >= 2) {
          const recent = hist.slice(-3);
          const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
          const variance = recent.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / recent.length;
          const volatility = Math.sqrt(variance) / avg;
          if (volatility < 0.001) {
            score += 15;
            reasoning += "Low volatility — high oracle confidence. ";
          } else if (volatility < 0.005) {
            score += 5;
            reasoning += "Moderate volatility. ";
          } else {
            score -= 10;
            reasoning += "High volatility — oracle uncertainty. ";
          }
        }
      }

      // Duration-based confidence — shorter markets need fresher data
      if (data.durationMinutes < 30 && priceAge > 60) {
        score -= 10;
        reasoning += "Short market needs fresher oracle data. ";
      }
    } else {
      score -= 20;
      reasoning += "No active feed for this market. ";
    }

    // Feed exists in our known feeds
    if (FEED_NAMES[data.feedId]) {
      score += 8;
      reasoning += `Known feed: ${FEED_NAMES[data.feedId]}. `;
    }

    // Per-proposal uncertainty factor (based on proposal content hash)
    const contentSeed = (data.question || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const uncertainty = ((contentSeed * 7 + data.durationMinutes) % 15) - 7; // -7 to +7
    score += uncertainty;

    score = Math.max(5, Math.min(95, score));
    return convictionMarket.vote(proposalId, CFG.name, score, reasoning.trim());
  }

  /**
   * Check and resolve expired markets
   */
  async checkResolutions() {
    if (!this.factory) return [];

    try {
      const markets = await this.factory.getActiveMarkets();
      const resolved = [];

      for (const addr of markets) {
        // Check if market is past resolution time
        // In production, this would check resolutionTimestamp
        // For demo, we just log it
        bus.publish(EVENTS.SYSTEM_LOG, {
          agent: CFG.name,
          message: `Monitoring market ${addr.slice(0, 10)}... for resolution`,
        });
      }
      return resolved;
    } catch (err) {
      return [];
    }
  }

  /**
   * Generate realistic simulated prices
   */
  _generateSimulatedPrices(feedIds, feedNames) {
    const basePrices = {
      "FLR/USD": 0.0098, "BTC/USD": 70500, "ETH/USD": 2050,
      "XRP/USD": 1.47, "DOGE/USD": 0.099, "ADA/USD": 0.277,
      "AVAX/USD": 9.30, "SOL/USD": 88,
    };

    for (let i = 0; i < feedIds.length; i++) {
      const name = feedNames[i];
      const base = basePrices[name] || 1.0;
      const existing = this.latestPrices[feedIds[i]];
      const prevFloat = existing?.floatPrice || base;

      // Random walk: ±0.5% per tick
      const change = 1 + (Math.random() - 0.5) * 0.01;
      const newFloat = prevFloat * change;
      const decimals = newFloat > 100 ? 2 : newFloat > 1 ? 4 : 6;
      const price = Math.round(newFloat * Math.pow(10, decimals));

      this.latestPrices[feedIds[i]] = {
        price,
        decimals,
        floatPrice: newFloat,
        timestamp: Math.floor(Date.now() / 1000),
        feedName: name,
        source: "simulated",
      };

      // Track price history
      if (!this._priceHistory[feedIds[i]]) this._priceHistory[feedIds[i]] = [];
      this._priceHistory[feedIds[i]].push(newFloat);
      if (this._priceHistory[feedIds[i]].length > 10) this._priceHistory[feedIds[i]].shift();
    }
  }
}
export default OracleAgent;
