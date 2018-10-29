# VSCode DevTools for Chrome

A VSCode extension to host the chrome devtools inside of a webview.

![Demo](demo.gif)

# Using the extension
- Start chrome with remote-debugging enabled on port 9222
    - `chrome.exe --remote-debugging-port=9222`
- Open the devtools inside VS Code 
    - Either
      - Run the `DevTools for Chrome: Attach to a target` command to attch to an instance of Chrome that's running
      - Run the `DevTools for Chrome: Launch` command to launch Chrome and attach to it (you can navigate to whatever page you want)
    - Select a target from the drop down


# Known Issues
- Prototyping stage
- Settings are not persisted

# Developing the extension itself

- Start chrome with remote-debugging enabled on port 9222
    - `chrome.exe --remote-debugging-port=9222`
- Run the extension 
    - `npm install`
    - `npm run watch` or `npm run build`
    - Open the folder in VSCode
    - `F5` to start debugging
- Open the devtools 
    - Run the `DevTools: Attach to a target` command
    - Select a target from the drop down

