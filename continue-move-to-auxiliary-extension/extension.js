// @ts-check
'use strict';

const vscode = require('vscode');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const config = vscode.workspace.getConfiguration('continueAuxiliaryLayout');
  const viewIds = config.get('viewIds', ['continue.continueGUIView']);
  const destinationContainerId = config.get('destinationContainerId', 'workbench.panel.chat');
  const ensureVisible = config.get('ensureSecondarySideBarVisible', true);
  const retryDelays = config.get('retryDelaysMs', [400, 1800, 4500]);

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
