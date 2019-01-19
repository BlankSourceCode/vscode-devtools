import * as path from 'path';
import * as vscode from 'vscode';
import WebSocket from 'ws';
import TelemetryReporter from './telemetry';
import QuickPickItem = vscode.QuickPickItem;
import * as utils from './utils';

interface IPackageInfo {
    name: string;
    version: string;
    aiKey: string;
}

const debuggerType: string = 'devtools-for-chrome';
const defaultUrl: string = 'about:blank';
let telemetryReporter: TelemetryReporter;

export function activate(context: vscode.ExtensionContext) {

    const packageInfo = getPackageInfo(context);
    if (packageInfo && vscode.env.machineId !== 'someValue.machineId') {
        // Use the real telemetry reporter
        telemetryReporter = new TelemetryReporter(packageInfo.name, packageInfo.version, packageInfo.aiKey);
    } else {
        // Fallback to a fake telemetry reporter
        telemetryReporter = new DebugTelemetryReporter();
    }
    context.subscriptions.push(telemetryReporter);

    context.subscriptions.push(vscode.commands.registerCommand('devtools-for-chrome.launch', async () => {
        launch(context);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('devtools-for-chrome.attach', async () => {
        attach(context, /* viaConfig= */ false, defaultUrl);
    }));

    vscode.debug.registerDebugConfigurationProvider(debuggerType, {
        provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration[]> {
            return Promise.resolve([{
                type: debuggerType,
                name: 'Launch Chrome against localhost',
                request: 'launch',
                url: 'http://localhost:8080'
            }]);
        },

        resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
            if (config && config.type === debuggerType) {
                const targetUri: string = utils.getUrlFromConfig(folder, config);
                if (config.request && config.request.localeCompare('attach', 'en', { sensitivity: 'base' }) === 0) {
                    attach(context, /* viaConfig= */ true, targetUri);
                    telemetryReporter.sendTelemetryEvent('launch/command/attach');
                } else if (config.request && config.request.localeCompare('launch', 'en', { sensitivity: 'base' }) === 0) {
                    launch(context, targetUri, config.chromePath);
                    telemetryReporter.sendTelemetryEvent('launch/command/launch');
                }
            } else {
                vscode.window.showErrorMessage('No supported launch config was found.');
                telemetryReporter.sendTelemetryEvent('launch/error/config_not_found');
            }
            return;
        }
    });
}

async function launch(context: vscode.ExtensionContext, launchUrl?: string, chromePathFromLaunchConfig?: string) {
    const viaConfig = !!(launchUrl || chromePathFromLaunchConfig);
    const telemetryProps = { viaConfig: `${viaConfig}` };
    telemetryReporter.sendTelemetryEvent('launch', telemetryProps);

    const { hostname, port } = getSettings();
    const portFree = await utils.isPortFree(hostname, port);
    if (portFree) {
        const settings = vscode.workspace.getConfiguration('vscode-devtools-for-chrome');
        const pathToChrome = settings.get('chromePath') as string || chromePathFromLaunchConfig || utils.getPathToChrome();

        if (!pathToChrome || !utils.existsSync(pathToChrome)) {
            vscode.window.showErrorMessage('Chrome was not found. Chrome must be installed for this extension to function. If you have Chrome installed at a custom location you can specify it in the \'chromePath\' setting.');
            telemetryReporter.sendTelemetryEvent('launch/error/chrome_not_found', telemetryProps);
            return;
        }

        utils.launchLocalChrome(pathToChrome, port, defaultUrl);
    }

    const target = JSON.parse(await utils.getURL(`http://${hostname}:${port}/json/new?${launchUrl}`));

    if (!target || !target.webSocketDebuggerUrl || target.webSocketDebuggerUrl === '') {
        vscode.window.showErrorMessage(`Could not find the launched Chrome tab: (${launchUrl}).`);
        telemetryReporter.sendTelemetryEvent('launch/error/tab_not_found', telemetryProps);
        attach(context, viaConfig, defaultUrl);
    } else {
        DevToolsPanel.createOrShow(context, target.webSocketDebuggerUrl);
    }
}

async function attach(context: vscode.ExtensionContext, viaConfig: boolean, targetUrl: string) {
    const telemetryProps = { viaConfig: `${viaConfig}` };
    telemetryReporter.sendTelemetryEvent('attach', telemetryProps);

    const { hostname, port } = getSettings();
    const responseArray = await getListOfTargets(hostname, port);
    if (Array.isArray(responseArray)) {
        telemetryReporter.sendTelemetryEvent('attach/list', telemetryProps, { targetCount: responseArray.length });

        const items: QuickPickItem[] = [];

        responseArray.forEach(i => {
            i = utils.fixRemoteUrl(hostname, port, i);
            items.push({
                label: i.title,
                description: i.url,
                detail: i.webSocketDebuggerUrl
            });
        });

        let targetWebsocketUrl = '';
        if (typeof targetUrl === 'string' && targetUrl.length > 0 && targetUrl !== defaultUrl) {
            const matches = items.filter(i => targetUrl.localeCompare(i.description, 'en', { sensitivity: 'base' }) === 0);
            if (matches && matches.length > 0 ) {
                targetWebsocketUrl = matches[0].detail;
            } else {
                vscode.window.showErrorMessage(`Couldn't attach to ${targetUrl}.`);
            }
        }

        if (targetWebsocketUrl && targetWebsocketUrl.length > 0) {
            DevToolsPanel.createOrShow(context, targetWebsocketUrl as string);
        } else {
            vscode.window.showQuickPick(items).then((selection) => {
                if (selection) {
                    DevToolsPanel.createOrShow(context, selection.detail as string);
                }
            });
        }
    } else {
        telemetryReporter.sendTelemetryEvent('attach/error/no_json_array', telemetryProps);
    }
}

function getSettings(): { hostname: string, port: number } {
    const settings = vscode.workspace.getConfiguration('vscode-devtools-for-chrome');
    const hostname = settings.get('hostname') as string || 'localhost';
    const port = settings.get('port') as number || 9222;

    return { hostname, port };
}

function getPackageInfo(context: vscode.ExtensionContext): IPackageInfo {
    const extensionPackage = require(context.asAbsolutePath('./package.json'));
    if (extensionPackage) {
        return {
            name: extensionPackage.name,
            version: extensionPackage.version,
            aiKey: extensionPackage.aiKey
        };
    }
    return undefined;
}

async function getListOfTargets(hostname: string, port: number): Promise<Array<any>> {
    const checkDiscoveryEndpoint = (url: string) => {
        return utils.getURL(url, { headers: { Host: 'localhost' } });
    };

    const jsonResponse = await checkDiscoveryEndpoint(`http://${hostname}:${port}/json/list`)
        .catch(() => checkDiscoveryEndpoint(`http://${hostname}:${port}/json`));

    let result: Array<string>;
    try {
        result = JSON.parse(jsonResponse);
    } catch (ex) {
        result = undefined;
    }
    return result;
}

class DevToolsPanel {
    private static currentPanel: DevToolsPanel;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _context: vscode.ExtensionContext;
    private readonly _extensionPath: string;
    private readonly _targetUrl: string;
    private _socket: WebSocket = undefined;
    private _isConnected: boolean = false;
    private _messages: any[] = [];
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(context: vscode.ExtensionContext, targetUrl: string) {
        const column = vscode.ViewColumn.Beside;

        if (DevToolsPanel.currentPanel) {
            DevToolsPanel.currentPanel._panel.reveal(column);
        } else {
            const panel = vscode.window.createWebviewPanel('devtools-for-chrome', 'DevTools', column, {
                enableScripts: true,
                enableCommandUris: true,
                retainContextWhenHidden: true
            });

            DevToolsPanel.currentPanel = new DevToolsPanel(panel, context, targetUrl);
        }
    }

    public static revive(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, targetUrl: string) {
        DevToolsPanel.currentPanel = new DevToolsPanel(panel, context, targetUrl);
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, targetUrl: string) {
        this._panel = panel;
        this._context = context;
        this._extensionPath = context.extensionPath;
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
            telemetryReporter.sendTelemetryEvent('websocket/dispose');
            this._socket.onopen = undefined;
            this._socket.onmessage = undefined;
            this._socket.onerror = undefined;
            this._socket.onclose = undefined;
            this._socket.close();
            this._socket = undefined;
        }
    }

    private _onMessageFromWebview(message: string) {
        if (message === 'ready') {
            if (this._socket) {
                telemetryReporter.sendTelemetryEvent('websocket/reconnect');
            }
            this._disposeSocket();
        } else if (message.substr(0, 10) === 'telemetry:') {
            return this._sendTelemetryMessage(message.substr(10));
        } else if (message.substr(0, 9) === 'getState:') {
            return this._getDevtoolsState();
        } else if (message.substr(0, 9) === 'setState:') {
            return this._setDevtoolsState(message.substr(9));
        } else if (message.substr(0, 7) === 'getUrl:') {
            return this._getDevtoolsUrl(message.substr(7));
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
        this._socket.onopen = this._onOpen.bind(this);
        this._socket.onmessage = this._onMessage.bind(this);
        this._socket.onerror = this._onError.bind(this);
        this._socket.onclose = this._onClose.bind(this);
    }

    private _onOpen() {
        this._isConnected = true;
        // Tell the devtools that the real websocket was opened
        telemetryReporter.sendTelemetryEvent('websocket/open');
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

    private _onError() {
        if (this._isConnected) {
            // Tell the devtools that there was a connection error
            telemetryReporter.sendTelemetryEvent('websocket/error');
            this._panel.webview.postMessage('error');
        }
    }

    private _onClose() {
        if (this._isConnected) {
            // Tell the devtools that the real websocket was closed
            telemetryReporter.sendTelemetryEvent('websocket/close');
            this._panel.webview.postMessage('close');
        }
        this._isConnected = false;
    }

    private _sendTelemetryMessage(message: string) {
        const telemetry = JSON.parse(message);
        telemetryReporter.sendTelemetryEvent(telemetry.name, telemetry.properties, telemetry.metrics);
    }

    private _getDevtoolsState() {
        const allPrefsKey = 'devtools-preferences';
        const allPrefs: any = this._context.workspaceState.get(allPrefsKey) ||
            {
                uiTheme: '"dark"',
                screencastEnabled: false
            };
        this._panel.webview.postMessage(`preferences:${JSON.stringify(allPrefs)}`);
    }

    private _setDevtoolsState(message: string) {
        // Parse the preference from the message and store it
        const pref = JSON.parse(message) as { name: string, value: string };

        const allPrefsKey = 'devtools-preferences';
        const allPrefs: any = this._context.workspaceState.get(allPrefsKey) || {};
        allPrefs[pref.name] = pref.value;
        this._context.workspaceState.update(allPrefsKey, allPrefs);
    }

    private async _getDevtoolsUrl(message: string) {
        // Parse the request from the message and store it
        const request = JSON.parse(message) as { id: number, url: string };

        let content = '';
        try {
            content = await utils.getURL(request.url);
        } catch (ex) {
            content = '';
        }

        this._panel.webview.postMessage(`setUrl:${JSON.stringify({ id: request.id, content })}`);
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
                    html, body, iframe {
                        height: 100%;
                        width: 100%;
                        position: absolute;
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

class DebugTelemetryReporter extends TelemetryReporter {
    constructor() {
        super('extensionId', 'extensionVersion', 'key');
    }

    public sendTelemetryEvent(name: string, properties?: any, measurements?: any) {
        console.log(`${name}: ${JSON.stringify(properties)}, ${JSON.stringify(properties)}`);
    }

    public dispose(): Promise<any> {
        return Promise.resolve();
    }
}