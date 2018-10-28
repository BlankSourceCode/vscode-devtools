class ToolsHost {
    getPreferences(callback: (prefs: any) => void) {
        // Set some default preferences
        const prefs: any = {
            uiTheme: '"dark"',
            screencastEnabled: false
        };

        // TODO: load the preference via the extension and global/workspaceState
        callback(prefs);
    }

    setPreference(name: string, value: string) {
        // TODO: save the preference via the extension and global/workspaceState
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

    send(message: string) {
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
};
