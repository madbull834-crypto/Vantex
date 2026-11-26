const { ethers, upgrades } = require("hardhat");

async function main() {
  const proxyAddress = process.env.VANTEX_PROXY_ADDRESS;
  if (!ethers.isAddress(proxyAddress)) {
    throw new Error("Set VANTEX_PROXY_ADDRESS to the deployed UUPS proxy address.");
  }

  const VantexCapital = await ethers.getContractFactory("VantexCapital");
  // Always deploy the implementation compiled from the current source. This avoids accidentally
  // reusing a stale manifest entry when an earlier implementation has a matching validation hash.
  const upgraded = await upgrades.upgradeProxy(proxyAddress, VantexCapital, {
    kind: "uups",
    redeployImplementation: "always"
  });
  const upgradeTransaction = upgraded.deployTransaction ?? upgraded.deploymentTransaction();
  if (!upgradeTransaction) throw new Error("The upgrade transaction is unavailable.");
  await upgradeTransaction.wait();
  const implementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(JSON.stringify({
    proxy: proxyAddress,
    implementation,
    upgradeTransaction: upgradeTransaction.hash
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
