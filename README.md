<div align="center">
  <a href="https://helixboxide.xyz/">
    <img src="landing/public/assets/images/helixbox-readme.png" alt="Helix Box" width="600">
  </a>
</div><br />
<p align="center"><strong>Build, run, and ship directly from your phone.</strong></p>
<p align="center">HelixBox brings your existing laptop development environment to mobile, including files, terminals, Git, processes, and AI coding agents.</p>

This repository contains the Solana migration of the existing HelixBox workspace. The IDE predates this migration; the new work here is native Solana wallet approval and x402 session billing.

<p align="center">
  <a href="https://helixboxide.xyz/"><b>Website</b></a>
  &nbsp;•&nbsp;
  <a href="#quick-start"><b>Quick Start</b></a>
  &nbsp;•&nbsp;
  <a href="#x402-agent-sessions"><b>x402 Sessions</b></a>
  &nbsp;•&nbsp;
  <a href="https://github.com/devndesigner6/helix-box-solana/releases"><b>Latest Release</b></a>
</p>
<p align="center">
  <a href="https://helixboxide.xyz/"><img src="https://img.shields.io/badge/Open_HelixBox-4F46E5?style=for-the-badge" alt="Open HelixBox"></a>
  &nbsp;•&nbsp;
  <a href="https://github.com/devndesigner6/helix-box-solana/releases"><img src="https://img.shields.io/badge/Download_Android-black?style=for-the-badge&logo=android" alt="Download Android release"></a>
  &nbsp;•&nbsp;
  <a href="https://github.com/devndesigner6/helix-box-solana/issues"><img src="https://img.shields.io/badge/Report_Bug-black?style=for-the-badge" alt="Report Bug"></a>
</p>

<p align="center">
  <img src="app/assets/images/onboarding/1/left.png" alt="HelixBox mobile terminal" width="180">
  &nbsp;&nbsp;
  <img src="app/assets/images/onboarding/1/middle.png" alt="HelixBox AI agent" width="180">
  &nbsp;&nbsp;
  <img src="app/assets/images/onboarding/1/right.png" alt="HelixBox mobile editor" width="180">
</p>

## Structure

| Directory | Description |
|-----------|-------------|
| `app/` | Expo/React Native mobile app |
| `cli/` | CLI tool (`helixbox-cli`) |
| `manager/` | Manager server |
| `proxy/` | Proxy server |
| `pty/` | Rust PTY binary uses wezterm internal libs for rendering |
| `landing/` | Current product website, built from Vite source |
| `docs/` | HelixBox handbook |

<br />

## Quick Start

1. Start HelixBox in your project directory:

```bash
npx helixbox-cli
```

2. Build this Solana version with the Expo command below, install the APK, then scan the pairing QR code. Published APKs will appear in [this repository's Releases](https://github.com/devndesigner6/helix-box-solana/releases); do not use the older payment version's APK for Solana testing.
3. Resume your workspace to access its files, terminal, Git state, processes, and available AI agents.

For an existing connection, resume from app launch or **Past Sessions**. A valid saved session returns to the same workspace; the laptop CLI must still be running and reachable. Use `npx helixbox-cli --new` when you intentionally want a fresh pairing QR code.

<br /> 

## App

Expo/React Native mobile app, currently distributed on Android. iOS and web are development targets, not published releases. The CLI performs workspace operations while the app provides a mobile control surface for the connected environment.

- File explorer and editor
- Git integration
- Terminal emulator
- Process management
- Running-app browser with DevTools
- Built-in API client for sending requests and inspecting responses
- Ports manager and live resource monitoring
- Text tools for encoding, decoding, formatting and hashing
- AI agent sessions with Codex, OpenCode, Claude Code, and Hermes, including voice input
- Optional Brainrot mode for switching to entertainment while an agent works

### Supported Languages (22)

`en`, `zh`, `ja`, `ko`, `es`, `pt`, `de`, `fr`, `vi`, `ru`, `id`, `pl`, `tr`, `it`, `nl`, `sv`, `uk`, `fi`, `zh-TW`, `tw`, `ms`, `es-MX`

<br />

## CLI

Node.js CLI that securely connects your local workspace to the app over WebSocket. Run it with `npx helixbox-cli`.

- Filesystem operations (read, write, grep, etc.)
- Git commands (status, commit, push, pull, etc.)
- Terminal spawning
- Process management
- Port scanning
- System monitoring (CPU, memory, disk, battery)

```bash
npx helixbox-cli
```

<br />

## x402 Agent Sessions

Workspace pairing, file inspection, logs, Git status, and basic controls remain free. Solana x402 payment integration is in development and has not yet been verified end to end.

| Access | Price | Includes |
|--------|-------|----------|
| Agent session | `$0.25 USDC` | One hour of agent access |
| Developer pass | `$2 USDC` | Seven days with fair-use limits |

**Network:** Solana Mainnet<br>
**Settlement asset:** USDC<br>
**Mainnet `payTo`:** `7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy`

The app requests a session from the manager, receives an HTTP 402 payment requirement, and opens MetaMask for approval. The wallet signs the Solana USDC transaction; the x402 facilitator verifies and settles it. Only a successful settlement receipt can activate access. There is no separate checkout website, and HelixBox never needs your recovery phrase or private key.

The client checks the network, USDC mint, recipient and amount before requesting a signature. The manager records settlement receipts in SQLite so a repeated receipt cannot extend access or activate a different pairing code. **This is a test-build migration, not a public payment launch:** automatic recovery after an interrupted settlement is not implemented yet, and physical-device wallet behavior still needs end-to-end verification. Keep public paid access disabled until those release checks are complete. These sessions do not yet let agents autonomously purchase external services.

These prices cover HelixBox agent access, not unlimited model tokens. Each coding agent uses the laptop's installed CLI and its own provider authentication, subscription or API billing. Provider charges are separate. The built-in API client is available; a separate `$0.10 USDC` paid API-testing flow is planned, not live.

<br />

## Manager and Proxy

Bun-based WebSocket service that connects the CLI and app using session codes. The public manager is deployed at [helixbox-manager.onrender.com](https://helixbox-manager.onrender.com).

This repository reuses the existing manager and proxy URLs. **The existing manager service must deploy the updated `manager/` code as well as the new environment values. Changing environment variables alone does not migrate the backend.** No separate backend deployment is required. The proxy can remain unchanged.

Use [manager/.env.example](manager/.env.example) for Solana network, native USDC, receiving address and facilitator settings. Keep `MANAGER_ADMIN_PASSWORD` secret and set `MANAGER_DB_PATH` to the existing durable disk location. Confirm the receiving wallet's USDC associated token account before testing settlement. No server-side wallet private key is required.

- Pairing codes with a seven-day lifetime, separate from paid agent-access expiry
- Dual-channel architecture (control + data)
- QR code pairing

<br />

## PTY

Rust binary for pseudo-terminal management, used by the CLI.

- Real PTY sessions via `wezterm` fork on github.com/sohzm/wezterm
- Screen buffer as cell grid (char + fg + bg per cell)
- 24fps render loop (only sends updates when content changes)
- JSON line protocol over stdin/stdout

<br />

## AI Agent Integration

HelixBox supports Codex, OpenCode, Claude Code, and Hermes when their CLIs are installed and authenticated in the paired laptop environment. Availability comes from the CLI's detected status, not a static list. Codex and GPT-5.6 also assisted with several parts of the implementation:
- **Rust PTY Delta Engine**: Codex co-authored the optimized incremental screen buffer diffing logic in the Rust PTY rendering loop, ensuring low-latency communication over standard output.
- **WebSocket Reconnection Logic**: GPT-5.6 helped design the network reconnection state machine in the Bun WebSocket proxy to maintain active connection states during mobile cellular handoffs.
- **Protocol Typings**: Codex generated TypeScript definitions for the control-plane RPC protocol to ensure type safety between the mobile app and the local CLI bridge.

<br />

## Handbook

Read the [HelixBox handbook](docs/HANDBOOK.md) for setup, workspace tools, agents, payments, development, Android builds and troubleshooting.

To build the Android test APK in Expo's cloud from Windows CMD:

```cmd
cd /d "C:\Users\hp\open ai hack\helixbox-solana\app"
npm ci --legacy-peer-deps
npx eas-cli build --platform android --profile preview
```

The existing Expo project and signing setup are retained. Set the public manager and proxy URLs in EAS if they differ from [app/.env.example](app/.env.example). OTA updates are disabled unless a separate Solana-only update endpoint is explicitly configured. A successful JavaScript export is not proof of a successful native APK build or real wallet payment.

<br />

## 📄 License

MIT: See [LICENSE](LICENSE) for details.

<br />

## Star History

<a href="https://www.star-history.com/#devndesigner6/helix-box-solana&Timeline">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=devndesigner6/helix-box-solana&type=Timeline&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=devndesigner6/helix-box-solana&type=Timeline" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=devndesigner6/helix-box-solana&type=Timeline" />
 </picture>
</a>
