/**
 * POLIS — Standalone Deployment Script
 * 
 * Deploys PolisFactory to Flare Coston2 and PolisSettlement to Plasma Testnet.
 * Uses pre-compiled bytecode from artifacts/. No Hardhat needed.
 * 
 * PREREQUISITES:
 *   1. Create a .env file in this directory with: PRIVATE_KEY=0xYOUR_PRIVATE_KEY
 *   2. Have C2FLR in your wallet (get from https://faucet.flare.network)
 *   3. Have XPL in your wallet (get from https://www.gas.zip/faucet/plasma)
 *
 * USAGE:
 *   cd agents
 *   npm install
 *   node deploy.js
 */

import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────
//  CONFIGURATION
// ─────────────────────────────────────────────────

const NETWORKS = {
  coston2: {
    name: "Flare Coston2 Testnet",
    rpc: "https://coston2-api.flare.network/ext/C/rpc",
    chainId: 114,
    explorer: "https://coston2.testnet.flarescan.com",
    symbol: "C2FLR",
  },
  plasma: {
    name: "Plasma Testnet",
    rpc: "https://testnet-rpc.plasma.to",
    chainId: 9746,
    explorer: "https://testnet.plasmascan.io",
    symbol: "XPL",
  },
};

// ─────────────────────────────────────────────────
//  LOAD ARTIFACTS
// ─────────────────────────────────────────────────

function loadArtifact(name) {
  const artifactPath = path.join(__dirname, "..", "artifacts", `${name}.json`);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}\nMake sure the artifacts/ folder is in the project root.`);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  if (!artifact.bytecode || artifact.bytecode === "0x") {
    throw new Error(`No bytecode in ${name}.json — contract may not be compiled.`);
  }
  return artifact;
}

// ─────────────────────────────────────────────────
//  DEPLOY FUNCTION
// ─────────────────────────────────────────────────

async function deployContract(wallet, artifact, contractName) {
  console.log(`\n🏗️  Deploying ${contractName}...`);
  console.log(`   Bytecode size: ${Math.round(artifact.bytecode.length / 2)} bytes`);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  // Estimate gas first
  const deployTx = await factory.getDeployTransaction();
  const gasEstimate = await wallet.estimateGas(deployTx);
  console.log(`   Estimated gas: ${gasEstimate.toString()}`);

  const contract = await factory.deploy();
  console.log(`   Tx hash: ${contract.deploymentTransaction().hash}`);
  console.log(`   Waiting for confirmation...`);

  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`   ✅ Deployed at: ${address}`);

  return { contract, address };
}

// ─────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(60));
  console.log("🏛️  POLIS — On-Chain Deployment");
  console.log("═".repeat(60));

  // Load private key
  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    // Try loading .env manually
    try {
      const envPath = path.join(__dirname, ".env");
      const envContent = fs.readFileSync(envPath, "utf8");
      for (const line of envContent.split("\n")) {
        const [key, ...val] = line.split("=");
        if (key.trim() === "PRIVATE_KEY") {
          privateKey = val.join("=").trim();
        }
      }
    } catch {}
  }

  if (!privateKey) {
    console.error("\n❌ PRIVATE_KEY not found.");
    console.error("   Create a file called .env in the agents/ folder with:");
    console.error("   PRIVATE_KEY=0xYOUR_METAMASK_PRIVATE_KEY\n");
    console.error("   To export from MetaMask:");
    console.error("   1. Click the ⋮ menu on your account");
    console.error("   2. Account Details → Show Private Key");
    console.error("   3. Enter your MetaMask password");
    console.error("   4. Copy the key and paste into .env\n");
    process.exit(1);
  }

  if (!privateKey.startsWith("0x")) privateKey = "0x" + privateKey;

  // Load artifacts
  console.log("\n📦 Loading compiled contracts...");
  const factoryArtifact = loadArtifact("PolisFactory");
  const settlementArtifact = loadArtifact("PolisSettlement");
  console.log("   PolisFactory: " + factoryArtifact.abi.length + " ABI entries");
  console.log("   PolisSettlement: " + settlementArtifact.abi.length + " ABI entries");

  // ═══════════════════════════════════════════════
  //  PHASE 1: Deploy PolisFactory to Flare Coston2
  // ═══════════════════════════════════════════════

  console.log("\n" + "─".repeat(60));
  console.log("⛓️  PHASE 1: Flare Coston2 — PolisFactory");
  console.log("─".repeat(60));

  const flareProvider = new ethers.JsonRpcProvider(NETWORKS.coston2.rpc, {
    name: "coston2",
    chainId: NETWORKS.coston2.chainId,
  });
  const flareWallet = new ethers.Wallet(privateKey, flareProvider);

  console.log(`   Wallet: ${flareWallet.address}`);
  const flareBalance = await flareProvider.getBalance(flareWallet.address);
  console.log(`   Balance: ${ethers.formatEther(flareBalance)} C2FLR`);

  if (flareBalance < ethers.parseEther("1")) {
    console.error("\n⚠️  Low C2FLR balance! You need at least 1 C2FLR for deployment.");
    console.error("   Get free testnet tokens: https://faucet.flare.network/");
    console.error("   Paste your address: " + flareWallet.address);
    if (flareBalance === 0n) {
      console.error("   Cannot proceed with zero balance. Exiting.");
      process.exit(1);
    }
    console.log("   Attempting deployment anyway...\n");
  }

  // Deploy PolisFactory
  const { contract: factoryContract, address: factoryAddress } =
    await deployContract(flareWallet, factoryArtifact, "PolisFactory");

  // Register deployer as orchestrator agent
  console.log("\n🤖 Registering deployer as orchestrator agent...");
  const regTx = await factoryContract.registerAgent(flareWallet.address, "orchestrator");
  await regTx.wait();
  console.log("   ✅ Agent registered");

  // Test FTSO integration
  console.log("\n📊 Testing FTSO price feed...");
  try {
    const FLR_FEED = "0x01464c522f55534400000000000000000000000000";
    const [price, decimals, timestamp] = await factoryContract.getFTSOPrice(FLR_FEED);
    const floatPrice = Number(price) / Math.pow(10, Number(decimals));
    console.log(`   ✅ FLR/USD = $${floatPrice} (decimals: ${decimals}, timestamp: ${new Date(Number(timestamp) * 1000).toISOString()})`);
  } catch (err) {
    console.log(`   ⚠️  FTSO read: ${err.message?.slice(0, 120)}`);
    console.log("   (This may work once the contract is confirmed on-chain)");
  }

  // Create a sample market
  console.log("\n🎯 Creating sample prediction market...");
  try {
    const BTC_FEED = "0x014254432f55534400000000000000000000000000";
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;
    const resolution = now + 3660;

    const createTx = await factoryContract.createMarket(
      "Will BTC be above $71,000 in 1 hour?",
      "Resolves YES if BTC/USD FTSO >= $71,000 at resolution time",
      BTC_FEED,
      71000_00, // strike with 2 decimals
      true,
      expiry,
      resolution,
      "crypto"
    );
    const receipt = await createTx.wait();
    const marketCount = await factoryContract.getMarketCount();
    const sampleMarketAddr = await factoryContract.markets(Number(marketCount) - 1);
    console.log(`   ✅ Sample market: ${sampleMarketAddr}`);
    console.log(`   📄 Tx: ${NETWORKS.coston2.explorer}/tx/${receipt.hash}`);
  } catch (err) {
    console.log(`   ⚠️  Market creation: ${err.message?.slice(0, 120)}`);
  }

  // ═══════════════════════════════════════════════
  //  PHASE 2: Deploy PolisSettlement to Plasma
  // ═══════════════════════════════════════════════

  console.log("\n" + "─".repeat(60));
  console.log("💳 PHASE 2: Plasma Testnet — PolisSettlement");
  console.log("─".repeat(60));

  const plasmaProvider = new ethers.JsonRpcProvider(NETWORKS.plasma.rpc, {
    name: "plasma-testnet",
    chainId: NETWORKS.plasma.chainId,
  });
  const plasmaWallet = new ethers.Wallet(privateKey, plasmaProvider);

  console.log(`   Wallet: ${plasmaWallet.address}`);
  const plasmaBalance = await plasmaProvider.getBalance(plasmaWallet.address);
  console.log(`   Balance: ${ethers.formatEther(plasmaBalance)} XPL`);

  if (plasmaBalance < ethers.parseEther("0.1")) {
    console.error("\n⚠️  Low XPL balance! You need XPL for deployment gas.");
    console.error("   Get free testnet tokens:");
    console.error("   • https://www.gas.zip/faucet/plasma (10 XPL/day)");
    console.error("   • https://faucets.chain.link/plasma-testnet");
    console.error("   • https://faucet.quicknode.com/plasma/testnet");
    if (plasmaBalance === 0n) {
      console.error("   Cannot proceed with zero balance. Exiting.");
      process.exit(1);
    }
    console.log("   Attempting deployment anyway...\n");
  }

  // Deploy PolisSettlement
  const { contract: settlementContract, address: settlementAddress } =
    await deployContract(plasmaWallet, settlementArtifact, "PolisSettlement");

  // Authorize deployer as settlement agent
  console.log("\n🤖 Authorizing deployer as settlement agent...");
  const authTx = await settlementContract.authorizeAgent(plasmaWallet.address);
  await authTx.wait();
  console.log("   ✅ Settlement agent authorized");

  // ═══════════════════════════════════════════════
  //  SAVE DEPLOYMENT & UPDATE CONFIG
  // ═══════════════════════════════════════════════

  const deployment = {
    timestamp: new Date().toISOString(),
    deployer: flareWallet.address,
    flare: {
      network: "Flare Coston2",
      chainId: 114,
      factory: factoryAddress,
      explorer: `${NETWORKS.coston2.explorer}/address/${factoryAddress}`,
    },
    plasma: {
      network: "Plasma Testnet",
      chainId: 9746,
      settlement: settlementAddress,
      explorer: `${NETWORKS.plasma.explorer}/address/${settlementAddress}`,
    },
  };

  // Save deployment JSON
  const deployPath = path.join(__dirname, "deployment.json");
  fs.writeFileSync(deployPath, JSON.stringify(deployment, null, 2));
  console.log(`\n📁 Deployment saved to: ${deployPath}`);

  // Update config.js with real addresses
  const configPath = path.join(__dirname, "config.js");
  if (fs.existsSync(configPath)) {
    let config = fs.readFileSync(configPath, "utf8");

    // Replace factory address placeholder
    config = config.replace(
      /factory:\s*process\.env\.FACTORY_ADDRESS\s*\|\|\s*"[^"]*"/,
      `factory: process.env.FACTORY_ADDRESS || "${factoryAddress}"`
    );

    // Replace settlement address placeholder
    config = config.replace(
      /settlement:\s*process\.env\.SETTLEMENT_ADDRESS\s*\|\|\s*"[^"]*"/,
      `settlement: process.env.SETTLEMENT_ADDRESS || "${settlementAddress}"`
    );

    fs.writeFileSync(configPath, config);
    console.log("📝 Updated config.js with deployed addresses");
  }

  // ═══════════════════════════════════════════════
  //  SUMMARY
  // ═══════════════════════════════════════════════

  console.log("\n" + "═".repeat(60));
  console.log("🏛️  POLIS — DEPLOYMENT COMPLETE");
  console.log("═".repeat(60));
  console.log(`  Deployer:       ${flareWallet.address}`);
  console.log(`  PolisFactory:   ${factoryAddress}`);
  console.log(`    → ${NETWORKS.coston2.explorer}/address/${factoryAddress}`);
  console.log(`  Settlement:     ${settlementAddress}`);
  console.log(`    → ${NETWORKS.plasma.explorer}/address/${settlementAddress}`);
  console.log("═".repeat(60));
  console.log("\n🚀 Next step: run 'node server.js' to start the live system!\n");
}

main().catch((err) => {
  console.error("\n❌ Deployment failed:", err.message);
  if (err.message.includes("insufficient funds")) {
    console.error("\n💡 You need more testnet tokens:");
    console.error("   C2FLR: https://faucet.flare.network/");
    console.error("   XPL:   https://www.gas.zip/faucet/plasma");
  }
  process.exit(1);
});
