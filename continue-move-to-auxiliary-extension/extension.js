// @ts-check
'use strict';

const vscode = require('vscode');
const http = require('http');
const https = require('https');
const { URL } = require('url');

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
  }

  /**
   * @param {vscode.WebviewView} webviewView
   */
  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = renderHtml();

    webviewView.webview.onDidReceiveMessage((message) => {
      if (!message) {
        return;
      }
      if (message.type === 'refresh' || message.type === 'ready') {
        this.refresh();
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh();
      }
    });

    this.refresh();
  }

  async refresh() {
    if (!this._view) {
      return;
    }
    const config = vscode.workspace.getConfiguration('continueAuxiliaryLayout');
    const endpoint = String(config.get('usageEndpoint', '')).replace(/\/+$/, '');

    if (!endpoint) {
      this.post({ type: 'error', message: 'Usage endpoint not configured.' });
      return;
    }

    const url = `${endpoint}/usage`;
    try {
      const payload = await fetchJson(url);
      this.post({ type: 'data', payload });
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
  .model-label { color: #000; font-weight: 700; opacity: 1; }
  .model-name { color: #000; font-weight: 700; }
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
  .refresh-bar {
    margin-top: 12px;
    display: flex;
    justify-content: flex-end;
  }
  button.refresh {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--vscode-button-secondaryBackground, color-mix(in srgb, currentColor 12%, transparent));
    color: var(--vscode-button-secondaryForeground, inherit);
    border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
    font-weight: 500;
    letter-spacing: 0.2px;
    transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
  }
  button.refresh:hover {
    background: var(--vscode-button-secondaryHoverBackground, color-mix(in srgb, currentColor 22%, transparent));
    border-color: color-mix(in srgb, currentColor 45%, transparent);
  }
  button.refresh:active {
    transform: translateY(1px);
  }
  button.refresh:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, currentColor);
    outline-offset: 2px;
  }
  button.refresh svg {
    width: 12px;
    height: 12px;
    transition: transform 400ms ease;
  }
  button.refresh.spinning svg {
    transform: rotate(360deg);
  }
</style>
</head>
<body>
  <div id="content">
    <div class="status">Loading…</div>
  </div>
  <div class="refresh-bar">
    <button class="refresh" id="refresh" type="button" title="Refresh usage">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89" />
        <path d="M13.5 2.5v3h-3" />
      </svg>
      <span>Refresh</span>
    </button>
  </div>
<script>
  const vscode = acquireVsCodeApi();
  const content = document.getElementById('content');
  const refreshBtn = document.getElementById('refresh');
  refreshBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
    refreshBtn.classList.add('spinning');
    setTimeout(() => refreshBtn.classList.remove('spinning'), 400);
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
    return \`
      <div class="model-block">
        <div class="section">
          <div class="row"><span class="model-label"><strong>Model</strong></span><span class="model-name">\${escapeHtml(model.model || 'unknown')}</span></div>
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
      if (models.length === 0) {
        content.innerHTML = '<div class="status">No usage recorded yet.</div>';
        return;
      }
      content.innerHTML = models.map((model) => renderModelBlock(model, limits)).join('');
    }
  }

  window.addEventListener('message', (event) => render(event.data));
  vscode.postMessage({ type: 'ready' });
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
      if (event.affectsConfiguration('continueAuxiliaryLayout.usageEndpoint')) {
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
