<script setup lang="ts">
import { BrokerSession, MockBroker, type BrokerPosition } from '@tickdeck/broker';
import type { ChartView, TradingOverlay } from '@tickdeck/chart';
import { addExact, roundToTick, subtractExact } from '@tickdeck/core';
import { MockFeed } from '@tickdeck/datafeed';
import type { TdkAmendDetail, TdkEditExitsDetail } from '@tickdeck/elements';
import { TdkAccountPanel, TdkNotifications, TdkOrderTicket, TdkTradeButtons, VERSION } from '@tickdeck/vue';
import { ref, shallowRef } from 'vue';
import TradingChart from './TradingChart.vue';

// One feed and one session for the whole app. Plain objects, kept out of Vue's deep reactivity.
const feed = new MockFeed({ seed: 7 });
const session = new BrokerSession(new MockBroker({ feed }));
const ready = ref(false);
session.start().then(() => (ready.value = true));

// For the browser console and the end-to-end tests (typed in playground.d.ts).
window.playground = { feed, session };

type Theme = 'light' | 'dark';
const instrument = ref('MOCK:ACME');
const theme = ref<Theme>('light');
const ticket = ref<InstanceType<typeof TdkOrderTicket>>();
const panel = ref<InstanceType<typeof TdkAccountPanel>>();

function toggleTheme(): void {
  const next = theme.value === 'dark' ? 'light' : 'dark';
  // Switch the page's tokens first, so the chart reads the new ones.
  document.documentElement.dataset.theme = next;
  theme.value = next;
}

function amend({ order }: TdkAmendDetail): void {
  // Follow the order's instrument, then open the order in the ticket.
  instrument.value = order.instrument;
  void ticket.value?.element?.amend(order);
}

// Moves the mock market to a typed price (one tick each side); the random walk continues from there.
const marketPrice = ref('');
async function moveMarket(): Promise<void> {
  const typed = Number(marketPrice.value);
  if (!(typed > 0)) return;
  const { tickSize } = await feed.getInstrument(instrument.value);
  const last = roundToTick(typed, tickSize);
  await feed.setQuote(instrument.value, { bid: subtractExact(last, tickSize), ask: addExact(last, tickSize), last });
}

// A small take-profit and stop-loss form for a position. An empty field removes that exit.
const editing = shallowRef<BrokerPosition>();
const takeProfit = ref('');
const stopLoss = ref('');
const exitsFailed = ref(false);

function editExits({ position }: TdkEditExitsDetail): void {
  editing.value = position;
  takeProfit.value = position.takeProfit?.toString() ?? '';
  stopLoss.value = position.stopLoss?.toString() ?? '';
  exitsFailed.value = false;
}

async function saveExits(): Promise<void> {
  const position = editing.value;
  const controller = panel.value?.element?.activeController;
  if (!position || !controller) return;
  const price = (text: string) => (text.trim() === '' ? null : Number(text));
  const saved = await controller.setPositionExits(position.id, { takeProfit: price(takeProfit.value), stopLoss: price(stopLoss.value) });
  if (saved) editing.value = undefined;
  else exitsFailed.value = true;
}

function chartCreated(view: ChartView, trading: TradingOverlay): void {
  Object.assign(window.playground!, { view, trading });
}
</script>

<template>
  <p v-if="!ready" class="hint">Connecting to the mock broker…</p>
  <template v-else>
    <header class="toolbar">
      <strong>tickdeck + Vue</strong>
      <span class="hint">version <span id="version">{{ VERSION }}</span> · <a href="../">All playground apps</a></span>
      <select id="instrument" v-model="instrument" aria-label="Instrument">
        <option v-for="item in feed.instruments" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
      <button class="button" type="button" :aria-pressed="theme === 'dark'" @click="toggleTheme">Dark theme</button>
      <form id="market" class="market" autocomplete="off" @submit.prevent="moveMarket">
        <label class="hint" for="market-price">Simulated market</label>
        <input id="market-price" v-model="marketPrice" inputmode="decimal" />
        <button class="button" type="submit">Move</button>
      </form>
    </header>
    <main class="layout">
      <TradingChart
        :feed="feed"
        :session="session"
        :instrument="instrument"
        :theme="theme"
        @created="chartCreated"
        @pick-price="(price) => ticket?.element?.usePrice(price)"
      />
      <aside class="side">
        <TdkTradeButtons :session="session" :feed="feed" :theme="theme" :instrument="instrument" :quantity="10" />
        <TdkOrderTicket ref="ticket" :session="session" :feed="feed" :theme="theme" :instrument="instrument" kind="limit" :quantity="10" />
        <form v-if="editing" id="exits-form" class="exits" @submit.prevent="saveExits">
          <strong>TP/SL for {{ editing.side === 'buy' ? 'long' : 'short' }} {{ editing.quantity }} {{ editing.instrument }}</strong>
          <input id="exits-take-profit" v-model="takeProfit" aria-label="Take-profit" placeholder="Take-profit" />
          <input id="exits-stop-loss" v-model="stopLoss" aria-label="Stop-loss" placeholder="Stop-loss" />
          <button id="exits-save" class="button" type="submit">Save</button>
          <button class="button" type="button" @click="editing = undefined">Cancel</button>
          <span v-if="exitsFailed" class="error">Not accepted; see the account panel.</span>
        </form>
      </aside>
      <TdkAccountPanel
        ref="panel"
        class="panel"
        :session="session"
        :feed="feed"
        :theme="theme"
        @amend="amend"
        @edit-exits="editExits"
      />
    </main>
    <TdkNotifications :session="session" :feed="feed" :theme="theme" placement="bottom-end" />
  </template>
</template>
