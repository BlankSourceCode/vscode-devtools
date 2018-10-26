declare var acquireVsCodeApi: () => any;

let toolsWindow: Window | null = null;

window.addEventListener('message', messageEvent => {
    if (!toolsWindow) {
        toolsWindow = (document.getElementById('host') as HTMLIFrameElement).contentWindow;
    }

    if (messageEvent.origin === 'vscode-resource://') {
        vscode.postMessage(messageEvent.data);
    } else if (toolsWindow) {
        toolsWindow.postMessage(messageEvent.data, "*");
    }
});

const vscode = acquireVsCodeApi();
vscode.postMessage({
    command: 'ready'
});
