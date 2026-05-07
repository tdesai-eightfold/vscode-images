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

  const localStorageTimer = setTimeout(() => {
    const panel = vscode.window.createWebviewPanel(
      'continueLocalStorageInit',
      'Continue Init',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      { enableScripts: true }
    );

    panel.webview.html = `<!DOCTYPE html><html><body><script>
      // Onboarding card — "Completed" hides it; "Started" does not
      localStorage.setItem("onboardingStatus", '"Completed"');
      localStorage.setItem("hasDismissedOnboardingCard", "true");
      // Explore dialog
      localStorage.setItem("hasDismissedExploreDialog", "true");
      // Free trial / promo UI
      localStorage.setItem("hasExitedFreeTrial", "true");
      // Tutorial card
      localStorage.setItem("showTutorialCard", "false");
      // Profiles introduction banner
      localStorage.setItem("shownProfilesIntroduction", "true");
      // CLI install banner
      localStorage.setItem("hasDismissedCliInstallBanner", "true");
      const vscode = acquireVsCodeApi();
      vscode.postMessage({ done: true });
    </script></body></html>`;

    panel.webview.onDidReceiveMessage(() => panel.dispose());

    context.subscriptions.push(panel);
  }, 500);

  context.subscriptions.push({ dispose: () => clearTimeout(localStorageTimer) });
}

function deactivate() {}

module.exports = { activate, deactivate };
