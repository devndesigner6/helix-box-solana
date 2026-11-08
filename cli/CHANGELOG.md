# Changelog

## 0.2.0 - 2026-11-08

### Added
- Live model discovery, mandate, quote, purchase and result tools for Codex.
- A stdio MCP server for the same tools in Claude Code.
- Authenticated image/audio delivery into project-local artifact files.

### Changed
- Workspace access and installed coding agents no longer require a timed HelixBox access purchase.
- Optional model calls use phone-approved, bounded Solana USDC mandates on the existing backend.
- No wallet signing key is passed to the coding agent or written into its MCP configuration.

### Notes
- Mainnet batch settlement remains experimental. Actual device and wallet verification is required before relying on this beta.
- Existing agent-provider subscriptions and API charges are separate from model-tool purchases.
