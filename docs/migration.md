# Migration from the asset-specific contracts

I consolidated the earlier asset-specific contracts into one implementation because they shared the same purchase and redemption rules. The current implementation pins OpenZeppelin 5 and uses its constructor and import conventions consistently.

| Earlier behavior                             | Current behavior                                                   |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Ten copies of settlement logic               | One implementation, independently configured instances             |
| Positive oracle answer only                  | Freshness, timestamp, round, precision and normalized price bounds |
| Assumes settlement token = USD               | Separate settlement/USD feed                                       |
| USDT restricted to 18 decimals               | Generic settlement token, 0–18 decimals                            |
| Purchase/redemption without execution bounds | Required `minOut` and deadline arguments                           |
| BNB purchases do not check USDT capacity     | Native issuance consumes prefunded settlement reserve capacity     |
| Owner can withdraw all settlement liquidity  | Surplus-only withdrawals against current buffered liability        |
| No market gate or pause                      | Closed-by-default session gate and emergency trade pause           |
| Immediate ownership transfer                 | Two-step transfer; no ownership renunciation                       |
| Asset-specific price getters                 | Common `assetPriceUsd`, `settlementPriceUsd`, `nativePriceUsd`     |

Token metadata is configured at deployment. The catalog uses `rSILVER` consistently, resolving the earlier contract/frontend silver-symbol mismatch. Product branding, private configuration and previous deployment addresses are not included.

Existing on-chain code is immutable. Publishing this repository does not update an existing contract. Existing holders would need an explicit balance and reserve migration plan, separate contracts if required, independent review and user communication. No migration transaction or live deployment has been performed.
