class ToolsHost {
    private _getStateCallback: (prefs: any) => void;

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
        this._getStateCallback(prefs);
    }
}

class ToolsWebSocket {
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

class ToolsResourceLoader {
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
            this._urlLoadResolvers.get(response.id)(response.content);
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

const devToolsFrame = document.getElementById('devtools') as HTMLIFrameElement;
devToolsFrame.onload = () => {
    const dtWindow = devToolsFrame.contentWindow;

    // Override the apis and websocket so that we can control them
    (dtWindow as any).InspectorFrontendHost = new ToolsHost();
    (dtWindow as any).WebSocket = ToolsWebSocket;
    (dtWindow as any).ResourceLoaderOverride = new ToolsResourceLoader(dtWindow);

    // Prevent the devtools from using localStorage since it doesn't exist in data uris
    Object.defineProperty(dtWindow, 'localStorage', {
        get: function () { return undefined; },
        set: function () { }
    });

    // Add unhandled exception listeners for telemetry
    const reportError = function (name: string, stack: string) {
        const telemetry = {
            name: `devtools/${name}`,
            properties: { stack: stack.substr(0, 30) },
            metrics: {}
        };
        dtWindow.parent.postMessage(`telemetry:${JSON.stringify(telemetry)}`, '*');
    };
    (dtWindow as any).addEventListener('error', (event: ErrorEvent) => {
        const stack = (event && event.error && event.error.stack ? event.error.stack : event.message);
        reportError('error', stack);
    });
    (dtWindow as any).addEventListener('unhandledrejection', (reject: PromiseRejectionEvent) => {
        const stack = (reject && reject.reason && reject.reason.stack ? reject.reason.stack : reject.type);
        reportError('unhandledrejection', stack);
    });
};

// Listen for preferences from the extension
window.addEventListener('message', (e) => {
    if (e.data.substr(0, 12) === 'preferences:') {
        (devToolsFrame.contentWindow as any).InspectorFrontendHost.fireGetStateCallback(e.data.substr(12));
    } else if (e.data.substr(0, 7) === 'setUrl:') {
        (devToolsFrame.contentWindow as any).ResourceLoaderOverride.resolveUrlRequest(e.data.substr(7));
    }
});
