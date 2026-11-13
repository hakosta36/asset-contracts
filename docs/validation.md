# Verification record

Verified locally on 2026-11-09 using Windows, Node.js 22.23.4, Hardhat 2.28.6, Solidity 0.8.30 and OpenZeppelin Contracts 5.6.1. Compiler optimization uses 200 runs and the Paris EVM target.

## Executed checks

- Compilation and 33 passing contract tests.
- Coverage: `OracleAsset.sol` has 100% statement, function and line coverage and 92.31% branch coverage. These figures measure exercised code, not security completeness.
- An 80-case deterministic property loop checks fixed-price round-trip rounding and reserve admission after purchases. This is bounded property testing, not an exhaustive invariant proof or a stateful fuzz campaign.
- Six- and eighteen-decimal settlement accounting; zero-, eight- and eighteen-decimal oracle normalization; settlement depeg pricing.
- Stable/native purchases, redemption and rollback on insufficient reserves, unsupported transfer fees and failed payouts.
- Oracle age, missing/future timestamps, missing rounds, nonpositive and out-of-bounds answers and unsupported precision.
- Supply cap, trade deadlines, output floors, market gate, pause semantics, ownership transfer and unauthorized administration.
- Token callback reentrancy and native withdrawal success/failure/recipient checks.
- Slither findings reviewed in [static analysis](static-analysis.md).
- The companion exchange deployed all ten markets and exercised stable approval/buy/redemption, native buy, portfolio reads, chain mismatch and stale-feed rejection on the local EVM.

## Dependencies

The production dependency audit reports zero findings. The full development tree reports ten low-severity entries, all arising from Hardhat's transitive Ethers 5 / elliptic chain; they are development tooling, not deployed Solidity bytecode. No moderate, high or critical dependency finding remains in this snapshot. `npm audit --audit-level=high` is a CI gate.

Leaf overrides update vulnerable archive, temporary-file, HTTP, serialization, UUID, BN and cookie packages while keeping the Hardhat 2 / solidity-coverage workflow. Compile, tests and coverage were run with the installed overrides. A future move to Hardhat 3 should revisit this tooling and remove overrides that are no longer needed; the lockfile is committed for reproducibility.

## Not established

No independent audit, formal verification, live BSC deployment, real-feed fork test, economic stress simulation, production load measurement or real-fund transaction was performed. Mock feed availability does not establish that a suitable live feed exists for each catalog reference. Public deployment remains dependent on market-specific feed, custody, reserve and operating decisions.
