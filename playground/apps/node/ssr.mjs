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

await check('resolve @tickdeck/all/cdn and import @tickdeck/all/package.json', async () => {
  // The CDN bundle by package path is the file jsDelivr serves. It is a browser module (it defines the
  // elements against the DOM's HTMLElement), so it is resolved here, not imported; the browser apps load it.
  const cdn = import.meta.resolve('@tickdeck/all/cdn');
  assert.match(cdn, /\/@tickdeck\/all\/dist\/tickdeck\.js$/);
  assert.equal(import.meta.resolve('@tickdeck/all/dist/tickdeck.js'), cdn);
  const { default: manifest } = await import('@tickdeck/all/package.json', { with: { type: 'json' } });
  assert.equal(manifest.version, expected);
  return `cdn -> ${cdn.slice(cdn.indexOf('@tickdeck/'))}, package.json ${manifest.version}`;
});

// Simple props (strings, numbers, booleans) are rendered as the element's
// attributes, so the server HTML is meaningful; rich props (session, feed)
// are element properties, assigned in the browser after hydration.
const { BrokerSession, MockBroker } = await import('@tickdeck/broker');
const { MockFeed } = await import('@tickdeck/datafeed');
const feed = new MockFeed({ autoTick: false });
const session = new BrokerSession(new MockBroker({ feed }));

/** The start tag of `tag` in `html`, with its attributes by name. */
function attributes(html, tag) {
  const start = html.match(new RegExp(`<${tag}(\\s[^>]*)?>`));
  assert.ok(start, `<${tag}> is rendered`);
  return Object.fromEntries([...(start[1] ?? '').matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? '']));
}

/** Simple props as attributes (true as an empty attribute, false left out), rich props not at all. */
function assertAttributes(html) {
  assert.deepEqual(attributes(html, 'tdk-trade-buttons'), { instrument: 'MOCK:ACME', quantity: '10' });
  assert.deepEqual(attributes(html, 'tdk-order-ticket'), { class: 'ticket', instrument: 'MOCK:ACME', kind: 'limit', 'check-orders': '' });
  assert.deepEqual(attributes(html, 'tdk-account-panel'), { 'time-zone': 'Asia/Seoul' });
}

await check('React renderToString of @tickdeck/react wrappers', async () => {
  const { createElement } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { TdkAccountPanel, TdkOrderTicket, TdkTradeButtons, VERSION } = await import('@tickdeck/react');
  assert.equal(VERSION, expected);
  const html = renderToString(
    createElement(
      'main',
      null,
      createElement(TdkTradeButtons, { session, feed, instrument: 'MOCK:ACME', quantity: 10, confirm: false }),
      createElement(TdkOrderTicket, { session, feed, instrument: 'MOCK:ACME', kind: 'limit', checkOrders: true, className: 'ticket' }),
      createElement(TdkAccountPanel, { session, feed, timeZone: 'Asia/Seoul', onAmend: () => {} }),
    ),
  );
  assertAttributes(html);
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
        h(TdkTradeButtons, { ...raw, instrument: 'MOCK:ACME', quantity: 10, confirm: false }),
        h(TdkOrderTicket, { ...raw, instrument: 'MOCK:ACME', kind: 'limit', checkOrders: true, class: 'ticket' }),
        h(TdkAccountPanel, { ...raw, timeZone: 'Asia/Seoul', onAmend: () => {} }),
      ]),
  });
  const html = await renderToString(app);
  assertAttributes(html);
  assert.doesNotMatch(html, /\[object Object\]/, 'objects are not rendered as attributes');
  return html;
});

feed.dispose();
console.log(`${results.filter(Boolean).length}/${results.length} SSR and import checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
