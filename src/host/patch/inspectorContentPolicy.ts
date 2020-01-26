export function applyContentSecurityPolicyPatch(content: string) {
    return content
        .replace(
            /script-src\s*'self'/g,
            `script-src vscode-resource: 'self'`)
        .replace(
            `<meta name="referrer" content="no-referrer">`,
            `<script src="../../host/host.bundle.js"></script>`,
        );
}
