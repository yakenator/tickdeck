import type { BrokerSession } from '@tickdeck/broker';
import { attachTrading, createChartView, type ChartView } from '@tickdeck/chart';
import type { MarketFeed } from '@tickdeck/datafeed';
import { useEffect, useRef } from 'react';

interface TradingChartProps {
  feed: MarketFeed;
  session: BrokerSession;
  instrument: string;
  theme: 'light' | 'dark';
  /** Alt-click (Option-click) on a price. */
  onPickPrice?: (price: number) => void;
}

/** `createChartView` plus `attachTrading`, created in an effect and disposed with the component. */
export function TradingChart({ feed, session, instrument, theme, onPickPrice }: TradingChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<ChartView | undefined>(undefined);
  const pressedAt = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const created = createChartView(container.current!, { feed, instrument, timeframe: '1m', theme });
    attachTrading(created, session, { pnl: ['money', 'ticks'] });
    view.current = created;
    return () => {
      created.dispose(); // also removes the trading overlay
      view.current = undefined;
    };
    // The view is created once per feed and session; the effects below follow the other props.
  }, [feed, session]);

  useEffect(() => {
    if (view.current && view.current.instrument.value !== instrument) view.current.setInstrument(instrument).catch(() => {});
  }, [instrument]);

  useEffect(() => {
    // The page switched its --tdk-* tokens before this runs; setTheme reads them again.
    if (view.current && view.current.theme.value !== theme) view.current.setTheme(theme);
  }, [theme]);

  return (
    <div
      ref={container}
      className="chart"
      onPointerDownCapture={(event) => (pressedAt.current = { x: event.clientX, y: event.clientY })}
      onClick={(event) => {
        const moved = Math.hypot(event.clientX - pressedAt.current.x, event.clientY - pressedAt.current.y) > 4;
        const price = view.current?.crosshair.value?.price;
        if (event.altKey && !moved && price !== undefined) onPickPrice?.(price);
      }}
    />
  );
}
