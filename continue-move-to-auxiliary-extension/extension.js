// @ts-check
'use strict';

const vscode = require('vscode');
const http = require('http');
const https = require('https');
const os = require('os');
const { URL } = require('url');

function detectLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  return '';
}

/**
 * @param {string} url
 * @returns {Promise<any>}
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(url, { timeout: 5000 }, (response) => {
      const status = response.statusCode || 0;
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.on('error', reject);
  });
}

class AiUsageViewProvider {
  constructor() {
    /** @type {vscode.WebviewView | undefined} */
    this._view = undefined;
    /** @type {NodeJS.Timeout | undefined} */
    this._timer = undefined;
  }

  /**
   * @param {vscode.WebviewView} webviewView
   */
  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = renderHtml();

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message && message.type === 'refresh') {
        this.refresh();
      }
    });

    webviewView.onDidDispose(() => {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = undefined;
      }
    });

    this.refresh();
    this.scheduleRefresh();
  }

  scheduleRefresh() {
    if (this._timer) {
      clearInterval(this._timer);
    }
    const config = vscode.workspace.getConfiguration('continueAuxiliaryLayout');
    const seconds = Math.max(5, config.get('usageRefreshSeconds', 15));
    this._timer = setInterval(() => this.refresh(), seconds * 1000);
  }

  async refresh() {
    if (!this._view) {
      return;
    }
    const config = vscode.workspace.getConfiguration('continueAuxiliaryLayout');
    const endpoint = String(config.get('usageEndpoint', '')).replace(/\/+$/, '');
    const overrideIp = String(config.get('usageIp', '') || '').trim();
    const ip = overrideIp || detectLocalIp();

    if (!endpoint) {
      this.post({ type: 'error', message: 'Usage endpoint not configured.' });
      return;
    }
    if (!ip) {
      this.post({ type: 'error', message: 'Could not determine local IP.' });
      return;
    }

    const url = `${endpoint}/usage/${encodeURIComponent(ip)}`;
    try {
      const payload = await fetchJson(url);
      this.post({ type: 'data', payload, ip });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.post({ type: 'error', message: `Failed to load usage: ${message}` });
    }
  }

  /**
   * @param {object} message
   */
  post(message) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }
}

function renderHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    font-size: 12px;
    padding: 12px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
    gap: 8px;
  }
  .row span:last-child {
    text-align: right;
    word-break: break-all;
  }
  .muted { opacity: 0.6; }
  .bar {
    width: 100%;
    height: 2px;
    background: color-mix(in srgb, currentColor 20%, transparent);
    position: relative;
    margin-top: 4px;
  }
  .fill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: currentColor;
    width: 0%;
    transition: width 200ms ease-out;
  }
  .section { margin-bottom: 14px; }
  .model-block { margin-bottom: 12px; }
  .status { opacity: 0.6; font-style: italic; }
  button.refresh {
    background: transparent;
    color: inherit;
    border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  button.refresh:hover {
    background: color-mix(in srgb, currentColor 10%, transparent);
  }
</style>
</head>
<body>
  <div id="content">
    <div class="status">Loading…</div>
  </div>
  <div style="margin-top: 8px;">
    <button class="refresh" id="refresh">Refresh</button>
  </div>
<script>
  const vscode = acquireVsCodeApi();
  const content = document.getElementById('content');
  document.getElementById('refresh').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
  });

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderModelBlock(model, limits) {
    const inputLimit = (limits && limits.input_tokens) || 0;
    const outputLimit = (limits && limits.output_tokens) || 0;
    const inputPct = inputLimit > 0 ? Math.min(100, (model.input_tokens / inputLimit) * 100) : 0;
    const outputPct = outputLimit > 0 ? Math.min(100, (model.output_tokens / outputLimit) * 100) : 0;
    const overallPct = Math.max(inputPct, outputPct);
    return \`
      <div class="model-block">
        <div class="section">
          <div class="row"><span class="muted">Model</span><span>\${escapeHtml(model.model || 'unknown')}</span></div>
        </div>
        <div class="section">
          <div class="row"><span class="muted">Usage</span><span>\${overallPct.toFixed(1)}%</span></div>
          <div class="bar"><div class="fill" style="width: \${overallPct}%"></div></div>
        </div>
        <div class="section">
          <div class="row"><span class="muted">Input</span><span>\${model.input_tokens.toLocaleString()} / \${inputLimit.toLocaleString()}</span></div>
          <div class="bar"><div class="fill" style="width: \${inputPct}%"></div></div>
        </div>
        <div class="section">
          <div class="row"><span class="muted">Output</span><span>\${model.output_tokens.toLocaleString()} / \${outputLimit.toLocaleString()}</span></div>
          <div class="bar"><div class="fill" style="width: \${outputPct}%"></div></div>
        </div>
      </div>
    \`;
  }

  function render(message) {
    if (message.type === 'error') {
      content.innerHTML = \`<div class="status">\${escapeHtml(message.message)}</div>\`;
      return;
    }
    if (message.type === 'data') {
      const payload = message.payload || {};
      const limits = payload.limits || {};
      const models = Array.isArray(payload.models) ? payload.models : [];
      const header = \`<div class="row"><span class="muted">IP</span><span>\${escapeHtml(payload.ip || message.ip || '')}</span></div>\`;
      if (models.length === 0) {
        content.innerHTML = header + '<div class="status">No usage recorded yet.</div>';
        return;
      }
      content.innerHTML = header + models.map((model) => renderModelBlock(model, limits)).join('');
    }
  }

  window.addEventListener('message', (event) => render(event.data));
</script>
</body>
</html>`;
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const config = vscode.workspace.getConfiguration('continueAuxiliaryLayout');
  const viewIds = config.get('viewIds', ['continue.continueGUIView']);
  const destinationContainerId = config.get('destinationContainerId', 'workbench.panel.chat');
  const ensureVisible = config.get('ensureSecondarySideBarVisible', true);
  const retryDelays = config.get('retryDelaysMs', [400, 1800, 4500]);

  const provider = new AiUsageViewProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'continueAuxiliaryLayout.aiUsageView',
      provider,
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('continueAuxiliaryLayout.usageEndpoint') ||
        event.affectsConfiguration('continueAuxiliaryLayout.usageIp') ||
        event.affectsConfiguration('continueAuxiliaryLayout.usageRefreshSeconds')
      ) {
        provider.scheduleRefresh();
        provider.refresh();
      }
    }),
  );

  async function attemptMove() {
    if (ensureVisible) {
      await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
    }
    await vscode.commands.executeCommand('vscode.moveViews', {
      viewIds,
      destinationId: destinationContainerId,
    });
  }

  for (const delay of retryDelays) {
    const timer = setTimeout(() => {
      attemptMove().catch(() => {
        // Ignore — Continue may not be registered yet on this attempt
      });
    }, delay);
    context.subscriptions.push({ dispose: () => clearTimeout(timer) });
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
