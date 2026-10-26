/**
 * Client-bundle test: load the browser half the way the host does, and mount it
 * against a mock `slots` service.
 *
 * The panel cannot be rendered here (no DOM). The failure that actually happens in
 * the wild is a wiring one: the loader wrapper missing, `apply` not exported, or the
 * rail entry and the main seat registered under different ids. Those are all
 * assertable without a browser — and without React, because the factory only needs
 * `createElement` to define its components.
 *
 * Run: node test/client.mjs
 * With the host's React: DSH_PROFILE_MODULES=<profile>/node_modules node test/client.mjs
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const profileModules = process.env.DSH_PROFILE_MODULES ?? 'C:/Users/86156/.dsh/profiles/desktop/node_modules';
const reactPath = join(profileModules, 'react', 'index.js');

/** Enough of React to define components and render an element tree. */
function stubReact() {
  const createElement = (type, props, ...children) => ({ type, props: props ?? null, children });
  return {
    createElement,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useCallback: (fn) => fn,
    useEffect: () => {},
    Fragment: 'Fragment',
  };
}

let React;
let reactOrigin = 'stub';
if (existsSync(reactPath)) {
  try {
    React = (await import(pathToFileURL(reactPath).href)).default;
    reactOrigin = 'host';
  } catch {
    React = stubReact();
  }
} else {
  React = stubReact();
}
if (React === undefined || typeof React.createElement !== 'function') React = stubReact();

let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition;
    },
  },
};

await import('../client/client.js');

console.log(`publisher-radar client (react: ${reactOrigin})`);

assert.ok(captured !== null, 'the bundle registered itself with the module loader');
assert.equal(captured.id, 'dsh-publisher-radar');
assert.equal(typeof captured.factory, 'function');
console.log('  ok  module loader wrapper is correct');

const mod = captured.factory((specifier) => {
  if (specifier === 'react') return React;
  throw new Error(`unexpected require: ${specifier}`);
});

assert.equal(typeof mod.apply, 'function', 'exports.apply');
assert.deepEqual(mod.inject, ['slots'], 'injects exactly the slots service');
console.log('  ok  exports apply + inject');

const injections = [];
const seats = [];
const ctx = {
  slots: {
    inject(name, callback) {
      injections.push(name);
      return callback();
    },
    register(options, component) {
      seats.push({ options, component });
      return () => {};
    },
  },
};

mod.apply(ctx);

assert.deepEqual(injections, ['main', 'sidebar.panellist'], 'injects both seats, outer first');
assert.equal(seats.length, 2, 'registers exactly two seats');

const main = seats.find((seat) => seat.options.name === 'main');
const rail = seats.find((seat) => seat.options.name === 'sidebar.panellist');
assert.ok(main, 'main seat');
assert.ok(rail, 'sidebar seat');
assert.equal(main.options.key, rail.options.id, 'the main seat is keyed by the rail id');
assert.equal(typeof rail.options.label, 'function');
assert.match(rail.options.label(), /雷达/);
assert.equal(typeof rail.options.order, 'number');
assert.equal(typeof main.component, 'function');
assert.equal(typeof rail.component, 'function');
console.log('  ok  main + rail registered, ids agree, label present');

const icon = rail.component();
assert.ok(icon !== null && typeof icon === 'object', 'icon renders an element');
assert.ok(JSON.stringify(icon).includes('svg'), 'icon is an svg');
console.log('  ok  rail icon renders an svg');

// A host without slots must fail soft, not throw.
const before = seats.length;
mod.apply({});
assert.equal(seats.length, before, 'no registration without a slots service');
mod.apply(null);
console.log('  ok  a host without slots is survived');

console.log('\nclient: all checks passed');
