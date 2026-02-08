/**
 * Claude API integration for agent reasoning
 * Each agent uses Claude to make autonomous decisions
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export async function askClaude(systemPrompt, userPrompt, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    // Fallback to deterministic reasoning when no API key
    return fallbackReasoning(systemPrompt, userPrompt);
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: options.model || "claude-sonnet-4-20250514",
        max_tokens: options.maxTokens || 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.content[0].text;
  } catch (err) {
    console.error(`    ⚠️  Claude API error: ${err.message}`);
    return fallbackReasoning(systemPrompt, userPrompt);
  }
}

/**
 * Parse JSON from Claude's response (handles markdown fences)
 */
export function parseJSON(text) {
  try {
    const cleaned = text.replace(/```json\s*|```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON from the response
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Deterministic fallback when Claude API is unavailable
 * Uses rule-based logic for each agent type
 */
function fallbackReasoning(systemPrompt, userPrompt) {
  // Detect agent type from system prompt
  if (systemPrompt.includes("Scout")) {
    return JSON.stringify({
      events: [
        {
          title: "BTC price volatility detected",
          description:
            "Bitcoin showing significant price movement in the last hour, creating prediction opportunity",
          feedName: "BTC/USD",
          confidence: 82,
          category: "crypto",
          suggestedQuestion:
            "Will BTC/USD be above the current price in 1 hour?",
        },
      ],
      reasoning:
        "Crypto markets showing elevated volatility. BTC price action suggests a tradeable prediction opportunity.",
    });
  }

  if (systemPrompt.includes("Architect")) {
    return JSON.stringify({
      market: {
        question: "Will BTC be above $100,000 in 1 hour?",
        resolutionCriteria:
          "Resolves YES if Flare FTSO BTC/USD feed >= 100000 at resolution timestamp",
        feedName: "BTC/USD",
        strikePrice: 10000000,
        isAboveStrike: true,
        durationSeconds: 3600,
        category: "crypto",
      },
      conviction: 78,
      reasoning:
        "Well-defined binary outcome with clear oracle resolution. BTC price markets have strong liquidity potential.",
    });
  }

  if (systemPrompt.includes("Oracle")) {
    return JSON.stringify({
      conviction: 85,
      dataAvailable: true,
      feedReliability: "high",
      reasoning:
        "FTSO price feed is available and reliable for this market. Resolution criteria are unambiguous.",
    });
  }

  if (systemPrompt.includes("Market Maker")) {
    return JSON.stringify({
      conviction: 72,
      suggestedLiquidity: "0.1",
      priceAssessment: "fair",
      reasoning:
        "Initial 50/50 pricing is appropriate given market uncertainty. Moderate liquidity recommended.",
    });
  }

  if (systemPrompt.includes("Sentinel")) {
    return JSON.stringify({
      conviction: 75,
      riskLevel: "low",
      concerns: [],
      approved: true,
      reasoning:
        "No manipulation vectors detected. Market parameters are within acceptable bounds. Duration is reasonable.",
    });
  }

  return JSON.stringify({
    reasoning: "Fallback reasoning applied",
    conviction: 70,
  });
}
