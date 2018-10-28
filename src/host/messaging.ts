declare var acquireVsCodeApi: () => any;
const vscode = acquireVsCodeApi();

let toolsWindow: Window = undefined;

window.addEventListener('message', messageEvent => {
    if (!toolsWindow) {
        // Find the iframe that contains the devtools
        toolsWindow = (document.getElementById('host') as HTMLIFrameElement).contentWindow;
    }

    if (messageEvent.origin === 'vscode-resource://') {
        // Pass the message onto the extension
        vscode.postMessage(messageEvent.data);
    } else if (toolsWindow) {
        // Pass the message onto the devtools
        toolsWindow.postMessage(messageEvent.data, '*');
    }
});


