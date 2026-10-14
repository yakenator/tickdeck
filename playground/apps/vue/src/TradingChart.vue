<script setup lang="ts">
import type { BrokerSession } from '@tickdeck/broker';
import { attachTrading, createChartView, type ChartView, type TradingOverlay, type VolumeMode } from '@tickdeck/chart';
import type { MarketFeed } from '@tickdeck/datafeed';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  feed: MarketFeed;
  session: BrokerSession;
  instrument: string;
  theme: 'light' | 'dark';
  /** Volume in its own pane below the prices, at the bottom of the price pane, or not at all. */
  volume: VolumeMode;
}>();
/** `created`: the view and its trading overlay exist. `pick-price`: Alt-click (Option-click) on a price. */
const emit = defineEmits<{ created: [view: ChartView, trading: TradingOverlay]; 'pick-price': [price: number] }>();

const container = ref<HTMLDivElement>();
// A plain variable, not a ref: the view keeps private state that Vue proxies cannot reach.
let view: ChartView | undefined;
let pressedAt = { x: 0, y: 0 };

onMounted(() => {
  view = createChartView(container.value!, {
    feed: props.feed,
    instrument: props.instrument,
    timeframe: '1m',
    theme: props.theme,
    volume: props.volume,
  });
  const trading = attachTrading(view, props.session, { pnl: ['money', 'ticks'] });
  emit('created', view, trading);
});

onBeforeUnmount(() => {
  view?.dispose(); // also removes the trading overlay
  view = undefined;
});

watch(
  () => props.instrument,
  (instrument) => void view?.setInstrument(instrument).catch(() => {}),
);
watch(
  () => props.volume,
  (volume) => view?.setVolume(volume),
);
// The page switched its --tdk-* tokens before this runs; setTheme reads them again.
watch(
  () => props.theme,
  (theme) => view?.setTheme(theme),
);

function onPointerDown(event: PointerEvent): void {
  pressedAt = { x: event.clientX, y: event.clientY };
}

function onClick(event: MouseEvent): void {
  // A drag (panning the chart, moving a line) ends with a click too.
  const moved = Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > 4;
  const price = view?.crosshair.value?.price;
  if (event.altKey && !moved && price !== undefined) emit('pick-price', price);
}
</script>

<template>
  <div id="chart" ref="container" class="chart" @pointerdown.capture="onPointerDown" @click="onClick"></div>
</template>
