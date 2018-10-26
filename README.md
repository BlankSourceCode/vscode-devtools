# VSCode DevTools

A VSCode extension to host the chrome devtools inside of a webview.

![Demo](demo.gif)

## Running the extension

- Start chrome with remote-debugging enabled on port 9222
    - `chrome.exe --remote-debugging-port=9222`
- Run the extension 
    - `npm install`
    - `npm run watch` or `npm run compile`
    - Open the folder in VSCode
    - `F5` to start debugging
- Open the devtools 
    - Run the `DevTools: Attach to a target` command
    - Select a target from the drop down

