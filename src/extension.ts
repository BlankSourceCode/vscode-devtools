import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as url from 'url';
import * as vscode from 'vscode';
import * as WebSocket from 'ws';
import QuickPickItem = vscode.QuickPickItem;
import QuickPickOptions = vscode.QuickPickOptions;

export function activate(context: vscode.ExtensionContext) {

    context.subscriptions.push(vscode.commands.registerCommand('devtools.start', async () => {
        //DevToolsPanel.createOrShow(context.extensionPath);

        const opts: QuickPickOptions = { matchOnDescription: true, placeHolder: "Select a target" };
        const items: QuickPickItem[] = [];

        const address = "localhost";
        const port = 9222;

        const checkDiscoveryEndpoint = (url: string) => {
            return getURL(url, { headers: { Host: 'localhost' } });
        };

        const jsonResponse = await checkDiscoveryEndpoint(`http://${address}:${port}/json/list`)
            .catch(() => checkDiscoveryEndpoint(`http://${address}:${port}/json`));

        const responseArray = JSON.parse(jsonResponse);
        if (Array.isArray(responseArray)) {
            responseArray.forEach(i => {
                i = fixRemoteUrl(address, port, i);
                items.push({ label: i.title, description: i.url, detail: i.webSocketDebuggerUrl });
            });
        }

        vscode.window.showQuickPick(items).then((selection) => {
            if (selection) {
                DevToolsPanel.createOrShow(context.extensionPath, selection.detail as string);
            }
        });
    }));

    if (vscode.window.registerWebviewPanelSerializer) {
        vscode.window.registerWebviewPanelSerializer(DevToolsPanel.viewType, {
            async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
                console.log(`Got state: ${state}`);
                DevToolsPanel.revive(webviewPanel, context.extensionPath, state.targetUrl);
            }
        });
    }
}

function getURL(aUrl: string, options: https.RequestOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(aUrl);
        const get = parsedUrl.protocol === 'https:' ? https.get : http.get;
        options = <http.RequestOptions>{
            rejectUnauthorized: false,
            ...parsedUrl,
            ...options
        };

        get(options, (response) => {
            let responseData = '';
            response.on('data', chunk => {
                responseData += chunk.toString()
            });
            response.on('end', () => {
                // Sometimes the 'error' event is not fired. Double check here.
                if (response.statusCode === 200) {
                    resolve(responseData);
                } else {
                    reject(new Error(responseData.trim()));
                }
            });
        }).on('error', e => {
            reject(e);
        });
    });
}

function fixRemoteUrl(remoteAddress: string, remotePort: number, target: any): any {
    if (target.webSocketDebuggerUrl) {
        const addressMatch = target.webSocketDebuggerUrl.match(/ws:\/\/([^/]+)\/?/);
        if (addressMatch) {
            const replaceAddress = `${remoteAddress}:${remotePort}`;
            target.webSocketDebuggerUrl = target.webSocketDebuggerUrl.replace(addressMatch[1], replaceAddress);
        }
    }
    return target;
}

class DevToolsPanel {
    public static currentPanel: DevToolsPanel | undefined;
    public static readonly viewType = 'devtools';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionPath: string; 
    private readonly _targetUrl: string;
    private _socket: WebSocket | null = null;
    private _isConnected: boolean = false;
    private _messages: any[] = [];
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionPath: string, targetUrl: string) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (DevToolsPanel.currentPanel) {
            DevToolsPanel.currentPanel._panel.reveal(column);
        } else {
            const panel = vscode.window.createWebviewPanel(DevToolsPanel.viewType, "DevTools", column || vscode.ViewColumn.One, {
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

        // Set the webview's initial html content 
        this.update();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Update the content based on view changes
        this._panel.onDidChangeViewState(e => {
            if (this._panel.visible) {
                this.update()
            }
        }, null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(message => {
            this._onMessageFromWebview(message);
        }, null, this._disposables);
    }

    private _onMessageFromWebview(message: any) {
        if (!this._socket) {
            this._connectToTarget();
        } else if (!this._isConnected) {
            this._messages.push(message);
        } else {
            this._socket.send(message);
        }
    }

    private _connectToTarget() {
        const url = this._targetUrl;
        this._socket = new WebSocket(url);
        this._socket.onerror = this._onError.bind(this);
        this._socket.onopen = this._onOpen.bind(this);
        this._socket.onmessage = this._onMessage.bind(this);
        this._socket.onclose = this._onClose.bind(this);
    }

    private _onError() {
    }

    private _onOpen() {
        this._isConnected = true;

        if (this._socket) {
            for (const message of this._messages) {
                this._socket.send(message);
            }
            this._messages = [];
        }
    }

    private _onMessage(message: any) {
        this._panel.webview.postMessage(message.data);
    }

    private _onClose() {
        this._isConnected = false;
    }
    

    public dispose() {
        DevToolsPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview() {
        const htmlPath = vscode.Uri.file(path.join(this._extensionPath, 'host', 'devtools.html'));
        const htmlUri = htmlPath.with({ scheme: 'vscode-resource' });

        const scriptPath = vscode.Uri.file(path.join(this._extensionPath, 'out', 'src', 'host', 'messaging.js'));
        const scriptUri = scriptPath.with({ scheme: 'vscode-resource' });

        return `
            <!doctype html>
            <html>
            <head>
                <meta http-equiv="content-type" content="text/html; charset=utf-8">
                <style>
                    html, body {
                        height: 99%;
                        width: 100%;
                        padding: 0;
                        margin: 0;
                    }
                </style>
                <script src="${scriptUri}"></script>
            </head>
            <iframe id="host" style="width: 100%; height: 100%" frameBorder="0" src="${htmlUri}"></iframe>
            </html>
            `;
    }
}