const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🏛️  POLIS - Deploying to Flare Coston2 Testnet");
  console.log("📍 Deployer:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", hre.ethers.formatEther(balance), "C2FLR");

  // Deploy PolisFactory
  console.log("\n🏭 Deploying PolisFactory...");
  const PolisFactory = await hre.ethers.getContractFactory("PolisFactory");
  const factory = await PolisFactory.deploy();
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("✅ PolisFactory deployed to:", factoryAddr);

  // Register AI agents (using deployer as agent for demo)
  console.log("\n🤖 Registering AI Agents...");
  
  const agentTypes = ["scout", "architect", "oracle", "marketmaker", "sentinel"];
  // In production, each agent has its own wallet. For hackathon demo, 
  // we use the deployer address to simulate all agents.
  for (const agentType of agentTypes) {
    // For demo, we'll register the deployer as all agents
    // In production, each would be a separate address
  }
  
  // Register deployer as the main agent (can act as all roles for demo)
  const tx = await factory.registerAgent(deployer.address, "orchestrator");
  await tx.wait();
  console.log("✅ Registered deployer as orchestrator agent");

  // Test FTSO integration
  console.log("\n📊 Testing FTSO Price Feed Integration...");
  try {
    const FLR_USD = "0x01464c522f55534400000000000000000000000000";
    const [price, decimals, timestamp] = await factory.getFTSOPrice(FLR_USD);
    const floatPrice = Number(price) / Math.pow(10, Number(decimals));
    console.log(`✅ FLR/USD Price: $${floatPrice} (updated: ${new Date(Number(timestamp) * 1000).toISOString()})`);
  } catch (err) {
    console.log("⚠️  FTSO read failed (may need different registry on testnet):", err.message?.slice(0, 100));
  }

  // Create a sample prediction market
  console.log("\n🎯 Creating Sample Prediction Market...");
  const BTC_USD = "0x014254432f55534400000000000000000000000000";
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600; // 1 hour from now
  const resolution = now + 3660; // 1 hour + 1 minute
  
  const createTx = await factory.createMarket(
    "Will BTC be above $71,000 in 1 hour?",
    "Resolves YES if BTC/USD FTSO feed >= 71000 at resolution time",
    BTC_USD,
    71000_00, // $71,000 with 2 decimals
    true,       // isAboveStrike
    expiry,
    resolution,
    "crypto"
  );
  const receipt = await createTx.wait();
  
  // Get market address from event
  const marketCount = await factory.getMarketCount();
  const marketAddr = await factory.markets(Number(marketCount) - 1n);
  console.log("✅ Sample market deployed to:", marketAddr);

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("🏛️  POLIS DEPLOYMENT SUMMARY - Flare Coston2");
  console.log("═".repeat(60));
  console.log(`Factory:        ${factoryAddr}`);
  console.log(`Sample Market:  ${marketAddr}`);
  console.log(`Deployer:       ${deployer.address}`);
  console.log(`Network:        Flare Coston2 (Chain ID 114)`);
  console.log("═".repeat(60));

  // Save deployment info
  const fs = require("fs");
  const deployInfo = {
    network: "coston2",
    chainId: 114,
    factory: factoryAddr,
    sampleMarket: marketAddr,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(
    "deployments-flare.json",
    JSON.stringify(deployInfo, null, 2)
  );
  console.log("\n📁 Deployment info saved to deployments-flare.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
