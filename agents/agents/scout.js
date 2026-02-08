import bus, { EVENTS } from "../eventbus.js";
import { AGENT_CONFIG, FEED_IDS, FEED_NAMES } from "../config.js";
import convictionMarket from "../conviction.js";

const CFG = AGENT_CONFIG.scout;

/**
 * Scout Agent — The eyes and ears of POLIS.
 * Monitors FTSO price feeds to identify prediction-worthy events.
 */
export class ScoutAgent {
  constructor(oracleAgent) {
    this.oracle = oracleAgent;
    this.priceHistory = {};
    this.proposedMarkets = new Set();
    this.scanCount = 0;
    this.status = "idle";
  }

  async scan() {
    this.scanCount++;
    this.status = "scanning";

    bus.publish(EVENTS.AGENT_STATUS, {
      agent: CFG.name, emoji: CFG.emoji, status: "scanning",
      detail: `Scan #${this.scanCount}`,
    });

    const discoveries = [];
    const prices = this.oracle?.latestPrices || {};

    for (const [feedId, priceData] of Object.entries(prices)) {
      this._recordPrice(feedId, priceData);
      discoveries.push(...this._analyzePrices(feedId, priceData));
    }

    // Periodic synthetic event generation
    if (this.scanCount % 2 === 0) {
      discoveries.push(...this._generateSyntheticEvents(prices));
    }

    for (const discovery of discoveries) {
      const proposalId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      bus.publish(EVENTS.EVENT_DISCOVERED, {
        agent: CFG.name, emoji: CFG.emoji, discovery, proposalId,
      });
      bus.publish(EVENTS.MARKET_PROPOSED, {
        agent: CFG.name, emoji: CFG.emoji, proposal: discovery, proposalId,
      });

      convictionMarket.createProposal(proposalId, "create_market", discovery, CFG.name);
    }

    this.status = discoveries.length > 0 ? "found_opportunities" : "idle";
    bus.publish(EVENTS.AGENT_STATUS, {
      agent: CFG.name, emoji: CFG.emoji, status: this.status,
      detail: `Found ${discoveries.length} opportunities`,
    });

    return discoveries;
  }

  _recordPrice(feedId, priceData) {
    if (!this.priceHistory[feedId]) this.priceHistory[feedId] = [];
    this.priceHistory[feedId].push({ price: priceData.floatPrice || priceData.price, timestamp: Date.now() });
    if (this.priceHistory[feedId].length > 100) this.priceHistory[feedId].shift();
  }

  _analyzePrices(feedId, priceData) {
    const opps = [];
    const name = FEED_NAMES[feedId] || feedId;
    const price = priceData.floatPrice || priceData.price;
    const history = this.priceHistory[feedId] || [];
    if (history.length < 3) return opps;

    // Round-number threshold markets
    const roundNumbers = this._getNearbyRoundNumbers(price, name);
    for (const target of roundNumbers) {
      const key = `${name}_${target.direction}_${target.value}`;
      if (this.proposedMarkets.has(key)) continue;
      this.proposedMarkets.add(key);
      const duration = 30 + Math.floor(Math.random() * 90);
      opps.push({
        question: `Will ${name} be ${target.direction} $${target.label} in ${duration} minutes?`,
        resolutionCriteria: `Resolves based on ${name} FTSO feed at expiry`,
        feedId, feedName: name, strikePrice: target.value,
        isAboveStrike: target.direction === "above",
        durationMinutes: duration, category: "crypto",
        source: "price_analysis", currentPrice: price,
        confidence: target.confidence,
      });
    }

    // Momentum detection
    if (history.length >= 5) {
      const recent = history.slice(-5).map(h => h.price);
      const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const vol = Math.abs(price - avg) / avg;
      if (vol > 0.003) {
        const key = `${name}_momentum_${this.scanCount}`;
        if (!this.proposedMarkets.has(key)) {
          this.proposedMarkets.add(key);
          const target = price > avg ? price * 1.01 : price * 0.99;
          const dir = price > avg ? "rise above" : "fall below";
          opps.push({
            question: `Will ${name} ${dir} $${this._fmtPrice(target)} in the next hour?`,
            resolutionCriteria: `Resolves based on ${name} FTSO feed`,
            feedId, feedName: name, strikePrice: target,
            isAboveStrike: price > avg, durationMinutes: 60,
            category: "crypto", source: "volatility_detection",
            currentPrice: price,
            confidence: Math.min(85, 50 + Math.round(vol * 5000)),
          });
        }
      }
    }
    return opps;
  }

  _getNearbyRoundNumbers(price, name) {
    const targets = [];
    let roundings;
    if (name.includes("BTC")) roundings = [1000, 5000];
    else if (name.includes("ETH")) roundings = [50, 100];
    else if (name.includes("SOL")) roundings = [5, 10];
    else if (price < 0.1) roundings = [0.001, 0.005];
    else if (price < 1) roundings = [0.05, 0.1];
    else roundings = [0.5, 1];

    for (const r of roundings) {
      const above = Math.ceil(price / r) * r;
      const below = Math.floor(price / r) * r;
      const above2 = above + r; // Second round number away
      const below2 = below - r;
      const dA = (above - price) / price;
      const dB = (price - below) / price;
      const dA2 = (above2 - price) / price;
      const dB2 = (price - below2) / price;
      // Close targets — higher confidence
      if (dA > 0.001 && dA < 0.05)
        targets.push({ value: above, label: this._fmtPrice(above), direction: "above", confidence: Math.round(75 - dA * 800) });
      if (dB > 0.001 && dB < 0.05)
        targets.push({ value: below, label: this._fmtPrice(below), direction: "below", confidence: Math.round(75 - dB * 800) });
      // Further targets — lower confidence, agents should be skeptical
      if (dA2 > 0.02 && dA2 < 0.12)
        targets.push({ value: above2, label: this._fmtPrice(above2), direction: "above", confidence: Math.round(45 - dA2 * 200) });
      if (dB2 > 0.02 && dB2 < 0.12)
        targets.push({ value: below2, label: this._fmtPrice(below2), direction: "below", confidence: Math.round(45 - dB2 * 200) });
    }
    return targets.slice(0, 3);
  }

  _fmtPrice(v) {
    if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (v >= 1) return v.toFixed(2);
    if (v >= 0.01) return v.toFixed(4);
    return v.toFixed(6);
  }

  _generateSyntheticEvents(prices) {
    const events = [];
    const templates = [
      // Conservative — should generally pass
      { feedKey: "BTC/USD", qFn: p => `Will BTC hold above $${(Math.floor(p/1000)*1000).toLocaleString()}?`,
        sFn: p => Math.floor(p/1000)*1000, isAbove: true, dur: 60, confidence: 72 },
      { feedKey: "ETH/USD", qFn: p => `Will ETH break $${(Math.ceil(p/50)*50).toLocaleString()} in 2h?`,
        sFn: p => Math.ceil(p/50)*50, isAbove: true, dur: 120, confidence: 68 },
      // Moderate — could go either way
      { feedKey: "FLR/USD", qFn: p => `Will FLR gain 5% from $${p.toFixed(4)} in 1h?`,
        sFn: p => p*1.05, isAbove: true, dur: 60, confidence: 55 },
      { feedKey: "SOL/USD", qFn: p => `Will SOL surge 8% to $${(p*1.08).toFixed(0)} in 90min?`,
        sFn: p => p*1.08, isAbove: true, dur: 90, confidence: 40 },
      // Speculative — agents should be skeptical, likely rejected
      { feedKey: "BTC/USD", qFn: p => `Will BTC crash 15% to $${(p*0.85).toFixed(0)} in 30min?`,
        sFn: p => p*0.85, isAbove: false, dur: 30, confidence: 25 },
      { feedKey: "ETH/USD", qFn: p => `Will ETH moon to $${(p*1.20).toFixed(0)} by tomorrow?`,
        sFn: p => p*1.20, isAbove: true, dur: 480, confidence: 20 },
      { feedKey: "DOGE/USD", qFn: p => `Quick: DOGE above $${(p*1.03).toFixed(4)} in 8min?`,
        sFn: p => p*1.03, isAbove: true, dur: 8, confidence: 35 },
      { feedKey: "FLR/USD", qFn: p => `Will FLR double to $${(p*2).toFixed(4)} in 4h?`,
        sFn: p => p*2, isAbove: true, dur: 240, confidence: 10 },
      { feedKey: "XRP/USD", qFn: p => `Flash crash: XRP below $${(p*0.7).toFixed(2)} in 20min?`,
        sFn: p => p*0.7, isAbove: false, dur: 20, confidence: 15 },
      // Borderline — near the threshold, interesting to watch
      { feedKey: "ADA/USD", qFn: p => `Will ADA move 3% from $${p.toFixed(4)} in 45min?`,
        sFn: p => p*1.03, isAbove: true, dur: 45, confidence: 58 },
      { feedKey: "AVAX/USD", qFn: p => `AVAX above $${(p*1.06).toFixed(2)} in 1h?`,
        sFn: p => p*1.06, isAbove: true, dur: 60, confidence: 48 },
    ];
    // Cycle through templates — produces different quality proposals over time
    const t = templates[this.scanCount % templates.length];
    const feedId = FEED_IDS[t.feedKey];
    const pd = prices[feedId];
    if (pd) {
      const fp = pd.floatPrice || pd.price;
      const key = `synth_${t.feedKey}_${this.scanCount}`;
      if (!this.proposedMarkets.has(key)) {
        this.proposedMarkets.add(key);
        events.push({
          question: t.qFn(fp), resolutionCriteria: `Resolves via ${t.feedKey} FTSO`,
          feedId, feedName: t.feedKey, strikePrice: t.sFn(fp),
          isAboveStrike: t.isAbove, durationMinutes: t.dur,
          category: "crypto", source: "synthetic_generation",
          currentPrice: fp, confidence: t.confidence,
        });
      }
    }
    return events;
  }
}
export default ScoutAgent;
