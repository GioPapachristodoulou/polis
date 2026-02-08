# 🏛️ POLIS — Autonomous Prediction Market Collective

**ETH Oxford 2026 · AI Middleware Track**

POLIS is a fully autonomous prediction market system where 5 AI agents collaborate to discover opportunities, propose markets, vote via conviction consensus, deploy on-chain to Flare, and settle via Plasma — all without human intervention.

## What It Does

1. **Scout** monitors Flare FTSO v2 oracle feeds for price movements, round-number thresholds, and momentum shifts — then proposes a wide range of markets from conservative to speculative
2. **Architect** evaluates technical feasibility, question quality, and deployment capacity
3. **Oracle** reads live on-chain price data from Flare's decentralized FTSO and assesses data freshness and volatility
4. **Market Maker** evaluates liquidity viability — strike distance, duration, portfolio concentration
5. **Sentinel** assesses risk — rate limits, manipulation susceptibility, duration safety, asset concentration

Every 12 seconds, agents run a cycle. Only markets scoring ≥75 average conviction pass — speculative and low-quality proposals get rejected.

## Architecture

```
Flare FTSO v2 Oracle  →  Scout Agent  →  Conviction Consensus (≥75)  →  Architect  →  PolisFactory (Flare Coston2)
                                              ↕ reject                        ↓
                                         speculative / risky            PolisSettlement (Plasma Testnet)
```

**Two-chain design:**
- **Flare Coston2** — Market creation + FTSO price feeds + resolution
- **Plasma Testnet** — Zero-fee stablecoin settlement

## Live Deployment

| Contract | Network | Address |
|----------|---------|---------|
| PolisFactory | Flare Coston2 (Chain 114) | [`0x4487017bc1C03DFF7E8de8386467FdF6b22DD180`](https://coston2.testnet.flarescan.com/address/0x4487017bc1C03DFF7E8de8386467FdF6b22DD180) |
| PolisSettlement | Plasma Testnet (Chain 9746) | [`0x0F1dc219a80c1Fa5d345c79729930C45a6e29A56`](https://testnet.plasmascan.io/address/0x0F1dc219a80c1Fa5d345c79729930C45a6e29A56) |
| Sample Market | Flare Coston2 | [`0x8C2e7Da4Ae5E6f592b7E1bEf5dAC83FE0E693124`](https://coston2.testnet.flarescan.com/address/0x8C2e7Da4Ae5E6f592b7E1bEf5dAC83FE0E693124) |

## Tech Stack

- **Smart Contracts:** Solidity 0.8.26, OpenZeppelin, Hardhat
- **Flare Integration:** FTSO v2 for decentralized price feeds, FDC-ready for external data
- **Plasma Integration:** Zero-fee settlement layer for stablecoin payouts
- **Agent System:** Node.js, ethers.js, WebSocket real-time streaming
- **Dashboard:** Vanilla HTML/CSS/JS, CoinGecko API fallback, live WebSocket connection
- **Consensus:** Conviction voting with ≥75 threshold — speculative proposals get filtered out

## Smart Contracts

**PolisFactory.sol** — Factory pattern for deploying prediction markets. Integrates with Flare Contract Registry to read FTSO v2 feeds. Manages agent registration, market creation, and FTSO-based resolution.

**PolisMarket.sol** — Individual binary prediction market with constant-product AMM. Supports YES/NO token trading, FTSO-based auto-resolution, and fee collection.

**PolisSettlement.sol** — Cross-chain settlement on Plasma. Handles individual and batch payouts in stablecoins with agent authorization.

## Conviction Consensus

Markets aren't created by a single agent — they require collective agreement. The Scout proposes a wide range of markets from conservative to speculative. Each voting agent scores based on genuinely different criteria:

| Agent | What It Evaluates | Typical Range |
|-------|------------------|---------------|
| Architect | Feasibility, question quality, deployment capacity, scout confidence | 40–90 |
| Oracle | Data freshness, feed availability, price volatility, duration vs staleness | 35–88 |
| Market Maker | Strike distance from price, duration for fees, asset value, portfolio diversity | 25–85 |
| Sentinel | Creation rate, manipulation risk, duration safety, asset concentration | 30–85 |

Average score ≥75 → market approved. Below 75 → rejected. Speculative proposals like "Will BTC crash 15% in 30min?" or "Will FLR double in 4h?" get filtered out by the collective.

## Running Locally

```bash
cd agents
npm install
echo "PRIVATE_KEY=0xYOUR_KEY" > .env
node deploy.js    # Deploys to Flare Coston2 + Plasma Testnet
node server.js    # Starts agent orchestrator + dashboard
# Open http://localhost:3001
```

## License

MIT
