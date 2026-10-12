# Noderyx Frames for VS Code

Official editor support for the **Noderyx Framework**—a Node.js framework for
building fast web, packaged mobile, and native applications from one focused
project structure.

## Noderyx file formats

| Extension | Noderyx role |
| --- | --- |
| `.noderframe` | Human-readable Noderyx web view source |
| `.mnoderframe` | Compiled Noderyx mobile frame (`MNF1`) |

Both extensions belong to the Noderyx Framework and share the Noderyx document
icon, making them immediately recognizable in the file explorer. The extension
artwork uses Noderyx's purple-to-cyan `N` identity.

## Features

- Detects `.noderframe` and `.mnoderframe` automatically.
- Shows the shared Noderyx file icon in compatible icon themes.
- Highlights elements, attributes, strings, comments, control flow, and
  `{{data}}` expressions.
- Supports indentation-based folding.
- Adds comment, quote, bracket, and expression-pair editing behavior.
- Works with VS Code, Cursor, and VSCodium.

## About Noderyx

Noderyx uses indentation-based `.noderframe` views for the web and compiles
mobile routes into versioned `.mnoderframe` documents. Clean routes do not
include either extension. This package provides editor presentation and
language intelligence; the compiler and runtime are supplied by
`noderyx-framework`.

## Installation

Once published to the Visual Studio Marketplace:

1. Open **Extensions** in VS Code (Ctrl+Shift+X).
2. Search for **Noderyx Frames** by **noderyx**.
3. Click **Install**.

No terminal command or framework installation is required for syntax highlighting.
The extension identifier is `noderyx.noderyx-language-support`.

For an unpublished build, use **Extensions > ... > Install from VSIX...** and
select the packaged `.vsix` file, then reload if prompted.

New Noderyx projects recommend this extension through
`.vscode/extensions.json`. Marketplace installation becomes available only
after the publisher uploads and publishes the package.

## Identity

- Extension: **Noderyx Frames**
- Publisher: **noderyx**
- Identifier: `noderyx.noderyx-language-support`
- Framework package: `noderyx-framework`
- Supported formats: `.noderframe`, `.mnoderframe`
