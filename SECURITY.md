# Security model

## Trust boundaries

The deployer selects the settlement token, all three oracle proxies, independent maximum ages and price bounds, supply cap, reserve ratio and initial owner. These economic settings cannot be changed after deployment. Code existence and decimal precision do not prove that a feed represents the intended asset: feed identity, denomination, heartbeat, methodology and network must be checked separately.

The owner can open/close trades, pause trades, withdraw native proceeds and withdraw settlement surplus at current valid prices. Use a multisig as the production owner. Ownership transfer requires acceptance; renunciation is disabled to avoid abandoning market operations. Closing a session or pausing also blocks redemptions, so owner availability and integrity are material risks. Ordinary token transfers remain possible. There is no upgrade administrator.

## Enforced properties

1. Only purchase functions mint. Successful issuance respects the supply cap and current buffered settlement liability.
2. Redemption burns the caller's tokens and pays settlement tokens atomically. A failed transfer rolls back the burn.
3. Settlement withdrawals leave the current buffered requirement intact. A stale feed blocks withdrawals as well as trades that depend on it.
4. Price-dependent paths reject nonpositive answers, missing rounds, missing/future timestamps, excessive age, unsupported precision and out-of-range normalized prices.
5. All fund-moving entry points are guarded against reentrancy. External token calls are treated as interactions with untrusted code. Only vetted, nonrebasing settlement tokens are supported.
6. Outputs round down. Aggregate reserve liabilities round up. The ratio is fixed between 100% and 500%; the example uses 150%, not a universally safe parameter.

The `answeredInRound` output is intentionally unused: it is deprecated for modern Chainlink feeds. This interface assumes modern timestamp-based feeds; adapting older aggregators requires separate review. See the [AggregatorV3 API](https://docs.chain.link/data-feeds/api-reference).

## Residual economic risks

- Price updates can make a previously sufficient reserve inadequate. The admission rule holds at transaction time, not continuously or for future prices.
- Spot oracle execution can be arbitraged around feed updates, jumps, market closures and forks. Slippage bounds protect the caller's output; they do not protect the reserve against informed trading.
- A plausible but incorrect oracle answer inside configured bounds remains accepted. Feed bounds are circuit breakers, not independent price verification.
- The owner can withhold trading or withdraw surplus before an adverse price move. There is no on-chain recapitalization obligation or guaranteed exit.
- Redemptions are liquidity-limited and first-come, first-served. There is no insolvency resolution mechanism.
- Native proceeds are withdrawable treasury revenue. They are not automatically converted to settlement collateral. Native purchases consume prefunded settlement capacity.
- Collateral can be blacklisted, paused or lose value. Balance-delta checks cannot make a malicious issuer safe.
- Oracle outages fail closed. There is no admin-set fallback price or emergency haircut path. Recovery can require a new deployment and a separately reviewed migration.
- BSC finality, RPC availability, transaction ordering and signer security remain outside this contract's control.

## Reporting

Do not publish exploit details or keys in a public issue. Use the repository owner's private security-reporting channel. Before accepting real funds, arrange independent code and economic review, validate live feeds, rehearse incident response and document the market-specific risk budget.
