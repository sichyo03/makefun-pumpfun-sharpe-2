// Pump.fun Sharpe Sprint entry v2: a variance-first proven-demand paper-trading bot.
// It trades rarely and only on overwhelming opening demand (>=20 distinct buyers and
// >=30 SOL net inflow by age 100 slots), which keeps hourly equity variance — the thing
// hourly Sharpe punishes — low; see strategy.ts for the measured rationale.
// Run by the grader as `node /bot/main.ts`; the strategy lives in strategy.ts, the protocol in
// the vendored SDK shim (vendor/makefun-bot.ts, a byte-identical copy of the kit's sdk/ts file).
// This file only wires the strategy into the shim's runBot loop: hello, one batch per slot,
// done in; exactly one reply of orders per batch out.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy } from './strategy.ts';

const strategy = createStrategy();

await runBot({
  onBatch: (state, batch) => strategy.onBatch(state, batch),
});
