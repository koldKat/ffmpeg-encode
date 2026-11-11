const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../public/startup-recovery.js'), 'utf8');

function setup(online = true, store = new Map(), storageThrows = false) {
  const handlers = new Map();
  const timers = new Map();
  let timerId = 0, removed = false, reloads = 0;
  const retry = { hidden: false, addEventListener: (_, fn) => handlers.set('click', fn) };
  const message = { textContent: 'Loading Gamebook Tracker...' };
  const panel = { isConnected: true, style: {}, parentNode: { append() {} }, remove: () => { removed = true; } };
  const nodes = { 'app-startup': panel, 'app-startup-message': message, 'app-startup-retry': retry };
  const window = {
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: name => handlers.delete(name),
  };
  const navigator = { onLine: online };
  vm.runInNewContext(source, {
    window, document: { getElementById: id => nodes[id] ?? (['session-resume','session-screen'].includes(id) ? panel : undefined) },
    navigator, location: { pathname: '/mobile/', search: '?book=1', reload: () => reloads++ },
    sessionStorage: {
      getItem: key => { if (storageThrows) throw Error('Storage denied'); return store.get(key) ?? null; },
      setItem: (key, value) => { if (storageThrows) throw Error('Storage denied'); store.set(key, value); },
      removeItem: key => { if (storageThrows) throw Error('Storage denied'); store.delete(key); },
    },
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  return { window, retry, message, handlers, navigator, timers, store,
    tick: (ms = 12000) => {
      const entry = [...timers.entries()].find(([, timer]) => timer.ms === ms);
      assert.ok(entry, `expected a ${ms}ms timer`);
      timers.delete(entry[0]); entry[1].fn();
    },
    get removed() { return removed; },
    get reloads() { return reloads; } };
}

test('slow startup keeps waiting without offering retry or reloading', () => {
  const s = setup();
  assert.equal(s.retry.hidden, true);
  s.tick();
  assert.match(s.message.textContent, /longer than usual|повече време/);
  assert.equal(s.retry.hidden, true);
  assert.equal(s.reloads, 0);
  assert.equal(s.timers.size, 0);
});

test('offline startup explains reconnection; successful startup disposes its watchdog', () => {
  const s = setup(false);
  s.tick();
  assert.match(s.message.textContent, /offline|интернет/);
  s.window.appStartup.ready();
  s.window.appStartup.ready();
  assert.equal(s.timers.size, 0);
  assert.equal(s.removed, true);
  assert.equal(s.handlers.has('error'), false);
  assert.equal(s.handlers.has('online'), false);
  assert.equal(s.handlers.has('offline'), false);
  assert.equal(s.store.size, 0);
});

test('script failures schedule automatic recovery; unrelated image failures do not', () => {
  const s = setup();
  s.handlers.get('error')({ target: { tagName: 'IMG' } });
  assert.equal(s.retry.hidden, true);
  s.handlers.get('error')({ target: { tagName: 'SCRIPT' } });
  assert.match(s.message.textContent, /could not start|не успя/);
  assert.equal(s.retry.hidden, true);
  assert.equal(s.timers.size, 1);
  assert.equal([...s.timers.values()][0].ms, 2000);
  s.window.appStartup.ready();
  assert.equal(s.removed, true);
  assert.equal(s.timers.size, 0);
  assert.equal(s.reloads, 0);
});

test('startup retries have increasing delays and stop after three reloads across page loads', () => {
  const store = new Map();
  for (const delay of [2000, 5000, 10000]) {
    const s = setup(true, store);
    s.window.appStartup.fail();
    s.window.appStartup.fail();
    assert.equal(s.timers.size, 1, 'duplicate errors do not schedule duplicate retries');
    assert.equal(s.retry.hidden, true);
    s.tick(delay);
    assert.equal(s.reloads, 1);
  }
  const s = setup(true, store);
  s.window.appStartup.fail();
  assert.equal(s.timers.size, 0);
  assert.equal(s.reloads, 0);
  assert.equal(s.retry.hidden, false);
  s.handlers.get('click')();
  assert.equal(s.reloads, 1);
  assert.equal(store.size, 0, 'manual recovery starts a new retry budget');
});

test('offline failures wait for connectivity and do not consume retry attempts', () => {
  const s = setup(false);
  s.window.appStartup.fail();
  assert.equal(s.timers.size, 0);
  assert.match(s.message.textContent, /reconnect|възстанови/);
  s.navigator.onLine = true;
  s.handlers.get('online')();
  assert.equal(s.timers.size, 1);
  s.navigator.onLine = false;
  s.handlers.get('offline')();
  assert.equal(s.timers.size, 0);
  assert.equal(JSON.parse([...s.store.values()][0]).attempts, 0);
  s.navigator.onLine = true;
  s.handlers.get('online')();
  s.tick(2000);
  assert.equal(s.reloads, 1);
});

test('reconnection does not reload a startup that is still progressing', () => {
  const s = setup(false);
  s.tick();
  s.navigator.onLine = true;
  s.handlers.get('online')();
  assert.equal(s.timers.size, 0);
  assert.equal(s.reloads, 0);
  assert.equal(s.retry.hidden, true);
});

test('blocked session storage falls back to manual recovery without an automatic reload loop', () => {
  const s = setup(true, new Map(), true);
  s.window.appStartup.fail();
  assert.equal(s.retry.hidden, false);
  assert.equal(s.timers.size, 0);
  assert.equal(s.reloads, 0);
});

test('malformed or expired retry state does not prevent a fresh recovery attempt', () => {
  for (const saved of ['bad JSON', JSON.stringify({ attempts: 3, startedAt: Date.now() - 300001 })]) {
    const s = setup(true, new Map([['app-startup-retries:/mobile/?book=1', saved]]));
    s.window.appStartup.fail();
    s.tick(2000);
    assert.equal(s.reloads, 1);
  }
});


test('successful startup permanently disables automatic recovery in this page', () => {
  const s = setup();
  assert.equal(s.window.appStartup.pending, true);
  s.window.appStartup.ready();
  assert.equal(s.window.appStartup.pending, false);
  s.window.appStartup.fail();
  assert.equal(s.timers.size, 0);
  assert.equal(s.reloads, 0);
});

test('the independent recovery script is loaded before the application module', () => {
  const html = readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(html.indexOf('id="app-startup-message"') < html.indexOf('<script src="/startup-recovery.js">'));
  assert.ok(html.indexOf('<script src="/startup-recovery.js">') < html.indexOf('<script type="module"'));
  assert.match(html, /id="app-startup-retry"[^>]*hidden/);
});

const APP_KIND='ffmpeg';

function getBoot(file, name) {
  const text = readFileSync(path.join(__dirname, '../public/', file), 'utf8');
  const start = text.indexOf('async function '+name+'() {');
  assert.ok(start >= 0);
  return text.slice(start, text.indexOf('\n}\n', start)+2);
}
for (const result of ['success', 'offline', 'server', 'timeout', 'expired']) {
  test('startup session recovery: '+result, async () => {
    const calls = { ready:0, fail:0, cleared:0, auth:0 }, screens=[];
    const error = new Error(result);
    if (result==='server') error.status=503;
    if (result==='expired') error.status=401;
    if (result==='timeout') error.name='TimeoutError';
    const request = async () => { if (result!=='success') throw error; return { user:{id:1} }; };
    const context = {
      appStartup:{ready(){calls.ready++;},fail(){calls.fail++;}},
      getToken:()=> 'saved',clearToken:()=>calls.cleared++,showScreen:name=>screens.push(name),hydrateApp:request,
      initI18n:async()=>{},authController:{openInitialReset:()=>false},postDetailController:{openInitialRoute:async()=>{}},editorTools:{initializeControls(){}},
      setAuthState(){},feedController:{loadPublicFeed:async()=>({})},takeStartupData:async()=>null,openEvents(){},
    };
    context.globalThis=context;
    if (APP_KIND==='games') {
      context.setAuthMode=()=>{};context.activityFeed={start(){}};context.loadConfig=()=>{};context.loadAuthCovers=()=>{};
      context.URLSearchParams=URLSearchParams;context.window={location:{search:'',pathname:'/'}};
      context.showAuth=()=>{calls.auth++;calls.ready++;};context.enterApp=async()=>calls.ready++;context.api=request;
      const text=readFileSync(path.join(__dirname,'../public/js/boot/start.js'),'utf8');
      const block=text.slice(text.indexOf('export function restoreSession()')).replace('export function','function');
      await vm.runInNewContext(block+';restoreSession().catch(()=>globalThis.appStartup.fail());',context);
    } else {
      const file=APP_KIND==='howlers'?'js/app.js':'js/app.js';
      await vm.runInNewContext(getBoot(file,'boot')+';boot().then(()=>{'+(APP_KIND==='howlers'?'globalThis.appStartup.ready();':'')+'}).catch(()=>globalThis.appStartup.fail());',context);
    }
    assert.equal(calls.cleared,result==='expired' && APP_KIND!=='games'?1:0);
    assert.equal(calls.fail,['offline','server','timeout'].includes(result)?1:0);
    assert.equal(calls.ready,['success','expired'].includes(result)?1:0);
  });
}
