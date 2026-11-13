# Deployment and operations

## Configuration

The local deployment is reproducible and contains only mocks. Public-network deployment requires real reviewed inputs; there are deliberately no guessed feed addresses. The included deploy script accepts BSC testnet chain 97 only and leaves trading closed. It reads environment variables from the shell; `.env.example` documents names but is not automatically loaded.

`DEPLOYMENT_CONFIG` points to JSON with this structure:

```json
{
  "owner": "MULTISIG_ADDRESS",
  "settlementToken": "SETTLEMENT_ADDRESS",
  "settlementDecimals": 18,
  "assets": [
    {
      "id": "gold",
      "name": "Gold",
      "symbol": "rGOLD",
      "category": "Commodity",
      "supplyCap": "1000",
      "reserveRatioBps": 15000,
      "assetFeed": {
        "address": "ASSET_USD_PROXY",
        "maxAge": 3600,
        "minPrice": "1",
        "maxPrice": "100000"
      },
      "settlementFeed": {
        "address": "SETTLEMENT_USD_PROXY",
        "maxAge": 3600,
        "minPrice": "0.5",
        "maxPrice": "1.5"
      },
      "nativeFeed": {
        "address": "NATIVE_USD_PROXY",
        "maxAge": 3600,
        "minPrice": "1",
        "maxPrice": "100000"
      }
    }
  ]
}
```

These are schematic fields and example bounds, not executable deployment parameters. Consult [official feed addresses](https://docs.chain.link/data-feeds/price-feeds/addresses) and [feed selection guidance](https://docs.chain.link/data-feeds/selecting-data-feeds). Not every reference asset has a suitable feed on every chain. If a feed is unavailable, do not deploy that market with a substitute asset or a fabricated address.

Set `BSC_TESTNET_RPC_URL`, `DEPLOYER_PRIVATE_KEY` and `DEPLOYMENT_CONFIG`, then run `npm run deploy`. The script checks the connected chain and settlement precision and reads all three live feeds. The manifest is written after each successful deployment so partial progress is preserved. Failed validation may still leave a deployed, closed contract; inspect receipts before retrying. Mainnet deployment is intentionally not automated by this script.

## Before opening a market

Verify compiler settings and published source/bytecode, token/feed identities and denominations, token transfer semantics, feed heartbeat and deviation settings, market hours and corporate actions. Set bounds from the specific risk budget. Fund settlement reserves, verify `requiredReserve`, and confirm owner access through the intended multisig. Run the exchange against the exact generated ABI and deployment manifest. Rehearse pause, market close, ownership transfer and reserve replenishment on testnet before opening the session.

## Monitoring

Monitor asset and settlement prices, update age, current reserve versus buffered liability, total supply versus cap, native proceeds, purchase/redemption events, owner changes, session changes and pauses. Alert before the buffer is exhausted. A monitoring system needs reliable RPCs and durable storage; neither is supplied by the browser application.

When data becomes stale, halt issuance and investigate the feed. When reserves fall below the admission buffer, fund reserves or reduce exposure; do not assume new buyers will repair the deficit. During an incident, the owner can close or pause trading. Both actions also block redemption, and that consequence must be communicated to holders.

No deployment parameter, script or test substitutes for hedging, liquidity planning, independent review or custody arrangements for real-world assets.
