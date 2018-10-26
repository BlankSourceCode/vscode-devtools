class ToolsHost {
    getPreferences(callback: (prefs: any) => void) {
        const prefs: any = {
            uiTheme: "\"dark\"",
            screencastEnabled: false
        };
        //for (const name in window.localStorage)
        //  prefs[name] = window.localStorage[name];
        callback(prefs);
    }
    
    setPreference(name: string, value: string) {
        //window.localStorage[name] = value;
    }
}

class ToolsWebSocket {
    constructor(url: string) {
      window.addEventListener('message', messageEvent => {
        (this as any).onmessage(messageEvent);
      });

      setTimeout(() => {
        (this as any).onopen();
      }, 0);
    }

    send(message: string) {
      window.parent.postMessage(message, "*");
    }
  }

const devToolsFrame = document.getElementById('devtools') as HTMLIFrameElement;
devToolsFrame.onload = () => {
    let dtWindow = devToolsFrame.contentWindow;

    (dtWindow as any).InspectorFrontendHost = new ToolsHost();
    (dtWindow as any).WebSocket = ToolsWebSocket;

    Object.defineProperty(dtWindow, 'localStorage', {
        get: function () { return null; },
        set: function () {}
    });
}
