# Static analysis review

Slither 0.11.6 analyzed 23 contracts with 102 detectors on 2026-11-09. Dependencies and test contracts were excluded from reported findings. The unmodified detector run returned five findings: one medium, three low and one informational. No high-severity finding was reported. This is a tool result, not an audit conclusion.

| Detector                                 | Severity      | Disposition                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `unused-return` in `_price`              | Medium        | `startedAt` and `answeredInRound` are intentionally unused. Price validity uses a nonzero round ID, a positive bounded answer, and nonzero, nonfuture, fresh `updatedAt`. Modern Chainlink feeds deprecate `answeredInRound`. Legacy aggregators are not supported implicitly. |
| `missing-zero-check` in `withdrawNative` | Low           | False positive: `_checkRecipient` rejects zero and the contract's own address before the call. Tests exercise both rejected recipients.                                                                                                                                        |
| `timestamp` in `_checkTrade`             | Low           | Intentional deadline enforcement. No randomness or exact-time financial entitlement depends on the timestamp. Validators can affect boundary timing.                                                                                                                           |
| `timestamp` in `_price`                  | Low           | Intentional feed-age validation. Maximum ages must tolerate realistic timestamp variation and feed update schedules.                                                                                                                                                           |
| `low-level-calls` in `withdrawNative`    | Informational | Intentional native transfer. Owner-only and nonreentrant; recipient validation precedes the call and a false result reverts. Rejection by a recipient is tested.                                                                                                               |

No detector is disabled by identifier. To reproduce in a Python virtual environment:

```sh
pip install -r requirements-static.txt
slither . --fail-high
```

The full detector run without `--fail-high` exits nonzero for the findings above. New findings must be reviewed rather than mechanically suppressed. The CI high-severity threshold complements unit/property tests and manual review; it does not establish economic solvency or protect against malicious feed/settlement issuers.
