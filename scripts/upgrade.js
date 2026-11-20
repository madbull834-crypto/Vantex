const { ethers, upgrades } = require("hardhat");

async function main() {
  const proxyAddress = process.env.VANTEX_PROXY_ADDRESS;
  if (!ethers.isAddress(proxyAddress)) {
    throw new Error("Set VANTEX_PROXY_ADDRESS to the deployed UUPS proxy address.");
  }

  const VantexCapital = await ethers.getContractFactory("VantexCapital");
  const upgraded = await upgrades.upgradeProxy(proxyAddress, VantexCapital, { kind: "uups" });
  await upgraded.waitForDeployment();
  const implementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(JSON.stringify({ proxy: proxyAddress, implementation }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
