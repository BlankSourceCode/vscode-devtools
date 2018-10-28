import * as http from 'http';
import * as https from 'https';
import * as url from 'url';

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