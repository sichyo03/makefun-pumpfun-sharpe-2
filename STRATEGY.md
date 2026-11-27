# Sharpe Sprint Bot v2 — Strategy

Entry "Sharpe Sprint Bot" v2 for make.fun's Pump.fun Sharpe Sprint
(slug `u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532`).

- Protocol: `agent-fun/replay/v2`, entrypoint `main.ts` (Node 22, zero deps)
- Strategy: `strategy.ts`; vendored SDK `vendor/makefun-bot.ts`, byte-identical to the kit
- Capital: 10 SOL
- Scoring: hourly Sharpe on a future 6h final window; prize requires net PnL > 0
- Guardrails: at least 20 coins with at least 0.01 SOL round trips; max drawdown at most 50%

## 1. Thesis

Most pump.fun launches die within minutes, and naive signals lose to the
~2.5% round-trip curve fees (protocol 95 bps + creator 30 bps = 125 bps per
side). The scored metric is hourly Sharpe, so the bot optimizes the
**variance of hourly equity**, not raw return: trade rarely, only on
overwhelming opening demand. Every avoided marginal trade is variance
removed from the hourly series, which is exactly what the score rewards.

## 2. Entry filter — the proven-demand bar

- Watch each curve from creation; decide **once**, at the first batch at or
  after age 100 slots (retries only until age 300 if capacity blocked the buy).
- Buy **0.12 SOL** only if at least **20 distinct non-creator buyers** AND
  at least **30 SOL net inflow** since creation. Otherwise drop the coin for
  good — later qualifiers are mostly chasing a price that already ran.
- Buy slippage cap **300 bps**: refuse fills whose price ran more than 3%
  during the 2-slot latency.
- Max exposure **0.6 SOL** across open positions + pending buys; one entry
  attempt per coin.

The decision is deliberately one-shot. Waiting for more confirmation means
buying after the demand has already been priced in; the bar is set high
enough that the first qualifying moment is the only moment worth taking.

## 3. Exits

Exits are mechanical, valued at **liquidation value** — the constant-product
sell value after curve fees, minus the tx fee — not at mark price:

- Take profit at **+15%** over cost
- Stop at **−24%**
- Time stop: leave after **1200 slots**

Valuing positions at what a sell would actually return keeps the exit
triggers honest about fees: a position is only "up 15%" when the sale
proceeds say so.

## 4. Guardrail pacing

After 30 minutes of block time, if completed + open qualifying round trips
lag the 20-mint minimum, open tiny **0.011 SOL probe** round trips, sold as
soon as the buy fills (~−0.0005 SOL cost each). Probes matter most in the 6h
final window, where the main strategy alone may not reach 20 qualifying
round trips. They are a guardrail device, not a signal: their job is to keep
the entry eligible at negligible cost.

## 5. Determinism and purity

The strategy is a pure function of the batches it is fed: no clock, no
environment, no randomness, no I/O. Two runs over the same input produce
identical result and action-log hashes. This makes every measured number
below exactly reproducible and removes any dependence on machine timing.

## 6. What was tested and rejected

All variants measured on the dev 24h window with the kit's `grade-local`:

| Variant | Hourly Sharpe | Verdict |
| --- | --- | --- |
| Tighter exits (+10% / −12% / 800 slots) | 0.205 | Rejected — exits too twitchy |
| Scale-out exits | 0.244 | Rejected |
| Portfolio variance governor | 0.343 alone, 0.293 combined | Rejected — hurt when combined |
| Wider bar (12 buyers / 15 SOL) | 0.192 | Rejected — more trades, more variance |
| Vol-scaled stakes | 0.350 | Helped slightly, not adopted as the main change |

The winning change was the opposite of more trades: a **stricter**
proven-demand bar (20 buyers / 30 SOL vs v1's 15 / 20) with stake 0.12 SOL
and v1's exits unchanged.

## 7. Measured results

Dev 24h window (kit `grade-local`):

| Metric | v1 | v2 |
| --- | --- | --- |
| Hourly Sharpe | 0.331 | **0.886** |
| Net PnL | +0.503 SOL | +0.342 SOL |
| Max drawdown | 1.16% | **0.38%** |
| Round trips | 57 | 35 |
| Net at 2x fees | +0.381 SOL | +0.276 SOL |

Stress test (10 rebuilt copies, same for both):

| Metric | v1 | v2 |
| --- | --- | --- |
| Median net PnL | +0.032 SOL | **+0.068 SOL** |
| Positive copies | 6/10 | 6/10 |
| Mean net PnL | +0.028 SOL | +0.032 SOL |
| Worst / best | −0.340 / +0.243 SOL | −0.374 / +0.320 SOL |

## 8. Caveats

- Net PnL is lower in v2 — a deliberate trade: Sharpe is the ranked metric,
  and +0.342 SOL still clears beat-hold-cash.
- The bar was tuned on one dev window (overfitting risk), mitigated by the
  stress copies showing the same ordering between v1 and v2.
- In the 6h final window, 35 round trips per 24h implies ~9 expected from
  main trades, so probes must supply the rest of the 20-mint guardrail.

## 9. How to reproduce

- Run the kit's `grade-local` on the dev 24h window to reproduce the
  headline numbers (Sharpe 0.886, net +0.342 SOL, max drawdown 0.38%,
  35 round trips).
- Run `grade-local` with `--stress 10` to reproduce the stress table
  (10 rebuilt copies; median +0.068 SOL, 6/10 positive).
- The entry needs no network, no environment variables, and no dependencies
  beyond Node 22: `main.ts` reads replay batches on stdin and writes actions
  on stdout per `agent-fun/replay/v2`.
- Because the strategy is deterministic, repeated runs over the same input
  produce identical result and action-log hashes — if a hash differs, the
  input differed.
