import bus, { EVENTS } from "./eventbus.js";
import convictionMarket from "./conviction.js";
import { PRIVATE_KEY } from "./config.js";
import { ScoutAgent } from "./agents/scout.js";
import { ArchitectAgent } from "./agents/architect.js";
import { OracleAgent } from "./agents/oracle.js";
import { MarketMakerAgent } from "./agents/marketmaker.js";
import { SentinelAgent } from "./agents/sentinel.js";

/**
 * POLIS Orchestrator — Coordinates the 5-agent prediction market collective.
 */
export class Orchestrator {
  constructor() {
    this.oracle = new OracleAgent(PRIVATE_KEY);
    this.scout = new ScoutAgent(this.oracle);
    this.architect = new ArchitectAgent(PRIVATE_KEY);
    this.marketmaker = new MarketMakerAgent(this.oracle);
    this.sentinel = new SentinelAgent();
    this.running = false;
    this.cycleCount = 0;
    this.deployedMarkets = [];

    bus.on(EVENTS.CONVICTION_CONSENSUS, (event) => {
      this._handleConsensus(event.data);
    });
  }

  async start(intervalMs = 12000) {
    this.running = true;
    console.log("\n" + "=".repeat(60));
    console.log("  POLIS - The Autonomous Prediction Market Collective");
    console.log("=".repeat(60));
    console.log("  Scout      - Monitoring price feeds for opportunities");
    console.log("  Architect  - Ready to design & deploy markets");
    console.log("  Oracle     - Connected to Flare FTSO");
    console.log("  MarketMaker- Liquidity engine online");
    console.log("  Sentinel   - Guardrails active");
    console.log("=".repeat(60) + "\n");

    bus.publish(EVENTS.SYSTEM_LOG, { agent: "Orchestrator", message: "POLIS system started." });
    await this.oracle.fetchPrices();

    while (this.running) {
      await this.runCycle();
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  async runCycle() {
    this.cycleCount++;
    const start = Date.now();
    console.log(`\n--- Cycle #${this.cycleCount} @ ${new Date().toLocaleTimeString()} ---`);

    // Step 1: Oracle fetches prices
    console.log("[Oracle] Fetching FTSO prices...");
    const prices = await this.oracle.fetchPrices();
    for (const [, d] of Object.entries(prices)) {
      if (["BTC/USD", "ETH/USD", "FLR/USD"].includes(d.feedName)) {
        console.log(`  ${d.feedName}: $${d.floatPrice.toFixed(d.decimals > 4 ? 6 : 2)}`);
      }
    }

    // Step 2: Scout scans
    console.log("[Scout] Scanning for opportunities...");
    const discoveries = await this.scout.scan();
    for (const d of discoveries) console.log(`  Proposed: "${d.question}"`);
    if (!discoveries.length) console.log("  No new opportunities");

    // Step 3: Vote on pending proposals
    const pending = convictionMarket.getPending();
    if (pending.length > 0) {
      console.log(`[Conviction] Voting on ${pending.length} proposal(s)...`);
      for (const p of pending) {
        this.architect.voteOnProposal(p.id);
        this.oracle.voteOnProposal(p.id);
        this.marketmaker.voteOnProposal(p.id);
        this.sentinel.voteOnProposal(p.id);
      }
    }

    // Step 4: Health check
    this.sentinel.healthCheck();
    await this.oracle.checkResolutions();

    console.log(`Cycle done in ${Date.now() - start}ms | Markets: ${this.deployedMarkets.length}`);
  }

  async _handleConsensus(data) {
    if (!data.approved) {
      console.log(`  REJECTED: "${data.data?.question?.slice(0, 50)}..." (avg: ${data.avgScore})`);
      return;
    }
    console.log(`  APPROVED: "${data.data?.question?.slice(0, 50)}..." (avg: ${data.avgScore})`);
    console.log(`  Votes: ${JSON.stringify(Object.fromEntries(Object.entries(data.votes).map(([a, v]) => [a, v.score])))}`);

    console.log("[Architect] Deploying market...");
    const market = await this.architect.deployMarket(data.data);
    if (market) {
      this.deployedMarkets.push(market);
      this.sentinel.onMarketDeployed();
      console.log(`  Deployed: ${market.marketAddress?.slice(0, 18)}...${market.onChain ? " (on-chain)" : " (simulated)"}`);

      console.log("[MarketMaker] Providing liquidity...");
      const liq = await this.marketmaker.provideLiquidity({ ...data.data, marketAddress: market.marketAddress });
      console.log(`  Liquidity: ${liq.amount} ETH | YES ${liq.initialYesOdds}% / NO ${liq.initialNoOdds}%`);
    }
  }

  stop() { this.running = false; }

  getState() {
    return {
      running: this.running, cycleCount: this.cycleCount,
      deployedMarkets: this.deployedMarkets,
      prices: this.oracle.latestPrices,
      pendingProposals: convictionMarket.getPending(),
      convictionHistory: convictionMarket.getHistory(),
      sentinelHealth: this.sentinel.healthCheck(),
      agents: {
        scout: { status: this.scout.status, scanCount: this.scout.scanCount },
        architect: { status: this.architect.status, deployedCount: this.architect.deployedCount },
        oracle: { status: this.oracle.status, updateCount: this.oracle.priceUpdateCount },
        marketmaker: { status: this.marketmaker.status, totalLiquidity: this.marketmaker.totalLiquidityProvided },
        sentinel: { status: this.sentinel.status, alertCount: this.sentinel.alertCount },
      },
      recentEvents: bus.getRecent(null, 30),
    };
  }
}
export default Orchestrator;
