import bus, { EVENTS } from "./eventbus.js";

/**
 * Internal Conviction Market — The core innovation of POLIS.
 *
 * Before any major action (deploying a market, resolving, adjusting liquidity),
 * agents don't just vote — they stake conviction scores (0-100) on proposed
 * actions. This creates emergent collective intelligence with built-in checks.
 *
 * Flow:
 * 1. An agent proposes an action (e.g., Scout proposes a new market)
 * 2. Other agents evaluate and submit conviction scores
 * 3. Once enough agents vote, consensus is calculated
 * 4. If consensus >= threshold, the action is approved
 */
export class ConvictionMarket {
  constructor() {
    /** @type {Map<string, Proposal>} */
    this.proposals = new Map();
    this.history = [];
    this.consensusThreshold = 60; // Average score must be >= 60
    this.minVoters = 4; // All 4 non-proposer agents must vote // At least 3 agents must vote
  }

  /**
   * Create a new proposal for agents to vote on
   */
  createProposal(id, type, data, proposer) {
    const proposal = {
      id,
      type, // "create_market", "resolve_market", "adjust_liquidity"
      data,
      proposer,
      votes: new Map(),
      status: "pending", // pending, approved, rejected, expired
      createdAt: Date.now(),
      resolvedAt: null,
      consensus: null,
    };

    this.proposals.set(id, proposal);

    bus.publish(EVENTS.SYSTEM_LOG, {
      agent: proposer,
      message: `Proposal created: ${type} — "${data.question || data.reason || id}"`,
      proposalId: id,
    });

    return proposal;
  }

  /**
   * Submit a conviction vote on a proposal
   * @param {string} proposalId
   * @param {string} agentName - Name of the voting agent
   * @param {number} score - Conviction score 0-100
   * @param {string} reasoning - Why this score
   */
  vote(proposalId, agentName, score, reasoning) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== "pending") return null;

    score = Math.max(0, Math.min(100, Math.round(score)));

    proposal.votes.set(agentName, {
      score,
      reasoning,
      timestamp: Date.now(),
    });

    bus.publish(EVENTS.CONVICTION_VOTE, {
      proposalId,
      agent: agentName,
      score,
      reasoning,
      totalVotes: proposal.votes.size,
      type: proposal.type,
    });

    // Check if we have enough votes for consensus
    if (proposal.votes.size >= this.minVoters) {
      return this.resolveConsensus(proposalId);
    }

    return { status: "pending", votesNeeded: this.minVoters - proposal.votes.size };
  }

  /**
   * Calculate consensus from all votes
   */
  resolveConsensus(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return null;

    const votes = Array.from(proposal.votes.values());
    const avgScore = votes.reduce((sum, v) => sum + v.score, 0) / votes.length;
    const approved = avgScore >= this.consensusThreshold;

    proposal.status = approved ? "approved" : "rejected";
    proposal.resolvedAt = Date.now();
    proposal.consensus = {
      avgScore: Math.round(avgScore * 10) / 10,
      voterCount: votes.length,
      approved,
      votes: Object.fromEntries(
        Array.from(proposal.votes.entries()).map(([agent, v]) => [
          agent,
          { score: v.score, reasoning: v.reasoning },
        ])
      ),
    };

    this.history.push({ ...proposal, votes: proposal.consensus.votes });

    bus.publish(EVENTS.CONVICTION_CONSENSUS, {
      proposalId,
      type: proposal.type,
      avgScore: proposal.consensus.avgScore,
      voterCount: proposal.consensus.voterCount,
      approved,
      votes: proposal.consensus.votes,
      data: proposal.data,
    });

    return proposal.consensus;
  }

  /**
   * Get a proposal by ID
   */
  getProposal(id) {
    return this.proposals.get(id);
  }

  /**
   * Get all pending proposals
   */
  getPending() {
    return Array.from(this.proposals.values()).filter(
      (p) => p.status === "pending"
    );
  }

  /**
   * Get consensus history
   */
  getHistory(count = 20) {
    return this.history.slice(-count);
  }
}

export const convictionMarket = new ConvictionMarket();
export default convictionMarket;
