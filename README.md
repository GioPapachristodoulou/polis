# 🏛️ POLIS — Autonomous Prediction Market Collective

**ETH Oxford 2026 · AI Middleware Track**

POLIS is a fully autonomous prediction market system where 5 AI agents collaborate to discover opportunities, propose markets, vote via conviction consensus, deploy on-chain to Flare, and settle via Plasma — all without human intervention.

## What It Does

1. **Scout** monitors Flare FTSO v2 oracle feeds for price movements and anomalies
2. **Architect** designs binary prediction markets from Scout's discoveries  
3. **Oracle** reads live on-chain price data from Flare's decentralized FTSO
4. **Market Maker** provides algorithmic liquidity using a constant-product AMM
5. **Sentinel** assesses risk, enforces rate limits, and acts as a circuit breaker

Every 12 seconds, the agents run a cycle: fetch prices → propose markets → vote with conviction scoring → deploy approved markets → provide liquidity.

## Architecture

```
Flare FTSO v2 Oracle  →  Scout Agent  →  Conviction Consensus  →  Architect  →  PolisFactory (Flare Coston2)
                                                                        ↓
                                                                 PolisSettlement (Plasma Testnet)
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
- **Consensus:** Conviction voting with configurable threshold (≥60 to approve)

## Smart Contracts

**PolisFactory.sol** (325 lines) — Factory pattern for deploying prediction markets. Integrates with Flare Contract Registry to read FTSO v2 feeds. Manages agent registration, market creation, and FTSO-based resolution.

**PolisMarket.sol** — Individual binary prediction market with constant-product AMM. Supports YES/NO token trading, FTSO-based auto-resolution, and fee collection.

**PolisSettlement.sol** (246 lines) — Cross-chain settlement on Plasma. Handles individual and batch payouts in stablecoins with agent authorization.

## Running Locally

```bash
cd agents
npm install
echo "PRIVATE_KEY=0xYOUR_KEY" > .env
node deploy.js    # Deploys to Flare Coston2 + Plasma Testnet
node server.js    # Starts agent orchestrator + dashboard
# Open http://localhost:3001
```

## Conviction Consensus

Markets aren't created by a single agent — they require collective agreement:

| Agent | Role in Voting | Typical Score Range |
|-------|---------------|-------------------|
| Architect | Technical feasibility | 75–91 |
| Oracle | Data confidence | 90–95 |
| Market Maker | Liquidity viability | 50–60 |
| Sentinel | Risk assessment | 35–80 |

Average score ≥60 → market approved and deployed.

## License

MIT
