import type { BrokerPosition, ProtectiveExits } from '@tickdeck/broker';
import { formatDecimal, isOnTick, type Instrument } from '@tickdeck/core';

export interface ExitsDialogOptions {
  /** Instrument metadata for tick size and price precision. */
  getInstrument(id: string): Promise<Instrument>;
  /** Sends the change. Resolves with an error message, or undefined once the broker confirmed it. */
  save(position: BrokerPosition, exits: ProtectiveExits): Promise<string | undefined>;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * A minimal take-profit and stop-loss editor for a position, opened from the
 * account panel's `tdk-edit-exits` event. An empty field removes that exit.
 */
export function createExitsDialog(options: ExitsDialogOptions): { open(position: BrokerPosition): Promise<void> } {
  const dialog = $<HTMLDialogElement>('exits-dialog');
  const form = $<HTMLFormElement>('exits-form');
  const description = $('exits-position');
  const takeProfitInput = $<HTMLInputElement>('exits-take-profit');
  const stopLossInput = $<HTMLInputElement>('exits-stop-loss');
  const error = $('exits-error');
  const save = $<HTMLButtonElement>('exits-save');
  let current: { position: BrokerPosition; instrument: Instrument } | undefined;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if ((event.submitter as HTMLButtonElement | null)?.value !== 'save') {
      dialog.close();
      return;
    }
    if (!current) return;
    const { position, instrument } = current;
    const takeProfit = parsePrice(takeProfitInput.value);
    const stopLoss = parsePrice(stopLossInput.value);
    const problem = validate(position, instrument, takeProfit, stopLoss);
    if (problem) {
      error.textContent = problem;
      return;
    }
    // Only send what changed: a price sets the exit, null removes it.
    const exits: ProtectiveExits = {};
    if (takeProfit !== position.takeProfit) exits.takeProfit = takeProfit ?? null;
    if (stopLoss !== position.stopLoss) exits.stopLoss = stopLoss ?? null;
    if (Object.keys(exits).length === 0) {
      dialog.close();
      return;
    }
    save.disabled = true;
    error.textContent = '';
    const failure = await options.save(position, exits);
    save.disabled = false;
    if (failure) error.textContent = failure;
    else dialog.close();
  });

  return {
    async open(position) {
      const instrument = await options.getInstrument(position.instrument);
      current = { position, instrument };
      const format = (price: number | undefined) =>
        price === undefined ? '' : formatDecimal(price, instrument.pricePrecision);
      const side = position.side === 'buy' ? 'Long' : 'Short';
      description.textContent = `${side} ${position.quantity} ${instrument.name} at ${format(position.averagePrice)}`;
      takeProfitInput.value = format(position.takeProfit);
      stopLossInput.value = format(position.stopLoss);
      error.textContent = '';
      dialog.showModal();
      takeProfitInput.focus();
      takeProfitInput.select();
    },
  };
}

function parsePrice(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

function validate(
  position: BrokerPosition,
  instrument: Instrument,
  takeProfit: number | undefined,
  stopLoss: number | undefined,
): string | undefined {
  const long = position.side === 'buy';
  const market = position.lastPrice;
  for (const [label, price] of [
    ['Take-profit', takeProfit],
    ['Stop-loss', stopLoss],
  ] as const) {
    if (price === undefined) continue;
    if (!Number.isFinite(price) || price <= 0) return `${label}: enter a positive price`;
    if (!isOnTick(price, instrument.tickSize)) return `${label}: use multiples of ${instrument.tickSize}`;
  }
  // An exit on the wrong side of the market would fill at once.
  if (market !== undefined) {
    if (takeProfit !== undefined && (long ? takeProfit <= market : takeProfit >= market)) {
      return `Take-profit must be ${long ? 'above' : 'below'} the market (${market})`;
    }
    if (stopLoss !== undefined && (long ? stopLoss >= market : stopLoss <= market)) {
      return `Stop-loss must be ${long ? 'below' : 'above'} the market (${market})`;
    }
  }
  return undefined;
}
