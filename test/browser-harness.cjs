// Isolated Chromium/CDP runner for dashboard interaction regressions.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function checkBrowser({ file, url, profile, root, width, chromium, timeoutMs = 20000, screenshotPath, screenshotCheck, collectBrowserMemory = false, onPage }) {
  if (!chromium || !fs.existsSync(chromium)) throw Error('Set CHROMIUM to a headless Chromium executable');
  const env = { ...process.env, TMPDIR: root };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  const child = spawn('nice', ['-n', '15', chromium, '--headless=new', '--no-sandbox', '--disable-gpu',
    '--allow-file-access-from-files', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--window-size=' + width + ',900', 'about:blank'],
  { env, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  const signalGroup = signal => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  let diagnostic = '', socket;
  child.stderr.on('data', bytes => { diagnostic = (diagnostic + bytes).slice(-2000); });
  const exited = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  // Attach immediately so a failed spawn cannot leave an unhandled rejection.
  exited.catch(() => {});
  try {
    const endpoint = profile + '/DevToolsActivePort';
    for (let index = 0; index < 200 && !fs.existsSync(endpoint); index++) {
      if (child.exitCode !== null) throw Error('Browser exited: ' + diagnostic);
      await delay(25);
    }
    if (!fs.existsSync(endpoint)) throw Error('Browser did not start: ' + diagnostic);
    const [port, route] = fs.readFileSync(endpoint, 'utf8').trim().split('\n');
    socket = new WebSocket('ws://127.0.0.1:' + port + route);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const pending = new Map();
    let next = 0, runtimeFailure = "";
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), handler = pending.get(message.id);
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        runtimeFailure = details.exception?.description || `${details.text} at ${details.url}:${details.lineNumber + 1}`;
      }
      if (!handler) return;
      pending.delete(message.id);
      if (message.error) handler.reject(Error(JSON.stringify(message.error))); else handler.resolve(message.result);
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('Page.bringToFront', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Page.navigate', { url: url || 'file://' + file }, sessionId);
    if (onPage) {
      try { await onPage({ send: (method, params = {}) => send(method, params, sessionId) }); }
      catch (error) {
        if (screenshotPath) {
          const capture = await send('Page.captureScreenshot', {format:'jpeg',quality:85,captureBeyondViewport:false}, sessionId);
          fs.writeFileSync(screenshotPath.replace('.jpg','-failure.jpg'), Buffer.from(capture.data,'base64'));
        }
        throw error;
      }
    }
    let last;
    for (let index = 0; index < Math.ceil(timeoutMs / 100); index++) {
      const { result } = await send('Runtime.evaluate', {
        expression: '({test:document.body?.getAttribute("data-test"),failure:document.body?.getAttribute("data-failure"),progress:document.body?.getAttribute("data-progress")})',
        returnByValue: true,
      }, sessionId);
      last = result.value;
      if (last?.failure) throw Error('Browser assertion: ' + last.failure + (runtimeFailure ? '\n' + runtimeFailure : ''));
      if (last?.test) {
        if (screenshotCheck) {
          const capture = await send('Page.captureScreenshot', {format:'png',captureBeyondViewport:false}, sessionId);
          if (screenshotPath) fs.writeFileSync(screenshotPath, Buffer.from(capture.data, 'base64'));
          const probe = await send('Runtime.evaluate', {expression: `(${screenshotCheck})(${JSON.stringify(capture.data)})`, awaitPromise:true, returnByValue:true}, sessionId);
          if (probe.exceptionDetails || probe.result?.value !== true) throw Error('Screenshot check failed: ' + JSON.stringify(probe.exceptionDetails || probe.result));
        }
        if (screenshotPath && !screenshotCheck) {
          const capture = await send('Page.captureScreenshot', {format:'jpeg',quality:75,captureBeyondViewport:false}, sessionId);
          fs.writeFileSync(screenshotPath, Buffer.from(capture.data, 'base64'));
        }
        const report=JSON.parse(last.test);
        if(collectBrowserMemory){
          report.heap=await send('Runtime.getHeapUsage',{},sessionId);
          report.dom=await send('Memory.getDOMCounters',{},sessionId);
        }
        return report;
      }
      await delay(100);
    }
    throw Error('Browser did not complete: ' + JSON.stringify(last));
  } finally {
    socket?.close();
    signalGroup('SIGTERM');
    await Promise.race([exited, delay(3000)]);
    signalGroup('SIGKILL');
    if (child.exitCode === null && child.signalCode === null) await exited;
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
};
