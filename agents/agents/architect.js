import { ethers } from "ethers";
import bus, { EVENTS } from "../eventbus.js";
import { AGENT_CONFIG, NETWORKS, CONTRACTS, FACTORY_ABI } from "../config.js";
import convictionMarket from "../conviction.js";

const CFG = AGENT_CONFIG.architect;

/**
 * Architect Agent — Designs market parameters and deploys contracts.
 * When a proposal reaches consensus, the Architect deploys it on-chain.
 */
export class ArchitectAgent {
  constructor(wallet) {
    this.wallet = wallet;
    this.factory = null;
    this.deployedCount = 0;
    this.status = "idle";

    if (wallet && CONTRACTS.factory) {
      const provider = new ethers.JsonRpcProvider(NETWORKS.flare.rpc);
      const signer = new ethers.Wallet(wallet, provider);
      this.factory = new ethers.Contract(CONTRACTS.factory, FACTORY_ABI, signer);
    }
  }

  /**
   * Vote on a proposal with design feasibility assessment
   */
  voteOnProposal(proposalId) {
    const proposal = convictionMarket.getProposal(proposalId);
    if (!proposal || proposal.type !== "create_market") return;

    const data = proposal.data;
    let score = 40;
    let reasoning = "";

    // Assess feasibility
    if (data.feedId && data.strikePrice > 0) {
      score += 15;
      reasoning += "Valid feed and strike. ";
    }

    // Duration assessment — more granular
    if (data.durationMinutes >= 30 && data.durationMinutes <= 90) {
      score += 15;
      reasoning += "Ideal duration for deployment. ";
    } else if (data.durationMinutes >= 15 && data.durationMinutes <= 180) {
      score += 8;
      reasoning += "Acceptable duration. ";
    } else if (data.durationMinutes > 180) {
      score += 3;
      reasoning += "Long duration — higher gas cost risk. ";
    } else {
      score -= 5;
      reasoning += "Very short duration. ";
    }

    // Scout confidence
    if (data.confidence >= 80) {
      score += 18;
      reasoning += `High scout confidence: ${data.confidence}%. `;
    } else if (data.confidence >= 60) {
      score += 10;
      reasoning += `Moderate scout confidence: ${data.confidence}%. `;
    } else if (data.confidence >= 40) {
      score += 3;
      reasoning += `Low scout confidence: ${data.confidence}%. `;
    }

    // Question complexity — longer, more specific questions are better
    const qLen = (data.question || "").length;
    if (qLen > 50) {
      score += 8;
      reasoning += "Well-formed question. ";
    } else if (qLen > 30) {
      score += 3;
      reasoning += "Adequate question. ";
    }

    // Market saturation — penalize if many markets deployed
    if (this.deployedCount > 15) {
      score -= 12;
      reasoning += "High market density — deployment fatigue. ";
    } else if (this.deployedCount > 8) {
      score -= 5;
      reasoning += "Moderate market density. ";
    } else {
      score += 5;
      reasoning += "Low density — capacity available. ";
    }

    // Uniqueness — is this a different asset from recent deploys?
    const isAbove = data.question?.includes("above") || data.question?.includes("break") || data.question?.includes("gain");
    if (isAbove) {
      score += 3;
      reasoning += "Bullish market adds diversity. ";
    }

    // Per-proposal variance from content
    const seed = (data.question || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    score += ((seed * 17) % 13) - 6; // -6 to +6

    score = Math.max(10, Math.min(95, score));
    reasoning = reasoning.trim() || "Standard assessment.";

    bus.publish(EVENTS.AGENT_STATUS, {
      agent: CFG.name, emoji: CFG.emoji, status: "evaluating",
      detail: `Assessing: "${data.question?.slice(0, 40)}..."`,
    });

    return convictionMarket.vote(proposalId, CFG.name, score, reasoning);
  }

  /**
   * Deploy an approved market on-chain
   */
  async deployMarket(proposalData) {
    this.status = "deploying";
    bus.publish(EVENTS.AGENT_STATUS, {
      agent: CFG.name, emoji: CFG.emoji, status: "deploying",
      detail: `Deploying: "${proposalData.question?.slice(0, 40)}..."`,
    });

    const now = Math.floor(Date.now() / 1000);
    const expiryTimestamp = now + (proposalData.durationMinutes || 60) * 60;
    const resolutionTimestamp = expiryTimestamp + 60;

    // If we have a live factory contract, deploy on-chain
    if (this.factory) {
      try {
        const tx = await this.factory.createMarket(
          proposalData.question,
          proposalData.resolutionCriteria,
          proposalData.feedId,
          proposalData.strikePrice,
          proposalData.isAboveStrike,
          expiryTimestamp,
          resolutionTimestamp,
          proposalData.category || "crypto"
        );
        const receipt = await tx.wait();
        const marketCount = await this.factory.getMarketCount();
        const marketAddr = await this.factory.markets(Number(marketCount) - 1n);

        this.deployedCount++;
        this.status = "idle";

        const result = {
          marketAddress: marketAddr,
          txHash: receipt.hash,
          question: proposalData.question,
          feedId: proposalData.feedId,
          strikePrice: proposalData.strikePrice,
          expiryTimestamp,
          onChain: true,
        };

        bus.publish(EVENTS.MARKET_DEPLOYED, {
          agent: CFG.name, emoji: CFG.emoji, ...result,
        });

        return result;
      } catch (err) {
        bus.publish(EVENTS.ERROR, {
          agent: CFG.name, message: `Deploy failed: ${err.message?.slice(0, 100)}`,
        });
      }
    }

    // Simulated deployment (when no wallet/contract configured)
    this.deployedCount++;
    this.status = "idle";
    const simResult = {
      marketAddress: `0x${Buffer.from(proposalData.question.slice(0, 20)).toString("hex").padEnd(40, "0")}`,
      txHash: `0x${"sim".padEnd(64, "0")}`,
      question: proposalData.question,
      feedId: proposalData.feedId,
      strikePrice: proposalData.strikePrice,
      expiryTimestamp,
      onChain: false,
      simulated: true,
    };

    bus.publish(EVENTS.MARKET_DEPLOYED, {
      agent: CFG.name, emoji: CFG.emoji, ...simResult,
    });

    return simResult;
  }
}
export default ArchitectAgent;
