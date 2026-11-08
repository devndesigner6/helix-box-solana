# Helix Box CLI

Node.js CLI that connects a local machine to the Helix Box mobile app through the Helix Box gateway. It runs from the project directory you want to expose and keeps filesystem, terminal, process, port, git, and AI actions scoped to that working tree.

## Requirements

- Node.js 18 or newer
- npm
- Helix Box mobile app for QR/session pairing

## Usage

Run the published package:

```bash
npx helixbox-cli@latest
```

The CLI prints a QR code and session details. Scan the QR code with the Helix Box app to connect to the current working directory.

## Model tools in 0.2.0

Pairing, workspace controls and access to your installed Codex/Claude Code are free. Their own provider subscriptions remain separate.

The CLI gives Codex and Claude Code five tools: live model discovery, approved mandates, bounded quotes, purchase requests and result retrieval. Choose allowed models and approve a USDC budget in the Android app first. Your foreground phone signs calls within those limits; the CLI and coding agent never receive a wallet signing key.

Optional chat, image and speech calls use real x402 payments on Solana Mainnet. A complete result is prepared before its charge settles and is released only after acknowledgement. Keep the original purchase ID if a response is interrupted; do not buy again to retrieve it. Completed image/audio files are saved in `.helixbox-model-results/` inside your project.

This is an experimental mainnet beta. Start with a small budget and verify pairing, model delivery and returning unused escrow on your phone. The phone must remain foregrounded to approve new calls. Older CLI versions do not expose these tools; restart the CLI and pair again after upgrading.

Common options:

```bash
npx helixbox-cli --help
npx helixbox-cli --new
npx helixbox-cli --debug
npx helixbox-cli --extra-ports 3000,8080
```

Options:

| Option | Description |
| --- | --- |
| `-h`, `--help` | Show CLI help |
| `-n`, `--new` | Create a fresh session code instead of reusing the saved one |
| `-d`, `--debug` | Enable verbose CLI and AI backend logs |
| `--extra-ports` | Comma-separated local ports to expose through Helix Box |

## Configuration

By default, the CLI uses the public Helix Box services:

- Gateway: `https://helixbox-proxy.onrender.com`
- Manager: `https://helixbox-manager.onrender.com`

Override them with environment variables when developing against local or custom infrastructure:

```bash
HELIXBOX_PROXY_URL=http://localhost:3001 \
HELIXBOX_MANAGER_URL=http://localhost:3002 \
npx helixbox-cli
```

Other useful environment variables:

| Variable | Description |
| --- | --- |
| `HELIXBOX_PROXY_URL` | Gateway/proxy URL |
| `HELIXBOX_MANAGER_URL` | Manager URL |
| `HELIXBOX_DEBUG` | Set to `1` for debug logging |
| `HELIXBOX_DEBUG_AI` | Set to `1` for AI backend debug logging |
| `NO_COLOR` | Disable colored terminal output |
| `FORCE_COLOR` | Force colored terminal output |

Session config is saved per project root in the OS-specific Helix Box config directory:

- macOS: `~/Library/Application Support/helixbox/config.json`
- Windows: `%APPDATA%\helixbox\config.json`
- Linux: `$XDG_CONFIG_HOME/helixbox/config.json` or `~/.config/helixbox/config.json`

## Development

Install dependencies:

```bash
npm install
```

Build the CLI:

```bash
npm run build
```

Run from source output:

```bash
npm run dev
```

The package entrypoint is `dist/index.js`, generated from `src/index.ts`. `npm run build` compiles TypeScript and marks the generated entrypoint executable.

## Project Layout

```text
src/
  index.ts              CLI entrypoint and local machine bridge
  ai/                   Codex, OpenCode, Claude Code and Hermes integration
  transport/            Session transport protocol
  libsodium-wrappers.d.ts
```

## Publishing

The package is published as `helixbox-cli`. `prepublishOnly` runs the production build before publishing.

```bash
npm publish
```
