import * as cp from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as url from 'url';
import * as vscode from 'vscode';

export function getURL(aUrl: string, options: https.RequestOptions = {}): Promise<string> {
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
                responseData += chunk.toString();
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

export function fixRemoteUrl(remoteAddress: string, remotePort: number, target: any): any {
    if (target.webSocketDebuggerUrl) {
        const addressMatch = target.webSocketDebuggerUrl.match(/ws:\/\/([^/]+)\/?/);
        if (addressMatch) {
            const replaceAddress = `${remoteAddress}:${remotePort}`;
            target.webSocketDebuggerUrl = target.webSocketDebuggerUrl.replace(addressMatch[1], replaceAddress);
        }
    }
    return target;
}


export const enum Platform {
    Windows, OSX, Linux
}

export function getPlatform(): Platform {
    const platform = os.platform();
    return platform === 'darwin' ? Platform.OSX :
        platform === 'win32' ? Platform.Windows :
            Platform.Linux;
}

export function existsSync(path: string): boolean {
    try {
        fs.statSync(path);
        return true;
    } catch (e) {
        return false;
    }
}

export function launchLocalChrome(chromePath: string, chromePort: number, targetUrl: string) {
    const chromeArgs = [
        '--disable-extensions',
        `--remote-debugging-port=${chromePort}`
    ];

    const chromeProc = cp.spawn(chromePath, chromeArgs, {
        stdio: 'ignore',
        detached: true
    });

    chromeProc.unref();
}

export async function isPortFree(host: string, port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const server = net.createServer();

        server.on('error', () => resolve(false));
        server.listen(port, host);

        server.on('listening', () => {
            server.close();
            server.unref();
        });

        server.on('close', () => resolve(true));
    });
}

const WIN_APPDATA = process.env.LOCALAPPDATA || '/';
const DEFAULT_CHROME_PATH = {
    LINUX: '/usr/bin/google-chrome',
    OSX: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    WIN: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    WIN_LOCALAPPDATA: path.join(WIN_APPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    WINx86: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
};

export function getPathToChrome(): string {
    const platform = getPlatform();
    if (platform === Platform.OSX) {
        return existsSync(DEFAULT_CHROME_PATH.OSX) ? DEFAULT_CHROME_PATH.OSX : '';
    } else if (platform === Platform.Windows) {
        if (existsSync(DEFAULT_CHROME_PATH.WINx86)) {
            return DEFAULT_CHROME_PATH.WINx86;
        } else if (existsSync(DEFAULT_CHROME_PATH.WIN)) {
            return DEFAULT_CHROME_PATH.WIN;
        } else if (existsSync(DEFAULT_CHROME_PATH.WIN_LOCALAPPDATA)) {
            return DEFAULT_CHROME_PATH.WIN_LOCALAPPDATA;
        } else {
            return '';
        }
    } else {
        return existsSync(DEFAULT_CHROME_PATH.LINUX) ? DEFAULT_CHROME_PATH.LINUX : '';
    }
}

export function pathToFileURL(absPath: string, normalize?: boolean): string {
    if (normalize) {
        absPath = path.normalize(absPath);
        absPath = forceForwardSlashes(absPath);
    }

    absPath = (absPath.startsWith('/') ? 'file://' : 'file:///') +  absPath;
    return encodeURI(absPath);
}

export function forceForwardSlashes(aUrl: string): string {
    return aUrl
        .replace(/\\\//g, '/') // Replace \/ (unnecessarily escaped forward slash)
        .replace(/\\/g, '/');
}

export function getUrlFromConfig(folder: vscode.WorkspaceFolder, config: vscode.DebugConfiguration): string {
    let outUrlString = '';

    if (config.file) {
        outUrlString = config.file;
        outUrlString = outUrlString.replace('${workspaceFolder}', folder.uri.path);
        outUrlString = pathToFileURL(outUrlString);
    } else if (config.url ) {
        outUrlString = config.url;
    }

    return outUrlString;
}