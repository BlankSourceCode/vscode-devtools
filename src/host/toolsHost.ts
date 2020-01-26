export interface IRuntimeResourceLoader {
    loadResourcePromise: (url: string) => Promise<string>;
}

export class ToolsHost {
    private _getStateCallback: ((prefs: any) => void) | undefined = undefined;

    public getPreferences(callback: (prefs: any) => void) {
        // Load the preference via the extension workspaceState
        this._getStateCallback = callback;
        window.parent.postMessage('getState:', '*');
    }

    public setPreference(name: string, value: string) {
        // Save the preference via the extension workspaceState
        window.parent.postMessage(`setState:${JSON.stringify({ name, value })}`, '*');
    }

    public recordEnumeratedHistogram(actionName: string, actionCode: number, bucketSize: number) {
        // Inform the extension of the chrome telemetry event
        const telemetry = {
            name: `devtools/${actionName}`,
            properties: {},
            metrics: {}
        };
        if (actionName === 'DevTools.InspectElement') {
            (telemetry.metrics as any)[`${actionName}.duration`] = actionCode;
        } else {
            (telemetry.properties as any)[`${actionName}.actionCode`] = actionCode;
        }
        window.parent.postMessage(`telemetry:${JSON.stringify(telemetry)}`, '*');
    }

    public fireGetStateCallback(state: string) {
        const prefs = JSON.parse(state);
        if (this._getStateCallback) {
            this._getStateCallback(prefs);
        }
    }
}

export class ToolsWebSocket {
    constructor(url: string) {
        window.addEventListener('message', messageEvent => {
            if (messageEvent.data && messageEvent.data[0] !== '{') {
                // Extension websocket control messages
                switch (messageEvent.data) {
                    case 'error':
                        (this as any).onerror();
                        break;

                    case 'close':
                        (this as any).onclose();
                        break;

                    case 'open':
                        (this as any).onopen();
                        break;
                }
            } else {
                // Messages from the websocket
                (this as any).onmessage(messageEvent);
            }
        });

        // Inform the extension that we are ready to recieve messages
        window.parent.postMessage('ready', '*');
    }

    public send(message: string) {
        // Forward the message to the extension
        window.parent.postMessage(message, '*');
    }
}

export class ToolsResourceLoader {
    private _window: Window;
    private _realLoadResource: (url: string) => Promise<string>;
    private _urlLoadNextId: number;
    private _urlLoadResolvers: Map<number, (url: string) => void>;

    constructor(dtWindow: Window) {
        this._window = dtWindow;
        this._realLoadResource = (this._window as any).Runtime.loadResourcePromise;
        this._urlLoadNextId = 0;
        this._urlLoadResolvers = new Map();
        (this._window as any).Runtime.loadResourcePromise = this.loadResource.bind(this);
    }

    public resolveUrlRequest(message: string) {
        // Parse the request from the message and store it
        const response = JSON.parse(message) as { id: number, content: string };

        if (this._urlLoadResolvers.has(response.id)) {
            const callback = this._urlLoadResolvers.get(response.id);
            if (callback) {
                callback(response.content);
            }
            this._urlLoadResolvers.delete(response.id);
        }
    }

    private async loadResource(url: string): Promise<string> {
        if (url === 'sources/module.json') {
            // Override the paused event revealer so that hitting a bp will not switch to the sources tab
            const content = await this._realLoadResource(url);
            return content.replace(/{[^}]+DebuggerPausedDetailsRevealer[^}]+},/gm, '');
        } if (url.substr(0, 7) === 'http://' || url.substr(0, 8) === 'https://') {
            // Forward the cross domain request over to the extension
            return new Promise((resolve: (url: string) => void, reject) => {
                const id = this._urlLoadNextId++;
                this._urlLoadResolvers.set(id, resolve);
                window.parent.postMessage(`getUrl:${JSON.stringify({ id, url })}`, '*');
            });
        } else {
            return this._realLoadResource(url);
        }
    }
}
