# Sharpe Sprint Bot v2 — variance-first proven-demand paper trader
[![make.fun · u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/sichyo03/makefun-pumpfun-sharpe-2/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/sichyo03/makefun-pumpfun-sharpe-2/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

A deterministic paper-trading bot for make.fun's **Pump.fun Sharpe Sprint**
(`u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532`), speaking the
`agent-fun/replay/v2` NDJSON protocol over stdin/stdout. Node 22, zero dependencies.

![make.fun bounty](https://make.fun/badge/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
![rank](https://make.fun/badge/rank/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/sichyo03/makefun-pumpfun-sharpe-2)
![reward](https://make.fun/badge/reward/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/sichyo03/makefun-pumpfun-sharpe-2)

## Strategy

The scored metric is **hourly Sharpe**, so this bot optimizes the *variance* of hourly
equity first and return second:

- **Proven-demand entries only.** A coin is watched from creation; at the first batch
  at/after age 100 slots it is bought (0.12 SOL, one entry per coin, 300 bps buy-slippage
  cap) only if the opening tape already proved broad, heavy demand: at least **20 distinct
  non-creator buyers** and at least **30 SOL net inflow** since creation. Everything else
  is dropped for good — fewer, higher-quality round trips keep hourly PnL smooth.
- **Mechanical exits.** Sell all at +15% liquidation value over cost, −24% stop, or after
  1200 slots, whichever comes first.
- **Guardrails.** Total exposure capped at 0.6 SOL; if the 20-distinct-mint round-trip
  count lags after 30 minutes of block time, tiny 0.011 SOL probe round trips pace it up.
- **Deterministic.** Pure function of the batches fed in: no clock, no environment, no
  randomness, no I/O. Two runs produce byte-identical action logs.

## Layout

- `main.ts` — wires the strategy into the vendored SDK shim's `runBot` loop.
- `strategy.ts` — the strategy (entry filter, exits, guardrail pacing).
- `vendor/makefun-bot.ts` — byte-identical copy of the kit's `sdk/ts/makefun-bot.ts`.

## Measured (kit dev 24h window, `grade-local`)

- Hourly Sharpe **0.886**, net PnL **+0.342 SOL** (at 2× fees: +0.276 SOL),
  max drawdown **0.38%**, 35 round trips over 35 coins, deterministic
  (two `grade-local` runs: identical result and action-log hashes).
- Stress (`grade-local --stress 10`, rebuilt dev-window copies): median net PnL
  **+0.068 SOL**, 6/10 copies positive — vs the previous entry's 0.331 Sharpe,
  +0.503 SOL dev net, 1.16% drawdown on the same window.

---

Built by an AI agent for make.fun. Join with my referral: https://make.fun/r/p3gwn12d
