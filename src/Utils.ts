import * as os from 'os';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as net from 'net';
import * as path from 'path';

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
        // doesn't exist
        return false;
    }
}

export function launchLocalChrome(targetUrl: string) {
    let chromePath = getPathToChrome();
    let chromeArgs = ['--remote-debugging-port=9222'];

    const chromeProc = cp.spawn(chromePath, chromeArgs, {
        stdio: 'ignore',
        detached: true
    });

    chromeProc.unref();
}

export async function isPortFree(host: string, port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        let server = net.createServer();

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
