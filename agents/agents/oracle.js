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
    let score = 40;
    let reasoning = "";

    // Check if we have price data for this feed
    if (this.latestPrices[data.feedId]) {
      score += 30;
      reasoning += "Active price feed confirmed. ";

      const priceAge = Date.now() / 1000 - (this.latestPrices[data.feedId].timestamp || 0);
      if (priceAge < 120) {
        score += 15;
        reasoning += "Fresh data (<2min). ";
      } else {
        reasoning += `Data age: ${Math.round(priceAge)}s. `;
      }
    } else {
      score -= 20;
      reasoning += "No active feed for this market. ";
    }

    // Feed exists in our known feeds
    if (FEED_NAMES[data.feedId]) {
      score += 10;
      reasoning += `Known feed: ${FEED_NAMES[data.feedId]}. `;
    }

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
    }
  }
}
export default OracleAgent;
