import * as vscode from 'vscode';
import * as utils from './utils';

export class ChromeDevToolsConfigurationProvider implements vscode.DebugConfigurationProvider {
    public TargetUri:string;

    public constructor() {
        
    }

    provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration[]> {
        return;
    }

    resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
        this.TargetUri = ''; 
        if(config && config.type == 'chrome'){
            if(folder.uri.scheme == 'file'){
                const baseUrl:string = (config.file)?  config.file: config.url;
                const replacedUri:string = baseUrl.replace('${workspaceFolder}', folder.uri.path);
                this.TargetUri = utils.pathToFileURL(replacedUri);
            } else {
                this.TargetUri = config.url;
            }
        }
        return;
    }
}