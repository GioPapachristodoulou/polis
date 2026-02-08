const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("💳 POLIS - Deploying Settlement to Plasma Testnet");
  console.log("📍 Deployer:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", hre.ethers.formatEther(balance), "XPL");

  // Deploy PolisSettlement
  console.log("\n💳 Deploying PolisSettlement...");
  const PolisSettlement = await hre.ethers.getContractFactory("PolisSettlement");
  const settlement = await PolisSettlement.deploy();
  await settlement.waitForDeployment();
  const settlementAddr = await settlement.getAddress();
  console.log("✅ PolisSettlement deployed to:", settlementAddr);

  // Authorize deployer as settlement agent
  console.log("\n🤖 Authorizing settlement agent...");
  const tx = await settlement.authorizeAgent(deployer.address);
  await tx.wait();
  console.log("✅ Deployer authorized as settlement agent");

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("💳 POLIS DEPLOYMENT SUMMARY - Plasma Testnet");
  console.log("═".repeat(60));
  console.log(`Settlement:     ${settlementAddr}`);
  console.log(`Deployer:       ${deployer.address}`);
  console.log(`Network:        Plasma Testnet (Chain ID 9746)`);
  console.log("═".repeat(60));

  // Save deployment info
  const fs = require("fs");
  const deployInfo = {
    network: "plasmaTestnet",
    chainId: 9746,
    settlement: settlementAddr,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(
    "deployments-plasma.json",
    JSON.stringify(deployInfo, null, 2)
  );
  console.log("\n📁 Deployment info saved to deployments-plasma.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
