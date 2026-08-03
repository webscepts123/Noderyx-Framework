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

After installing the Noderyx Framework, run:

```powershell
npx noderyx editor:install
```

Cursor and VSCodium are supported too:

```powershell
npx noderyx editor:install --editor=cursor
npx noderyx editor:install --editor=vscodium
```

For manual installation, copy this directory to:

```text
%USERPROFILE%\.vscode\extensions\noderyx.noderyx-language-support-0.2.0
```

Reload the editor window after installation. The SVG at
`icons/noderyx-file.svg` can also be reused by editors supporting custom file
icon associations.

New Noderyx projects include `.vscode/extensions.json`, allowing VS Code to
recognize the workspace and recommend this package after it is published.

## Identity

- Extension: **Noderyx Frames**
- Publisher: **noderyx**
- Identifier: `noderyx.noderyx-language-support`
- Framework package: `noderyx-framework`
- Supported formats: `.noderframe`, `.mnoderframe`
