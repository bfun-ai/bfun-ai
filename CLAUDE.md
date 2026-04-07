# bfun-ai – Agent Guidelines (Claude / Claude Code)

## Overview

This repo provides the **bfun-ai** skill for AI agents: create and trade meme tokens on **B.Fun (BSC only)** using the B.Fun API and on-chain contracts (BFunFactory, BondingCurve, TradeHelper).

The authoritative specification for this skill is `skills/bfun-integration/SKILL.md`. Claude/Claude Code should treat that file as the main contract for behavior, safety, and command usage.

## Release Mapping

This repository keeps the canonical production package identity in source: `@b-fun/bfun-ai`.

- `main` export channel: `@b-fun/bfun-ai`
- `dev` export channel: `bfun-agent-dev`

Use `npm run export:main` or `npm run export:dev` to prepare release artifacts in `dist/release/<channel>/`. The export step may rewrite package/install metadata in the copied artifact, but the source branch contents must remain production-clean.

## When to Use This Skill

Use this repo when the user explicitly or implicitly asks to:

- **Create** a meme token on B.Fun on BSC (standard or advanced with vesting, tax, vault).
- **Buy** or **sell** a B.Fun token on BSC (quote first, then execute).
- **Query token info** (on-chain state, phase, bonding curve progress).
- **Query lists / rankings** of B.Fun tokens (REST list, detail, trending, market cap).
- **Query tax info** for a token's vault and fee configuration.
- **Send BNB / ERC20** from the trading wallet to another address on BSC.
- **Register / query** an ERC-8004 Identity NFT (on-chain agent identity).

If the user's request does not involve B.Fun, BSC, or these flows, you should not use this skill.

## Repo Layout

```
bfun-ai/
├── skills/
│   └── bfun-integration/
│       ├── SKILL.md        # Main skill instructions
│       └── references/     # Create flow, trade flow, phases, errors, addresses
├── src/
│   ├── commands/           # CLI command implementations
│   ├── lib/                # Shared libraries (chain, contracts, quote, etc.)
│   └── index.js            # Commander entry point
├── bin/
│   └── bfun.js             # CLI entry (ESM)
├── package.json
├── README.md
└── CLAUDE.md               # This file (Claude-facing guidelines)
```

## Safety and Private Key Handling

The SKILL defines a **User Agreement & Security Notice**. Claude MUST:

1. On first use of this skill in a conversation, present the User Agreement and Security Notice.
2. Make clear that continuing to use this skill implies acceptance of the User Agreement.
3. **MUST NOT** run any write operation (`create`, `buy`, `sell`, `send`, `8004-register`) until the user has explicitly agreed or confirmed to continue.
4. May run read-only commands (`config`, `verify`, `token-info`, `quote-buy`, `8004-balance`, etc.) before confirmation.

Never ask the user to paste a private key into chat. All private keys must come from environment / config (e.g. `PRIVATE_KEY`) as described in `SKILL.md`.

## Installation

**Global install:**

```bash
npm install -g @b-fun/bfun-ai@latest
bfun <command> [args]
```

**Local install (no global):**

```bash
git clone https://github.com/bfun-ai/bfun-ai.git
cd bfun-ai
npm install
npx bfun <command> [args]
```

## Environment

Set **PRIVATE_KEY** and optionally **BSC_RPC_URL** via `.env` file in the working directory or shell export. The CLI loads `.env` from `process.cwd()` automatically.

- **PRIVATE_KEY** — required for write operations.
- **BSC_RPC_URL** — optional, uses default public RPC if not set.

## CLI Usage

```bash
bfun <command> [args...]
npx bfun <command> [args...]
```

Always prefer these CLI commands rather than calling `src/` files directly. The CLI entry (`bin/bfun.js`) dispatches to the correct command.

Key commands (full list in `SKILL.md`):

- `bfun config` / `bfun verify` — Environment and connectivity check.
- `bfun token-info` / `token-get` / `token-list` / `rankings` — Token queries.
- `bfun quote-buy` / `quote-sell` — Estimate trades without sending tx.
- `bfun buy` / `sell` — Execute trades via BondingCurve or DEX helper.
- `bfun create` — Create a token with optional vesting, tax, vault.
- `bfun send` — Send BNB or ERC20 from the trading wallet.
- `bfun 8004-register` / `8004-balance` — ERC-8004 Identity NFT.
- `bfun events` — Factory event inspection.
- `bfun tax-info` — Tax and vault configuration.

## External Docs

For deeper details, see:

- In-repo: `skills/bfun-integration/references/` (create-flow, trade-flow, token-phases, errors, contract-addresses)
- B.Fun website: [https://b.fun](https://b.fun)
