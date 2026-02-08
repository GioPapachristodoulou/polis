import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load ABIs from compiled artifacts
function loadArtifact(name) {
  // Try multiple paths
  const candidates = [
    path.join(__dirname, "..", "artifacts", `${name}.json`),
    path.join(__dirname, "artifacts", `${name}.json`),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {}
  }
  // Return minimal stub for demo mode
  return { abi: [], bytecode: "0x" };
}

export class BlockchainService {
  constructor(config) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.flareRpcUrl);

    // Handle demo mode (no private key)
    if (config.privateKey && config.privateKey !== "" && config.privateKey !== "your_private_key_here") {
      try {
        this.wallet = new ethers.Wallet(config.privateKey, this.provider);
      } catch {
        this.wallet = null;
      }
    } else {
      this.wallet = null;
    }

    // Load artifacts
    this.factoryArtifact = loadArtifact("PolisFactory");
    this.marketArtifact = loadArtifact("PolisMarket");

    // Connect to deployed factory
    if (config.factoryAddress && this.wallet) {
      this.factory = new ethers.Contract(
        config.factoryAddress,
        this.factoryArtifact.abi,
        this.wallet
      );
    } else if (config.factoryAddress) {
      this.factory = new ethers.Contract(
        config.factoryAddress,
        this.factoryArtifact.abi,
        this.provider
      );
    }

    // Feed ID constants
    this.FEEDS = {
      "FLR/USD": "0x01464c522f55534400000000000000000000000000",
      "BTC/USD": "0x014254432f55534400000000000000000000000000",
      "ETH/USD": "0x014554482f55534400000000000000000000000000",
      "XRP/USD": "0x015852502f55534400000000000000000000000000",
      "SOL/USD": "0x01534f4c2f55534400000000000000000000000000",
      "DOGE/USD": "0x01444f47452f555344000000000000000000000000",
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //                      FTSO PRICE FEEDS
  // ═══════════════════════════════════════════════════════════════

  async getPrice(feedName) {
    try {
      const feedId = this.FEEDS[feedName];
      if (!feedId) throw new Error(`Unknown feed: ${feedName}`);
      const [value, decimals, timestamp] = await this.factory.getFTSOPrice(feedId);
      const price = Number(value) / Math.pow(10, Number(decimals));
      return {
        feed: feedName,
        price,
        decimals: Number(decimals),
        rawValue: value.toString(),
        timestamp: Number(timestamp),
        updatedAt: new Date(Number(timestamp) * 1000).toISOString(),
      };
    } catch (err) {
      return { feed: feedName, price: null, error: err.message };
    }
  }

  async getAllPrices() {
    const feeds = Object.keys(this.FEEDS);
    const results = {};
    for (const feed of feeds) {
      results[feed] = await this.getPrice(feed);
    }
    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  //                     MARKET CREATION
  // ═══════════════════════════════════════════════════════════════

  async createMarket(params) {
    const {
      question,
      resolutionCriteria,
      feedName,
      strikePrice,
      isAboveStrike,
      durationSeconds,
      category,
    } = params;

    const feedId = this.FEEDS[feedName] || feedName;
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + durationSeconds;
    const resolution = expiry + 60; // 1 min grace period

    const tx = await this.factory.createMarket(
      question,
      resolutionCriteria,
      feedId,
      strikePrice,
      isAboveStrike,
      expiry,
      resolution,
      category,
      { gasLimit: 3_000_000 }
    );

    const receipt = await tx.wait();
    const marketCount = await this.factory.getMarketCount();
    const marketAddr = await this.factory.markets(Number(marketCount) - 1);

    return {
      txHash: receipt.hash,
      marketAddress: marketAddr,
      question,
      feedName,
      strikePrice,
      expiry: new Date(expiry * 1000).toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //                    CONVICTION RECORDING
  // ═══════════════════════════════════════════════════════════════

  async recordConviction(marketAddress, score) {
    const tx = await this.factory.recordConviction(marketAddress, score, {
      gasLimit: 200_000,
    });
    return tx.wait();
  }

  async checkConsensus(marketAddress) {
    const [approved, avgScore] = await this.factory.hasConsensus(marketAddress);
    return { approved, avgScore: Number(avgScore) };
  }

  // ═══════════════════════════════════════════════════════════════
  //                     MARKET RESOLUTION
  // ═══════════════════════════════════════════════════════════════

  async resolveMarket(marketAddress) {
    const tx = await this.factory.resolveMarket(marketAddress, {
      gasLimit: 500_000,
    });
    return tx.wait();
  }

  // ═══════════════════════════════════════════════════════════════
  //                       MARKET QUERIES
  // ═══════════════════════════════════════════════════════════════

  async getMarketInfo(marketAddress) {
    const market = new ethers.Contract(
      marketAddress,
      this.marketArtifact.abi,
      this.provider
    );
    const info = await market.getMarketInfo();
    return {
      question: info._question,
      feedId: info._feedId,
      strikePrice: info._strikePrice.toString(),
      expiryTimestamp: Number(info._expiryTimestamp),
      outcome: Number(info._outcome),
      yesPrice: Number(info._yesPrice) / 100, // basis points to %
      noPrice: Number(info._noPrice) / 100,
      totalDeposited: ethers.formatEther(info._totalDeposited),
      category: info._category,
      confidenceScore: Number(info._confidenceScore),
    };
  }

  async getActiveMarkets() {
    try {
      return await this.factory.getActiveMarkets();
    } catch {
      return [];
    }
  }

  async getMarketCount() {
    if (!this.factory) return 0;
    return Number(await this.factory.getMarketCount());
  }

  getWalletAddress() {
    return this.wallet?.address || "0x0000000000000000000000000000000000000000";
  }

  async getBalance() {
    if (!this.wallet) return "0.0 (demo mode)";
    const bal = await this.provider.getBalance(this.wallet.address);
    return ethers.formatEther(bal);
  }
}
