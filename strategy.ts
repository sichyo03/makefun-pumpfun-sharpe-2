// Proven-demand momentum bot for agent-fun/replay/v2 (pump.fun bonding curves).
//
// Thesis: most pump.fun launches die within minutes and naive signals lose to the ~2.5%
// round-trip curve fees. The one robustly positive family is to wait until a curve is about
// 100 slots old and only buy when the opening tape already proved broad, heavy demand —
// many distinct buyers and a large net SOL inflow since creation. The decision is made once,
// at the first batch at or past that age: coins that have not proved demand by then are
// dropped for good, because later qualifiers are mostly chasing a price that already ran.
// A tight buy-slippage cap refuses fills whose price ran away during the 2-slot latency.
// Exits are mechanical: take profit at +15% liquidation value over cost, stop at -24%, or
// leave after 1200 slots. A pacing fallback opens tiny probe round trips only if the
// 20-mint guardrail count lags.
//
// Pure function of the batches it is fed: no clock, no environment, no randomness, no I/O.

import { BPS, LAMPORTS_PER_SOL, type Batch, type BotState, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

// ---- parameters (lamports as bigint where money moves) ----
const STAKE = LAMPORTS_PER_SOL / 10n; // 0.1 SOL per main entry
const MAX_EXPOSURE = (LAMPORTS_PER_SOL * 6n) / 10n; // 0.6 SOL across all open positions + pending buys
const MIN_BUY = LAMPORTS_PER_SOL / 100n; // 0.01 SOL: the guardrail's round-trip minimum buy
const PROBE_BUY = (LAMPORTS_PER_SOL * 11n) / 1000n; // 0.011 SOL probe round trips
const MIN_AGE = 100; // slots after create: the decision batch (first batch at or past this age)
const MAX_AGE = 300; // slots after create: capacity-blocked retries stop here
const MIN_BUYERS = 15; // distinct non-creator buyers since creation
const MIN_NET_INFLOW = LAMPORTS_PER_SOL * 20n; // 20 SOL net inflow since creation
const BUY_SLIPPAGE_BPS = 300; // refuse fills that ran more than 3% in the latency
const SELL_SLIPPAGE_BPS = 10_000; // exits always fill
const TAKE_PROFIT_BPS = 1_500; // +15% liquidation value over cost
const STOP_LOSS_BPS = 2_400; // -24% liquidation value under cost
const MAX_HOLD_SLOTS = 1_200;
const GUARDRAIL_MINTS = 20;
const PROBE_AFTER_SECONDS = 1_800; // start pacing probes after 30 min of block time
const FEE_BPS = 125n; // protocol 95 + creator 30

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  buyers: Set<Pubkey>;
  netInflow: bigint;
  complete: boolean;
  /** Buy already attempted (one entry per coin) or filtered out for good. */
  done: boolean;
  /** This coin was bought as a guardrail probe: sell as soon as the buy fills. */
  probe: boolean;
}

interface Held {
  openedSlot: number;
}

/** What selling `tokens` against (vq, vt) would pay after curve fees (constant product). */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

export interface Strategy {
  onBatch(state: BotState, batch: Batch): OrderInput[];
}

export function createStrategy(): Strategy {
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Mints with a sell in flight. */
  const selling = new Set<Pubkey>();
  /** Mints with a filled buy of at least MIN_BUY (guardrail candidates). */
  const qualifyingBuys = new Set<Pubkey>();
  /** Qualifying mints whose position has fully closed: completed round trips. */
  const roundTripped = new Set<Pubkey>();
  let firstTime: number | null = null;
  let nowTime = 0;

  function hasPending(state: BotState, mint: Pubkey, side: 'buy' | 'sell'): boolean {
    for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === side) return true;
    return false;
  }

  function readEvents(batch: Batch): void {
    for (const e of batch.events) {
      if (e.block_time !== null) {
        if (firstTime === null) firstTime = e.block_time;
        if (e.block_time > nowTime) nowTime = e.block_time;
      }
      if (e.event === 'CreateEvent') {
        if (!coins.has(e.mint)) {
          coins.set(e.mint, {
            mint: e.mint,
            createSlot: e.slot,
            creator: e.creator,
            buyers: new Set(),
            netInflow: 0n,
            complete: false,
            done: false,
            probe: false,
          });
        }
      } else if (e.event === 'TradeEvent') {
        const c = coins.get(e.mint);
        if (c === undefined) continue;
        const sol = BigInt(e.sol_amount);
        if (e.is_buy) {
          c.netInflow += sol;
          if (e.user !== c.creator) c.buyers.add(e.user);
        } else {
          c.netInflow -= sol;
        }
      } else {
        const c = coins.get(e.mint);
        if (c !== undefined) {
          c.complete = true;
          c.done = true;
        }
      }
    }
  }

  return {
    onBatch(state, batch) {
      readEvents(batch);
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();

      // Fold fills into held/guardrail bookkeeping.
      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          // Harness close (complete / flatten / writeoff): the position is gone.
          held.delete(f.mint);
          selling.delete(f.mint);
          continue;
        }
        const h = held.get(f.mint);
        if (f.side === 'buy' && f.status === 'filled') {
          if (BigInt(f.quote_lamports) >= MIN_BUY) qualifyingBuys.add(f.mint);
          if (h === undefined) held.set(f.mint, { openedSlot: f.slot });
        }
      }
      for (const mint of [...selling]) if (!hasPending(state, mint, 'sell')) selling.delete(mint);
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPending(state, mint, 'buy')) held.delete(mint);
      }
      // A qualifying mint with no position and nothing in flight has completed its round trip.
      for (const mint of qualifyingBuys) {
        if (roundTripped.has(mint)) continue;
        if (!state.positions.has(mint) && !hasPending(state, mint, 'buy') && !hasPending(state, mint, 'sell')) {
          roundTripped.add(mint);
        }
      }

      // ---- exits first ----
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint)) continue;
        const c = coins.get(mint);
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: state.slot };
          held.set(mint, h);
        }
        let exit = false;
        if (c !== undefined && c.probe) {
          exit = true; // probes exist only to complete a round trip
        } else {
          const curve = state.curves.get(mint);
          if (curve !== undefined) {
            const value = sellValue(pos.token_amount, curve.virtual_quote_reserves, curve.virtual_token_reserves) - tx;
            const basis = pos.cost_lamports;
            if (basis > 0n) {
              if (value * BPS >= basis * (BPS + BigInt(TAKE_PROFIT_BPS))) exit = true;
              if (value * BPS <= basis * (BPS - BigInt(STOP_LOSS_BPS))) exit = true;
            }
          }
          if (state.slot - h.openedSlot >= MAX_HOLD_SLOTS) exit = true;
        }
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: SELL_SLIPPAGE_BPS });
        selling.add(mint);
        if (c !== undefined) c.done = true;
      }

      // ---- main entries ----
      let free = state.freeCashLamports() - tx * BigInt(orders.length);
      let exposure = 0n;
      for (const pos of state.positions.values()) exposure += pos.cost_lamports;
      for (const p of state.pending.values()) if (p.order.side === 'buy') exposure += BigInt(p.order.quote_lamports);
      let open = state.committedPositionCount();
      // Sells placed this batch free their slots only once filled; count conservatively.
      for (const c of coins.values()) {
        if (orders.length >= cap) break;
        if (c.done || c.complete) continue;
        const age = state.slot - c.createSlot;
        if (age < MIN_AGE) continue;
        if (age > MAX_AGE) {
          // Qualified at decision time but capacity (positions/exposure/cash) kept blocking
          // the buy; do not chase it later.
          c.done = true;
          continue;
        }
        // Decide once, at the first batch at or past MIN_AGE: buy if qualified, else drop.
        if (c.buyers.size < MIN_BUYERS || c.netInflow < MIN_NET_INFLOW) {
          c.done = true;
          continue;
        }
        if (open >= state.hello.caps.max_open_positions) continue;
        if (state.positions.has(c.mint) || hasPending(state, c.mint, 'buy')) continue;
        const maxBuy = state.maxBuyLamports(c.mint);
        const amount = STAKE < maxBuy ? STAKE : maxBuy;
        if (amount < MIN_BUY) continue;
        if (exposure + amount > MAX_EXPOSURE) continue;
        if (free < amount + tx) continue;
        orders.push({ side: 'buy', mint: c.mint, quote_lamports: amount, max_slippage_bps: BUY_SLIPPAGE_BPS });
        free -= amount + tx;
        exposure += amount;
        open += 1;
        c.done = true; // one entry attempt per coin, filled or not
      }

      // ---- guardrail pacing: tiny probe round trips if the 20-mint count lags ----
      const elapsed = firstTime === null ? 0 : nowTime - firstTime;
      let openQualifying = 0;
      for (const mint of qualifyingBuys) if (!roundTripped.has(mint)) openQualifying += 1;
      if (
        elapsed >= PROBE_AFTER_SECONDS &&
        roundTripped.size + openQualifying < GUARDRAIL_MINTS &&
        orders.length < cap &&
        open < state.hello.caps.max_open_positions
      ) {
        for (const c of coins.values()) {
          if (c.complete || c.probe || c.done) continue;
          if (state.positions.has(c.mint) || hasPending(state, c.mint, 'buy')) continue;
          const maxBuy = state.maxBuyLamports(c.mint);
          if (maxBuy < PROBE_BUY) continue;
          if (free < PROBE_BUY + tx) break;
          orders.push({ side: 'buy', mint: c.mint, quote_lamports: PROBE_BUY, max_slippage_bps: SELL_SLIPPAGE_BPS });
          free -= PROBE_BUY + tx;
          open += 1;
          c.probe = true;
          c.done = true;
          break; // one probe per batch
        }
      }

      return orders;
    },
  };
}
