/**
 * POLIS Demo — Run this to see the full agent system in action.
 * No wallet needed. Uses simulated prices.
 * 
 * Usage: node demo.js
 */
import Orchestrator from "./orchestrator.js";

const orchestrator = new Orchestrator();

// Run 5 cycles then show summary
async function runDemo() {
  console.log("\n🏛️  POLIS DEMO — Watch 5 autonomous cycles\n");
  
  for (let i = 0; i < 5; i++) {
    await orchestrator.runCycle();
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 DEMO SUMMARY");
  console.log("=".repeat(60));
  
  const state = orchestrator.getState();
  console.log(`Cycles completed: ${state.cycleCount}`);
  console.log(`Markets deployed: ${state.deployedMarkets.length}`);
  console.log(`Conviction votes: ${state.convictionHistory.length}`);
  console.log(`Price feeds active: ${Object.keys(state.prices).length}`);
  console.log(`Sentinel alerts: ${state.agents.sentinel.alertCount}`);
  
  console.log("\nDeployed Markets:");
  for (const m of state.deployedMarkets) {
    console.log(`  • "${m.question}"`);
    console.log(`    Address: ${m.marketAddress?.slice(0, 20)}...`);
  }
  
  console.log("\nConviction History:");
  for (const c of state.convictionHistory.slice(-5)) {
    const status = c.consensus?.approved ? "✅ APPROVED" : "❌ REJECTED";
    console.log(`  ${status} (avg: ${c.consensus?.avgScore}) "${c.data?.question?.slice(0, 50)}..."`);
  }
  
  console.log("\n🏛️  Demo complete. Run 'node server.js' for the full dashboard experience.\n");
  process.exit(0);
}

runDemo().catch(console.error);
