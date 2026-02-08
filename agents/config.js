import dotenv from "dotenv";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "../.env") });

// ═══════════════════════════════════════════════════════════════════
//                      NETWORK CONFIG
// ═══════════════════════════════════════════════════════════════════

export const NETWORKS = {
  flare: {
    name: "Flare Coston2",
    rpc: "https://coston2-api.flare.network/ext/C/rpc",
    chainId: 114,
    explorer: "https://coston2-explorer.flare.network",
  },
  plasma: {
    name: "Plasma Testnet",
    rpc: "https://testnet-rpc.plasma.to",
    chainId: 9746,
    explorer: "https://testnet.plasmascan.to",
  },
};

// ═══════════════════════════════════════════════════════════════════
//                      CONTRACT ADDRESSES
// ═══════════════════════════════════════════════════════════════════

// These get populated after deployment
export const CONTRACTS = {
  factory: process.env.FACTORY_ADDRESS || "",
  settlement: process.env.SETTLEMENT_ADDRESS || "",
};

// ═══════════════════════════════════════════════════════════════════
//                       FTSO FEED IDS
// ═══════════════════════════════════════════════════════════════════

export const FEED_IDS = {
  "FLR/USD": "0x01464c522f55534400000000000000000000000000",
  "BTC/USD": "0x014254432f55534400000000000000000000000000",
  "ETH/USD": "0x014554482f55534400000000000000000000000000",
  "XRP/USD": "0x015852502f55534400000000000000000000000000",
  "DOGE/USD": "0x01444f47452f555344000000000000000000000000",
  "ADA/USD": "0x014144412f55534400000000000000000000000000",
  "AVAX/USD": "0x01415641582f555344000000000000000000000000",
  "SOL/USD": "0x01534f4c2f55534400000000000000000000000000",
};

export const FEED_NAMES = Object.fromEntries(
  Object.entries(FEED_IDS).map(([k, v]) => [v, k])
);

// ═══════════════════════════════════════════════════════════════════
//                       ABIS (minimal)
// ═══════════════════════════════════════════════════════════════════

export const FACTORY_ABI = [
  "function createMarket(string,string,bytes21,uint256,bool,uint256,uint256,string) external returns (address)",
  "function resolveMarket(address) external",
  "function recordConviction(address,uint8) external",
  "function registerAgent(address,string) external",
  "function getFTSOPrice(bytes21) external view returns (uint256,int8,uint64)",
  "function getFTSOPrices(bytes21[]) external view returns (uint256[],int8[],uint64)",
  "function getMarketCount() external view returns (uint256)",
  "function markets(uint256) external view returns (address)",
  "function getAllMarkets() external view returns (address[])",
  "function getActiveMarkets() external view returns (address[])",
  "function hasConsensus(address) external view returns (bool,uint256)",
  "function agents(address) external view returns (string,bool,uint256,uint256)",
  "event MarketCreated(address indexed market, string question, bytes21 feedId, uint256 strikePrice, uint256 expiryTimestamp, address indexed createdBy)",
  "event MarketResolved(address indexed market, uint8 outcome, uint256 resolvedPrice)",
  "event ConvictionConsensus(address indexed market, uint256 avgConviction, uint256 voterCount, bool approved)",
];

export const MARKET_ABI = [
  "function question() external view returns (string)",
  "function feedId() external view returns (bytes21)",
  "function strikePrice() external view returns (uint256)",
  "function expiryTimestamp() external view returns (uint256)",
  "function resolutionTimestamp() external view returns (uint256)",
  "function outcome() external view returns (uint8)",
  "function getYesPrice() external view returns (uint256)",
  "function getNoPrice() external view returns (uint256)",
  "function yesPool() external view returns (uint256)",
  "function noPool() external view returns (uint256)",
  "function totalDeposited() external view returns (uint256)",
  "function category() external view returns (string)",
  "function getMarketInfo() external view returns (string,bytes21,uint256,uint256,uint8,uint256,uint256,uint256,string,uint8)",
  "function getPosition(address) external view returns (uint256,uint256)",
  "function getAggregateConviction() external view returns (uint256,uint256)",
  "function buyShares(bool,uint256) external payable",
  "function sellShares(bool,uint256,uint256) external",
  "function redeem() external",
  "event SharesPurchased(address indexed buyer, bool isYes, uint256 shares, uint256 cost)",
  "event MarketResolved(uint8 outcome, uint256 resolvedPrice)",
];

export const SETTLEMENT_ABI = [
  "function settle(address,address,uint256,address,string) external returns (uint256)",
  "function batchSettle(address,address[],uint256[],address) external returns (uint256)",
  "function whitelistToken(address) external",
  "function authorizeAgent(address) external",
  "function getSettlementCount() external view returns (uint256)",
  "function getUserEarnings(address) external view returns (uint256)",
  "event SettlementCompleted(uint256 indexed id, address indexed recipient, uint256 amount)",
];

// ═══════════════════════════════════════════════════════════════════
//                     AGENT CONFIG
// ═══════════════════════════════════════════════════════════════════

export const AGENT_CONFIG = {
  scout: {
    name: "Scout",
    emoji: "🔍",
    color: "#3B82F6",
    scanIntervalMs: 15_000, // Check for events every 15s
  },
  architect: {
    name: "Architect",
    emoji: "🏗️",
    color: "#8B5CF6",
  },
  oracle: {
    name: "Oracle",
    emoji: "🔮",
    color: "#F59E0B",
    priceCheckIntervalMs: 10_000,
  },
  marketmaker: {
    name: "Market Maker",
    emoji: "💹",
    color: "#10B981",
    liquidityAmount: "0.01", // ETH per market
  },
  sentinel: {
    name: "Sentinel",
    emoji: "🛡️",
    color: "#EF4444",
    riskThreshold: 70, // Max risk score before blocking
  },
};

export const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
