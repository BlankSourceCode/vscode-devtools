// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fse from "fs-extra";
import path from "path";
import { applyContentSecurityPolicyPatch } from "./src/host/patch/inspectorContentPolicy";

async function copyFile(srcDir: string, outDir: string, name: string) {
    await fse.copy(
        path.join(srcDir, name),
        path.join(outDir, name),
    );
}

async function copyStaticFiles() {
    // Copy the static css file to the out directory
    const commonSrcDir = "./src/common/";
    const commonOutDir = "./out/common/";
    await fse.ensureDir(commonOutDir);
    await copyFile(commonSrcDir, commonOutDir, "styles.css");

    const toolsSrcDir =
        `node_modules/chrome-devtools-frontend/front_end/`;
    if (!isDirectory(toolsSrcDir)) {
        throw new Error(`Could not find Chrome DevTools path at '${toolsSrcDir}'. ` +
            "Did you run npm install?");
    }

    // Copy the devtools to the out directory
    const toolsOutDir = "./out/tools/front_end/";
    await fse.ensureDir(toolsOutDir);
    await fse.copy(toolsSrcDir, toolsOutDir);

    // Patch older versions of the webview with our workarounds
    await patchFilesForWebView(toolsOutDir);
}

async function patchFilesForWebView(toolsOutDir: string) {
    // Release file versions
    await patchFileForWebView("inspector.html", toolsOutDir, true, [
        applyContentSecurityPolicyPatch,
    ]);

    // Debug file versions

}

async function patchFileForWebView(
    filename: string,
    dir: string,
    isRelease: boolean,
    patches: Array<(content: string, isRelease?: boolean) => string>) {
    const file = path.join(dir, filename);

    // Ignore missing files
    if (!await fse.pathExists(file)) {
        return;
    }

    // Read in the file
    let content = (await fse.readFile(file)).toString();

    // Apply each patch in order
    patches.forEach((patchFunction) => {
        content = patchFunction(content, isRelease);
    });

    // Write out the final content
    await fse.writeFile(file, content);
}

function isDirectory(fullPath: string) {
    try {
        return fse.statSync(fullPath).isDirectory();
    } catch {
        return false;
    }
}

copyStaticFiles();
