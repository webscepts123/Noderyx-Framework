# Publish Noderyx Frames

This directory contains the standalone extension from noderyx-framework 0.8.0.
This is the canonical extension source in the framework repository.

## Package

From this directory, run `npx @vscode/vsce package --no-dependencies --out ../../../dist/noderyx-language-support-0.2.1.vsix`.
Create the repository's `dist` directory first if it does not exist.
This is a maintainer step; users install through VS Code after publication.

## Publish using the browser

1. Sign in at https://marketplace.visualstudio.com/manage with the Microsoft
   account that owns the Noderyx publisher.
2. Create or select the publisher with the exact ID `Noderyxframework`. The package's
   publisher field must match an ID you own. If this ID is unavailable, choose
   an owned ID and update package.json and workspace recommendations together.
3. Choose **New extension > Visual Studio Code** and upload the VSIX from `dist`.
   For an existing listing, use its update action instead and increase the
   package version before packaging.
4. Wait for Marketplace validation and verify the public listing at
   https://marketplace.visualstudio.com/items?itemName=Noderyxframework.noderyx-language-support.
5. Verify installation in VS Code by searching for **Noderyx Frames** and
   clicking **Install**, then opening a `.noderframe` file.

Packaging alone does not publish the extension. Publisher account access is
required. Browser upload does not require sharing a publishing token.

Microsoft's guide: https://code.visualstudio.com/api/working-with-extensions/publishing-extension

## Suspicious-content rejection

The generic upload error does not identify the flagged content. A successful
local package check does not guarantee Marketplace approval. This extension is
declarative: it has no executable entry point or runtime dependencies.

Upload the new `0.2.1` package from `dist`, with publisher ID
`Noderyxframework`. If Microsoft rejects it again, request a review at
`vsmarketplace@microsoft.com`. Include the publisher ID, extension ID, package
version, upload time, exact error, and the VSIX for inspection. Microsoft must
resolve a server-side false positive or publisher restriction.

Microsoft support guidance:
https://learn.microsoft.com/en-us/answers/questions/5663734/vs-code-extension-blocked-by-suspicious-content-fi
