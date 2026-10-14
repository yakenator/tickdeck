import { subtractExact, type Disposable, type Quote, type Unsubscribe } from '@tickdeck/core';
import type { WidgetFeed } from './context';
import type { InstrumentFormat } from './instrument';

/** Live market prices of one instrument, with display text. */
export interface QuoteDisplay {
  bid?: number;
  ask?: number;
  last?: number;
  /** `ask - bid`. */
  spread?: number;
  bidText: string;
  askText: string;
  lastText: string;
  spreadText: string;
  /** UTC epoch milliseconds of the quote. */
  time?: number;
}

export function toQuoteDisplay(quote: Quote | undefined, format: InstrumentFormat): QuoteDisplay | undefined {
  if (!quote) return undefined;
  const spread = quote.bid !== undefined && quote.ask !== undefined ? subtractExact(quote.ask, quote.bid) : undefined;
  return {
    bid: quote.bid,
    ask: quote.ask,
    last: quote.last,
    spread,
    bidText: format.price(quote.bid),
    askText: format.price(quote.ask),
    lastText: format.price(quote.last),
    spreadText: format.price(spread),
    time: quote.time,
  };
}

/** Follows the quote of one instrument as a focus instrument of the feed. */
export class QuoteWatcher implements Disposable {
  readonly #feed: WidgetFeed | undefined;
  readonly #onQuote: (quote: Quote | undefined) => void;
  #unsubscribe: Unsubscribe | undefined;
  #generation = 0;

  constructor(feed: WidgetFeed | undefined, onQuote: (quote: Quote | undefined) => void) {
    this.#feed = feed;
    this.#onQuote = onQuote;
  }

  watch(instrument: string | undefined): void {
    this.#stop();
    const generation = ++this.#generation;
    this.#onQuote(undefined);
    const feed = this.#feed;
    if (!feed || !instrument) return;
    let streamed = false;
    this.#unsubscribe = feed.streamQuotes({ instruments: [instrument], focus: [instrument] }, (quotes) => {
      if (generation !== this.#generation) return;
      for (const quote of quotes) {
        if (quote.instrument !== instrument) continue;
        streamed = true;
        this.#onQuote(quote);
      }
    });
    feed.loadQuotes([instrument]).then(
      (quotes) => {
        const quote = quotes.find((candidate) => candidate.instrument === instrument);
        if (quote && !streamed && generation === this.#generation) this.#onQuote(quote);
      },
      () => undefined,
    );
  }

  dispose(): void {
    this.#generation++;
    this.#stop();
  }

  #stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }
}
