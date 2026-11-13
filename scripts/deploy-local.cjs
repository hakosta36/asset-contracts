const { ethers } = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../config/assets.json');

async function main() {
  if ((await ethers.provider.getNetwork()).chainId !== 31337n)
    throw new Error('Local deployment only');
  const [owner, trader] = await ethers.getSigners();
  const settlement = await (await ethers.getContractFactory('MockSettlement')).deploy(18);
  const Feed = await ethers.getContractFactory('MockFeed');
  const stable = await Feed.deploy(8, 100000000);
  const native = await Feed.deploy(8, 60000000000n);
  const config = (feed) => [
    feed.target,
    86400,
    ethers.parseEther('0.01'),
    ethers.parseEther('1000000'),
  ];
  const assets = [];
  for (const { localPrice, ...metadata } of catalog) {
    const feed = await Feed.deploy(8, ethers.parseUnits(localPrice, 8));
    const asset = await (
      await ethers.getContractFactory('OracleAsset')
    ).deploy(
      metadata.name,
      metadata.symbol,
      owner.address,
      settlement.target,
      config(feed),
      config(stable),
      config(native),
      ethers.parseEther('1000000'),
      15000,
    );
    await settlement.mint(owner.address, ethers.parseEther('1000000'));
    await settlement.approve(asset.target, ethers.parseEther('1000000'));
    await asset.fundReserve(ethers.parseEther('1000000'));
    await asset.setTradingEnabled(true);
    assets.push({ ...metadata, address: asset.target });
  }
  await settlement.mint(trader.address, ethers.parseEther('100000'));
  await settlement.mint(owner.address, ethers.parseEther('100000'));
  const deployment = {
    chainId: 31337,
    settlementToken: settlement.target,
    settlementDecimals: 18,
    assets,
  };
  const target = path.join(__dirname, '..', 'deployments', 'localhost.local.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(deployment, null, 2) + '\n');
  console.log(`Deployed ${assets.length} local markets. Manifest: ${target}`);
  console.log(
    'Mock prices are fixed fixtures, not market data. Restart/redeploy after their one-day expiry.',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
