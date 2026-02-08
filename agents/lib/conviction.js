/**
 * POLIS Internal Conviction Market
 * 
 * Before any major action (deploying a market, adjusting liquidity, resolving),
 * agents stake conviction on proposed actions. This creates emergent collective
 * intelligence with built-in checks and balances.
 */

export class ConvictionMarket {
  constructor() {
    this.proposals = new Map();
    this.history = [];
  }

  /**
   * Submit a new proposal for agent consensus
   */
  createProposal(id, proposer, action, details) {
    const proposal = {
      id,
      proposer,
      action, // "create_market", "resolve_market", "adjust_liquidity", "halt"
      details,
      votes: new Map(),
      createdAt: Date.now(),
      status: "open", // open, approved, rejected
      threshold: 60, // minimum avg score to approve
      minVoters: 3,
    };
    this.proposals.set(id, proposal);
    return proposal;
  }

  /**
   * An agent casts a conviction vote (0-100)
   */
  vote(proposalId, agentName, score, reasoning) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== "open") return null;

    proposal.votes.set(agentName, {
      score,
      reasoning,
      timestamp: Date.now(),
    });

    return this.evaluate(proposalId);
  }

  /**
   * Evaluate if a proposal has reached consensus
   */
  evaluate(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return null;

    const votes = Array.from(proposal.votes.values());
    if (votes.length < proposal.minVoters) {
      return {
        status: "pending",
        votesReceived: votes.length,
        votesNeeded: proposal.minVoters,
        currentAvg: votes.length > 0
          ? votes.reduce((s, v) => s + v.score, 0) / votes.length
          : 0,
      };
    }

    const avgScore = votes.reduce((s, v) => s + v.score, 0) / votes.length;
    const approved = avgScore >= proposal.threshold;

    proposal.status = approved ? "approved" : "rejected";

    const result = {
      proposalId,
      status: proposal.status,
      avgScore: Math.round(avgScore * 10) / 10,
      voterCount: votes.length,
      votes: Object.fromEntries(
        Array.from(proposal.votes.entries()).map(([name, v]) => [
          name,
          { score: v.score, reasoning: v.reasoning },
        ])
      ),
      approved,
    };

    this.history.push(result);
    return result;
  }

  getProposal(id) {
    return this.proposals.get(id);
  }

  getHistory() {
    return this.history;
  }

  getOpenProposals() {
    return Array.from(this.proposals.values()).filter(
      (p) => p.status === "open"
    );
  }
}
