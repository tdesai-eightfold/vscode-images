// @ts-check
'use strict';

const vscode = require('vscode');

const MOCK_MODEL_NAME = 'claude-sonnet-4-6';
const MOCK_USAGE_PERCENT = 42;
const MOCK_TOKENS_USED = 84_000;
const MOCK_TOKENS_LIMIT = 200_000;

class AiUsageViewProvider {
  /**
   * @param {vscode.WebviewView} webviewView
   */
  resolveWebviewView(webviewView) {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = renderHtml();
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
    width: ${MOCK_USAGE_PERCENT}%;
  }
  .section { margin-bottom: 14px; }
</style>
</head>
<body>
  <div class="section">
    <div class="row"><span class="muted">Model</span><span>${MOCK_MODEL_NAME}</span></div>
  </div>
  <div class="section">
    <div class="row"><span class="muted">Usage</span><span>${MOCK_USAGE_PERCENT}%</span></div>
    <div class="bar"><div class="fill"></div></div>
  </div>
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

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'continueAuxiliaryLayout.aiUsageView',
      new AiUsageViewProvider(),
    ),
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
