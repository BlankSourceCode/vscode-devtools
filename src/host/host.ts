import { ToolsHost, ToolsResourceLoader, ToolsWebSocket, IRuntimeResourceLoader } from "./toolsHost";

export interface IDevToolsWindow extends Window {
    InspectorFrontendHost: ToolsHost;
    WebSocket: typeof ToolsWebSocket;
    ResourceLoaderOverride: ToolsResourceLoader;
    Root: IRoot;
    _importScriptPathPrefix: string;
}

export interface IRoot {
    Runtime: IRuntimeResourceLoader;
}

export function initialize(dtWindow: IDevToolsWindow) {
    if (!dtWindow) {
        return;
    }

    // Create a mock sessionStorage since it doesn't exist in data url but the devtools use it
    const sessionStorage = {};
    Object.defineProperty(dtWindow, "sessionStorage", {
        get() { return sessionStorage; },
        set() { /* NO-OP */ },
    });

    // Prevent the devtools from using localStorage since it doesn't exist in data uris
    Object.defineProperty(dtWindow, "localStorage", {
        get() { return undefined; },
        set() { /* NO-OP */ },
    });

    // Setup the global objects that must exist at load time
    dtWindow.InspectorFrontendHost = new ToolsHost();
    dtWindow.WebSocket = ToolsWebSocket;

    // Listen for messages from the extension and forward to the tools
    dtWindow.addEventListener("message", (e) => {
        if (e.data.substr(0, 12) === 'preferences:') {
            dtWindow.InspectorFrontendHost.fireGetStateCallback(e.data.substr(12));
        } else if (e.data.substr(0, 7) === 'setUrl:') {
            dtWindow.ResourceLoaderOverride.resolveUrlRequest(e.data.substr(7));
        }
    }, true);

    dtWindow.addEventListener("DOMContentLoaded", () => {
        dtWindow.ResourceLoaderOverride = new ToolsResourceLoader(dtWindow);
        dtWindow._importScriptPathPrefix = dtWindow._importScriptPathPrefix.replace("null", "vscode-resource:");
    });
}
