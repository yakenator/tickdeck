<script setup lang="ts">
import { BrokerSession, MockBroker, type BrokerPosition } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import {
  TdkAccountPanel,
  TdkNotifications,
  TdkOrderTicket,
  TdkTradeButtons,
  type TdkAmendDetail,
  type TdkEditExitsDetail,
} from '@tickdeck/vue';
import { ref, shallowRef } from 'vue';
import TradingChart from './TradingChart.vue';

// One feed and one session for the whole app. Plain objects, kept out of Vue's deep reactivity.
const feed = new MockFeed({ seed: 7 });
const session = new BrokerSession(new MockBroker({ feed }));
const ready = ref(false);
session.start().then(() => (ready.value = true));

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
</script>

<template>
  <p v-if="!ready" class="hint">Connecting to the mock broker…</p>
  <template v-else>
    <header class="toolbar">
      <h1 class="brand">tickdeck + Vue</h1>
      <select v-model="instrument" aria-label="Instrument">
        <option v-for="item in feed.instruments" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
      <button class="button" type="button" :aria-pressed="theme === 'dark'" @click="toggleTheme">Dark theme</button>
      <span class="hint">Alt-click the chart to use a price in the ticket.</span>
    </header>
    <main class="layout">
      <TradingChart
        :feed="feed"
        :session="session"
        :instrument="instrument"
        :theme="theme"
        @pick-price="(price) => ticket?.element?.usePrice(price)"
      />
      <aside class="side">
        <TdkTradeButtons :session="session" :feed="feed" :theme="theme" :instrument="instrument" :quantity="10" />
        <TdkOrderTicket ref="ticket" :session="session" :feed="feed" :theme="theme" :instrument="instrument" kind="limit" :quantity="10" />
        <form v-if="editing" class="exits" @submit.prevent="saveExits">
          <strong>TP/SL for {{ editing.side === 'buy' ? 'long' : 'short' }} {{ editing.quantity }} {{ editing.instrument }}</strong>
          <input v-model="takeProfit" aria-label="Take-profit" placeholder="Take-profit" />
          <input v-model="stopLoss" aria-label="Stop-loss" placeholder="Stop-loss" />
          <button class="button" type="submit">Save</button>
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
