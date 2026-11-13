# Oracle Asset Contracts

ERC-20 synthetic assets priced by USD oracle feeds and redeemed from a dedicated settlement-token reserve. Each market is an independent `OracleAsset` deployment; gold, silver and eight equity references share the same implementation.

I consolidated the asset-specific contracts because their accounting and security rules were identical. Asset identity belongs in deployment configuration, while price validation and settlement logic should have one implementation to review.

## Run locally

Use Node.js 22.23.4 and npm 10 or later.

```sh
npm ci
npm test
npm run test:coverage
npm run compile
npm run export:abi
npm run node
```

In another terminal:

```sh
npm run deploy:local
```

This deploys ten markets, a test settlement token and fixed-price mock feeds on chain 31337. It funds each reserve, opens local trading and gives the first two development accounts test settlement tokens. Mock feeds expire after one day; restart and redeploy the local chain when necessary. Development accounts and mocks must never be used on a public network.

## Design

- **OpenZeppelin ERC20 / SafeERC20:** standard token accounting and safe handling of tokens whose transfer functions omit a return value. Exact balance-delta checks reject transfer-tax behavior. Rebasing collateral is unsupported.
- **Three independent feeds:** asset/USD, settlement/USD and native/USD. Settlement tokens are priced rather than assumed to retain a dollar peg. Each feed has immutable freshness and price bounds, supplied at deployment.
- **Bounded execution:** every trade carries a minimum output and deadline. Quotes round down; reserve requirements round up using `Math.mulDiv`.
- **Funded issuance:** stablecoin and native purchases must leave settlement reserves above an immutable admission ratio. Native proceeds do not count as settlement liquidity. Reserve funding is permissionless; surplus withdrawal is owner-only and cannot cross the current buffered requirement.
- **Explicit operations:** markets start closed. A two-step owner controls the session gate and emergency pause. ERC-20 transfers and reserve funding remain available during a trade pause. There is no proxy, arbitrary mint function or oracle replacement function.

The Solidity compiler is pinned to 0.8.30, with optimization and the Paris EVM target. I use a local `solc` package so compilation does not depend on downloading a compiler at build time. Paris avoids relying on newer opcodes when targeting EVM networks; confirm target-chain compatibility before deployment.

## Contract interface

| Method                                                | Behavior                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| `buy(amount, minOut, deadline)`                       | Transfer settlement tokens and mint asset tokens                      |
| `buyWithNative(minOut, deadline)`                     | Accept native currency and mint against prefunded settlement capacity |
| `redeem(amount, minOut, deadline)`                    | Burn asset tokens and pay settlement tokens                           |
| `previewBuy`, `previewBuyWithNative`, `previewRedeem` | Price-only estimates; do not promise trade eligibility or liquidity   |
| `requiredReserve(supply)`                             | Current buffered liability in settlement base units                   |
| `fundReserve(amount)`                                 | Add settlement liquidity without minting                              |
| `withdrawSurplus(recipient, amount)`                  | Withdraw settlement funds only above the current buffer               |

Asset tokens use 18 decimals. Settlement tokens and feeds support 0–18 decimals. All feed bounds are USD prices scaled to 18 decimals, regardless of the feed's native precision. Events record purchases, redemptions, reserve operations and market-session changes. The generated ABI is committed under `abi/` for consumers.

## Connect the exchange

In the [companion exchange repository](https://github.com/hakosta36/asset-dex), run `npm run sync:contracts` after exporting this ABI. Set `CONTRACTS_DIR` if the repositories are not siblings. Set `DEPLOYMENT_FILE` to an absolute deployment-manifest path to import addresses as well. Local manifests are intentionally ignored by Git.

This is a new deployment interface. It is **not ABI-compatible** with the earlier `buyWithUSDT` / `sellForUSDT` contracts. There is no automatic upgrade or migration of existing balances. See [migration notes](docs/migration.md).

## Security and operating limits

These tokens provide synthetic price exposure, not ownership or custody of securities or commodities. A current-price reserve buffer is not a hedge: price appreciation, a collateral depeg or issuer failure can exhaust liquidity. Redemptions pay in full when sufficient liquidity exists and otherwise revert; they are not queued or prorated. Early redemptions can therefore consume liquidity before later holders. The owner must monitor exposure and fund reserves.

Oracle freshness alone does not establish an open underlying market or a fair executable price. The owner must operate the session gate around market hours, holidays, halts and corporate actions. Feed latency can still create arbitrage. The contract does not contain a calendar, hedging engine, liquidation mechanism or delayed settlement. It has not received an independent audit or live BSC validation.

See [security model](SECURITY.md), [deployment and operations](docs/operations.md), and [verification record](docs/validation.md). Feed selection follows [Chainlink's selection guidance](https://docs.chain.link/data-feeds/selecting-data-feeds); implementation choices follow [OpenZeppelin](https://docs.openzeppelin.com/contracts/5.x/) and [Solidity's security guidance](https://docs.soliditylang.org/en/latest/security-considerations.html).
