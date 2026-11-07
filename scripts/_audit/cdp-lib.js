/**
 * Minimal Chrome DevTools Protocol client (no external dependencies).
 * Node 24 provides global fetch and WebSocket.
 */
const fs = require('fs');

async function newTab(url = 'about:blank') {
  const res = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  return res.json();
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.errors = [];
    this.warnings = [];
    this.console = [];
    this.network = [];
    this.requests = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = (e) => reject(new Error('WS error'));
    });
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method) this._emit(msg.method, msg.params);
    };
  }
  _emit(method, params) {
    if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails || {};
      const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'Unknown exception';
      this.errors.push(String(text).split('\n')[0]);
    }
    if (method === 'Runtime.consoleAPICalled') {
      const text = (params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
      this.console.push({ type: params.type, text });
      if (params.type === 'error') this.errors.push(text);
      if (params.type === 'warning') this.warnings.push(text);
    }
    if (method === 'Log.entryAdded') {
      const e = params.entry || {};
      if (e.level === 'error') this.errors.push(e.text || '');
      if (e.level === 'warning') this.warnings.push(e.text || '');
    }
    if (method === 'Network.requestWillBeSent') {
      const r = params.request || {};
      this.requests.set(params.requestId, { url: r.url, method: r.method, headers: r.headers });
    }
    if (method === 'Network.responseReceived') {
      const r = params.response || {};
      if (r.status >= 400) this.network.push({ status: r.status, url: r.url, method: params.type, requestId: params.requestId, fromDiskCache: r.fromDiskCache, fromServiceWorker: r.fromServiceWorker });
    }
    const list = this.handlers.get(method);
    if (list) list.forEach(fn => fn(params));
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
      }, 30000);
    });
  }
  async evaluate(expression, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) {
      throw new Error('Eval error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result ? r.result.value : undefined;
  }
  async waitFor(expression, timeoutMs = 15000, interval = 250) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { if (await this.evaluate(expression)) return true; } catch (e) {}
      await new Promise(r => setTimeout(r, interval));
    }
    return false;
  }
  async goto(url) {
    const loaded = new Promise(resolve => {
      const fn = () => resolve();
      this.on('Page.loadEventFired', fn);
    });
    await this.send('Page.navigate', { url });
    await Promise.race([loaded, new Promise(r => setTimeout(r, 15000))]);
    await new Promise(r => setTimeout(r, 800));
  }
  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function openPage(url) {
  const tab = await newTab(url || 'about:blank');
  const cdp = new CDP(tab.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  try { await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) {}
  if (url) await cdp.goto(url);
  return cdp;
}

module.exports = { CDP, openPage, newTab };
