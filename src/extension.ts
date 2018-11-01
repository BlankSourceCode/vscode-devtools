import * as path from 'path';
import * as vscode from 'vscode';
import WebSocket from 'ws';
import QuickPickItem = vscode.QuickPickItem;
import QuickPickOptions = vscode.QuickPickOptions;
import * as utils from './utils';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('devtools-for-chrome.attach', async () => {
        runCommand(context, attach);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('devtools-for-chrome.launch', async () => {
        runCommand(context, launch);
    }));
}

function runCommand(context: vscode.ExtensionContext, command: (context: vscode.ExtensionContext, hostname: string, port: number) => void) {
    const settings = vscode.workspace.getConfiguration('vscode-devtools-for-chrome');
    const hostname = settings.get('hostname') as string || 'localhost';
    const port = settings.get('port') as number || 9222;

    command(context, hostname, port);
}

async function launch(context: vscode.ExtensionContext, hostname: string, port: number) {
    const portFree = await utils.isPortFree(hostname, port);
    if (portFree) {
        const settings = vscode.workspace.getConfiguration('vscode-devtools-for-chrome');
        const pathToChrome = settings.get('chromePath') as string || utils.getPathToChrome();
        if (!pathToChrome || !utils.existsSync(pathToChrome)) {
            vscode.window.showErrorMessage('Chrome was not found. Chrome must be installed for this extension to function. If you have Chrome installed at a custom location you can speficy it in the \'chromePath\' setting.');
            return;
        }
        utils.launchLocalChrome(pathToChrome, port, 'about:blank');
    }

    attach(context, hostname, port);
}

async function attach(context: vscode.ExtensionContext, hostname: string, port: number) {
    const checkDiscoveryEndpoint = (url: string) => {
        return utils.getURL(url, { headers: { Host: 'localhost' } });
    };

    const jsonResponse = await checkDiscoveryEndpoint(`http://${hostname}:${port}/json/list`)
        .catch(() => checkDiscoveryEndpoint(`http://${hostname}:${port}/json`));

    const responseArray = JSON.parse(jsonResponse);
    if (Array.isArray(responseArray)) {
        const items: QuickPickItem[] = [];

        responseArray.forEach(i => {
            i = utils.fixRemoteUrl(hostname, port, i);
            items.push({ label: i.title, description: i.url, detail: i.webSocketDebuggerUrl });
        });

        vscode.window.showQuickPick(items).then((selection) => {
            if (selection) {
                DevToolsPanel.createOrShow(context.extensionPath, selection.detail as string);
            }
        });
    }
}

class DevToolsPanel {
    private static currentPanel: DevToolsPanel;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionPath: string;
    private readonly _targetUrl: string;
    private _socket: WebSocket = undefined;
    private _isConnected: boolean = false;
    private _messages: any[] = [];
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionPath: string, targetUrl: string) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (DevToolsPanel.currentPanel) {
            DevToolsPanel.currentPanel._panel.reveal(column);
        } else {
            const panel = vscode.window.createWebviewPanel('devtools-for-chrome', 'DevTools', column || vscode.ViewColumn.Two, {
                enableScripts: true,
                enableCommandUris: true,
                retainContextWhenHidden: true
            });

            DevToolsPanel.currentPanel = new DevToolsPanel(panel, extensionPath, targetUrl);
        }
    }

    public static revive(panel: vscode.WebviewPanel, extensionPath: string, targetUrl: string) {
        DevToolsPanel.currentPanel = new DevToolsPanel(panel, extensionPath, targetUrl);
    }

    private constructor(panel: vscode.WebviewPanel, extensionPath: string, targetUrl: string) {
        this._panel = panel;
        this._extensionPath = extensionPath;
        this._targetUrl = targetUrl;

        this._update();

        // Handle closing
        this._panel.onDidDispose(() => {
            this.dispose();
        }, undefined, this._disposables);

        // Handle view change
        this._panel.onDidChangeViewState(e => {
            if (this._panel.visible) {
                this._update();
            }
        }, undefined, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(message => {
            this._onMessageFromWebview(message);
        }, undefined, this._disposables);
    }

    public dispose() {
        DevToolsPanel.currentPanel = undefined;

        this._panel.dispose();
        this._disposeSocket();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _disposeSocket() {
        if (this._socket) {
            // Reset the socket since the devtools have been reloaded
            this._socket.onerror = undefined;
            this._socket.onopen = undefined;
            this._socket.onclose = undefined;
            this._socket.onmessage = undefined;
            this._socket.close();
            this._socket = undefined;
        }
    }

    private _onMessageFromWebview(message: string) {
        if (message === 'ready') {
            this._disposeSocket();
        }

        if (!this._socket) {
            // First message, so connect a real websocket to the target
            this._connectToTarget();
        } else if (!this._isConnected) {
            // DevTools are sending a message before the real websocket has finished opening so cache it
            this._messages.push(message);
        } else {
            // Websocket ready so send the message directly
            this._socket.send(message);
        }
    }

    private _connectToTarget() {
        const url = this._targetUrl;

        // Create the websocket
        this._socket = new WebSocket(url);
        this._socket.onerror = this._onError.bind(this);
        this._socket.onopen = this._onOpen.bind(this);
        this._socket.onmessage = this._onMessage.bind(this);
        this._socket.onclose = this._onClose.bind(this);
    }

    private _onError() {
        if (this._isConnected) {
            // Tell the devtools that there was a connection error
            this._panel.webview.postMessage('error');
        }
    }

    private _onOpen() {
        this._isConnected = true;
        // Tell the devtools that the real websocket was opened
        this._panel.webview.postMessage('open');

        if (this._socket) {
            // Forward any cached messages onto the real websocket
            for (const message of this._messages) {
                this._socket.send(message);
            }
            this._messages = [];
        }
    }

    private _onMessage(message: any) {
        if (this._isConnected) {
            // Forward the message onto the devtools
            this._panel.webview.postMessage(message.data);
        }
    }

    private _onClose() {
        if (this._isConnected) {
            // Tell the devtools that the real websocket was closed
            this._panel.webview.postMessage('close');
        }
        this._isConnected = false;
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview() {
        const htmlPath = vscode.Uri.file(path.join(this._extensionPath, 'out', 'host', 'devtools.html'));
        const htmlUri = htmlPath.with({ scheme: 'vscode-resource' });

        const scriptPath = vscode.Uri.file(path.join(this._extensionPath, 'out', 'host', 'messaging.js'));
        const scriptUri = scriptPath.with({ scheme: 'vscode-resource' });

        return `
            <!doctype html>
            <html>
            <head>
                <meta http-equiv="content-type" content="text/html; charset=utf-8">
                <style>
                    html, body {
                        height: 100%;
                        width: 100%;
                        padding: 0;
                        margin: 0;
                        overflow: hidden;
                    }
                </style>
                <script src="${scriptUri}"></script>
            </head>
            <iframe id="host" style="width: 100%; height: 100%" frameBorder="0" src="${htmlUri}"></iframe>
            </html>
            `;
    }
}