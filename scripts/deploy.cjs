const { ethers } = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  if ((await ethers.provider.getNetwork()).chainId !== 97n) throw new Error('BSC testnet only');
  const file = process.env.DEPLOYMENT_CONFIG;
  if (!file) throw new Error('Set DEPLOYMENT_CONFIG to a reviewed JSON configuration');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { owner, settlementToken, settlementDecimals, assets } = config;
  if (
    !ethers.isAddress(owner) ||
    !ethers.isAddress(settlementToken) ||
    !Array.isArray(assets) ||
    !assets.length
  )
    throw new Error('Invalid deployment configuration');
  const token = await ethers.getContractAt('IERC20Metadata', settlementToken);
  if (Number(await token.decimals()) !== settlementDecimals)
    throw new Error('Settlement precision mismatch');
  const deployed = [];
  for (const market of assets) {
    const feedConfig = (feed) => [
      feed.address,
      feed.maxAge,
      ethers.parseEther(feed.minPrice),
      ethers.parseEther(feed.maxPrice),
    ];
    const asset = await (
      await ethers.getContractFactory('OracleAsset')
    ).deploy(
      market.name,
      market.symbol,
      owner,
      settlementToken,
      feedConfig(market.assetFeed),
      feedConfig(market.settlementFeed),
      feedConfig(market.nativeFeed),
      ethers.parseEther(market.supplyCap),
      market.reserveRatioBps,
    );
    await asset.waitForDeployment();
    // Validate live data before recording a market; trading remains closed.
    await Promise.all([asset.assetPriceUsd(), asset.settlementPriceUsd(), asset.nativePriceUsd()]);
    deployed.push({
      id: market.id,
      name: market.name,
      symbol: market.symbol,
      category: market.category,
      address: asset.target,
    });
    const partial = { chainId: 97, settlementToken, settlementDecimals, assets: deployed };
    fs.mkdirSync(path.join(__dirname, '..', 'deployments'), { recursive: true });
    fs.writeFileSync(
      path.join(__dirname, '..', 'deployments', 'bsc-testnet.json'),
      JSON.stringify(partial, null, 2) + '\n',
    );
    console.log(`Deployed closed market ${market.id}: ${asset.target}`);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
