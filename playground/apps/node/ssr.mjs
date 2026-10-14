// Server-side rendering and plain Node imports: the browser packages import
// without a DOM, and the React and Vue wrappers render to HTML on the server.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const expected = readFileSync(new URL('../../tickdeck.version', import.meta.url), 'utf8').trim();
const results = [];

async function check(name, run) {
  try {
    const detail = await run();
    results.push(true);
    console.log(`PASS  ${name}${detail ? `  ${detail}` : ''}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL  ${name}\n      ${String(error?.stack ?? error).split('\n').slice(0, 4).join('\n      ')}`);
  }
}

await check('import @tickdeck/chart', async () => {
  const chart = await import('@tickdeck/chart');
  assert.equal(typeof chart.createChartView, 'function');
  assert.equal(typeof chart.attachTrading, 'function');
  return `VERSION ${chart.VERSION}`;
});

await check('import @tickdeck/elements and @tickdeck/elements/define', async () => {
  const elements = await import('@tickdeck/elements');
  assert.equal(typeof elements.TdkOrderTicketElement, 'function');
  await import('@tickdeck/elements/define');
  return `VERSION ${elements.VERSION}`;
});

await check('import @tickdeck/all', async () => {
  const all = await import('@tickdeck/all');
  assert.equal(all.VERSION, expected);
  for (const name of ['createChartView', 'BrokerSession', 'MockBroker', 'MockFeed', 'OrderTicketController', 'TdkOrderTicketElement']) {
    assert.equal(typeof all[name], 'function', `@tickdeck/all exports ${name}`);
  }
  return `VERSION ${all.VERSION}`;
});

// Rich props (session, feed) are element properties, assigned in the browser
// after hydration; on the server only the simple attributes are rendered.
const { BrokerSession, MockBroker } = await import('@tickdeck/broker');
const { MockFeed } = await import('@tickdeck/datafeed');
const feed = new MockFeed({ autoTick: false });
const session = new BrokerSession(new MockBroker({ feed }));

await check('React renderToString of @tickdeck/react wrappers', async () => {
  const { createElement } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { TdkAccountPanel, TdkOrderTicket, TdkTradeButtons, VERSION } = await import('@tickdeck/react');
  assert.equal(VERSION, expected);
  const html = renderToString(
    createElement(
      'main',
      null,
      createElement(TdkTradeButtons, { session, feed, instrument: 'MOCK:ACME', quantity: 10 }),
      createElement(TdkOrderTicket, { session, feed, instrument: 'MOCK:ACME', kind: 'limit', className: 'ticket' }),
      createElement(TdkAccountPanel, { session, feed, onAmend: () => {} }),
    ),
  );
  // Every prop, simple ones included, is applied as a property after hydration,
  // so the server HTML carries the tags and HTML attributes such as class.
  assert.match(html, /<tdk-trade-buttons[^>]*>/);
  assert.match(html, /<tdk-order-ticket class="ticket"[^>]*>/);
  assert.match(html, /<tdk-account-panel[^>]*>/);
  assert.doesNotMatch(html, /\[object Object\]/, 'objects are not rendered as attributes');
  return html;
});

await check('Vue renderToString of @tickdeck/vue wrappers', async () => {
  const { createSSRApp, h, markRaw } = await import('vue');
  const { renderToString } = await import('vue/server-renderer');
  const { TdkAccountPanel, TdkOrderTicket, TdkTradeButtons, VERSION } = await import('@tickdeck/vue');
  assert.equal(VERSION, expected);
  const raw = { session: markRaw(session), feed: markRaw(feed) };
  const app = createSSRApp({
    render: () =>
      h('main', [
        h(TdkTradeButtons, { ...raw, instrument: 'MOCK:ACME', quantity: 10 }),
        h(TdkOrderTicket, { ...raw, instrument: 'MOCK:ACME', kind: 'limit', class: 'ticket' }),
        h(TdkAccountPanel, { ...raw, onAmend: () => {} }),
      ]),
  });
  const html = await renderToString(app);
  assert.match(html, /<tdk-trade-buttons[^>]*>/);
  assert.match(html, /<tdk-order-ticket class="ticket"[^>]*>/);
  assert.match(html, /<tdk-account-panel[^>]*>/);
  assert.doesNotMatch(html, /\[object Object\]/, 'objects are not rendered as attributes');
  return html;
});

feed.dispose();
console.log(`${results.filter(Boolean).length}/${results.length} SSR and import checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
