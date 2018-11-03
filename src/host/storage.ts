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

const devToolsFrame = document.getElementById('devtools') as HTMLIFrameElement;
devToolsFrame.onload = () => {
    const dtWindow = devToolsFrame.contentWindow;

    // Override the apis and websocket so that we can control them
    (dtWindow as any).InspectorFrontendHost = new ToolsHost();
    (dtWindow as any).WebSocket = ToolsWebSocket;

    // Prevent the devtools from using localStorage since it doesn't exist in data uris
    Object.defineProperty(dtWindow, 'localStorage', {
        get: function () { return undefined; },
        set: function () { }
    });

    // Override the paused event revealer so that hitting a bp will not switch to the sources tab
    const realLoadResource = (dtWindow as any).Runtime.loadResourcePromise as (url: string) => Promise<string>;
    (dtWindow as any).Runtime.loadResourcePromise = async function (url: string): Promise<string> {
        if (url === 'sources/module.json') {
            const content = await realLoadResource(url);
            return content.replace(/{[^}]+DebuggerPausedDetailsRevealer[^}]+},/gm, '');
        } else {
            return realLoadResource(url);
        }
    };

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
    }
});
