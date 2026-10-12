# Publish Noderyx Frames

This directory contains the standalone extension from noderyx-framework 0.8.0.
This is the canonical extension source in the framework repository.

## Package

From this directory, run `npx @vscode/vsce package --out ../../../dist/noderyx-language-support-0.2.0.vsix`.
Create the repository's `dist` directory first if it does not exist.
This is a maintainer step; users install through VS Code after publication.

## Publish using the browser

1. Sign in at https://marketplace.visualstudio.com/manage with the Microsoft
   account that owns the Noderyx publisher.
2. Create or select the publisher with the exact ID `noderyx`. The package's
   publisher field must match an ID you own. If this ID is unavailable, choose
   an owned ID and update package.json and workspace recommendations together.
3. Choose **New extension > Visual Studio Code** and upload the VSIX from `dist`.
   For an existing listing, use its update action instead and increase the
   package version before packaging.
4. Wait for Marketplace validation and verify the public listing at
   https://marketplace.visualstudio.com/items?itemName=noderyx.noderyx-language-support.
5. Verify installation in VS Code by searching for **Noderyx Frames** and
   clicking **Install**, then opening a `.noderframe` file.

Packaging alone does not publish the extension. Publisher account access is
required. Browser upload does not require sharing a publishing token.

Microsoft's guide: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
