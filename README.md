# @b-fun/bfun-ai

> **⚠️ This tool operates on BSC mainnet with real funds.** Never share your private key or seed phrase. Use a dedicated low-balance wallet for trading. Always verify token addresses, amounts, and chain before executing write commands.

`@b-fun/bfun-ai` provides B.Fun automation in a single npm package with three layers:

- `bfun` CLI for direct terminal use
- OpenClaw plugin for installing the bundled skill
- `skills/bfun-integration` for agent-guided create, quote, and trade workflows

The CLI delegates to the existing Commander program in `src/index.js` and always loads `.env` from the current working directory before execution.

**Requirements:** Node.js 18+ and npm 9+.

## Install

### Option 1: Global CLI

```bash
npm install -g @b-fun/bfun-ai@latest
bfun --help
```

### Option 2: Clone and run locally

```bash
git clone https://github.com/bfun-ai/bfun-ai.git
cd bfun-ai
npm install
npx bfun --help
```

### Option 3: OpenClaw plugin + skill

See [Install as OpenClaw Plugin](#install-as-openclaw-plugin) below.

## Release Mapping

The source tree stays canonical and production-clean:

- `main` exports `@b-fun/bfun-ai`
- `dev` exports `bfun-agent-dev`

The source manifests and docs always keep the production identity. The dev/test package identity is introduced only when generating export artifacts with `npm run export:main` or `npm run export:dev`, which write to `dist/release/<channel>/` without mutating the source tree.

## Environment Variables (without OpenClaw)

When you **do not** use OpenClaw, the CLI reads `PRIVATE_KEY` and `BSC_RPC_URL` from the process environment. Set them in one of these ways:

### Option 1: `.env` file in the working directory

Create a file named `.env` in the directory where you run `bfun` commands:

```bash
# .env (do not commit this file)
PRIVATE_KEY=your_hex_private_key_with_or_without_0x_prefix
BSC_RPC_URL=https://bsc-dataseed.binance.org
```

The CLI automatically loads `.env` from the current working directory via dotenv.

### Option 2: export in the shell

```bash
export PRIVATE_KEY=your_hex_private_key
export BSC_RPC_URL=https://bsc-dataseed.binance.org
bfun create --name "My Token" --symbol "MTK" --image ./logo.png --description "Example" --pair ETH
```

- **PRIVATE_KEY**: Required for any command that signs or sends a transaction (`create`, `buy`, `sell`, `send`, `8004-register`). Hex string; `0x` prefix optional.
- **BSC_RPC_URL**: Optional. BSC RPC endpoint; if unset, the CLI uses a default public BSC RPC.
- **Security**: Do not commit `.env` or share your private key. Add `.env` to `.gitignore` if you use a `.env` file.

## Install as OpenClaw Plugin

This repo is an OpenClaw-compatible plugin. Install so the skill is loaded and `PRIVATE_KEY` / `BSC_RPC_URL` are only injected for this skill (via `skills.entries`):

```bash
openclaw plugins install @b-fun/bfun-ai
```

Then in `~/.openclaw/openclaw.json` set:

```json
{
  "skills": {
    "entries": {
      "bfun-ai": {
        "enabled": true,
        "env": {
          "PRIVATE_KEY": "0x...",
          "BSC_RPC_URL": "https://bsc-dataseed.binance.org"
        }
      }
    }
  }
}
```

After modifying `~/.openclaw/openclaw.json`, restart OpenClaw for changes to take effect.

See [skills/bfun-integration/SKILL.md](skills/bfun-integration/SKILL.md) for the full OpenClaw config section and environment variable details.

## Quick Start

### Read-only commands

```bash
bfun config
bfun verify
bfun token-list --limit 5
bfun rankings now_trending --limit 10
bfun token-info 0xTokenAddress
bfun token-get 0xTokenAddress
bfun quote-buy 0xTokenAddress 0.01
bfun quote-sell 0xTokenAddress 1000
bfun tax-info 0xTokenAddress
```

### Write commands

```bash
bfun buy 0xTokenAddress 0.01 --slippage 500
bfun sell 0xTokenAddress 1000 --slippage 500
bfun send 0xRecipient 0.01
bfun send 0xRecipient 100 --token 0xTokenAddress
```

### ERC-8004 Identity NFT

```bash
# Query balance (read-only, no PRIVATE_KEY needed if address provided)
bfun 8004-balance 0xWalletAddress

# Register (mint) an identity NFT (requires PRIVATE_KEY)
bfun 8004-register "MyAgent" --image "https://example.com/logo.png" --description "My trading agent"
```

Tokens created by wallets holding an ERC-8004 Identity NFT are marked as **Agent Created** on-chain. Default contract: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (BSC mainnet).

### Create a token

```bash
bfun create \
  --name "My Token" \
  --symbol "MTK" \
  --image ./logo.png \
  --description "Example token" \
  --pair ETH
```

The `create` command also supports advanced vesting, tax, vault, collateral-pair, and optional first-buy parameters. See [skills/bfun-integration/references/create-flow.md](skills/bfun-integration/references/create-flow.md) for the full parameter model.

## Agent Usage

When installed as an OpenClaw plugin, the bundled skill guides the agent to:

1. Inspect market state with `token-list`, `rankings`, `token-info`, and `token-get`
2. Quote trades before execution with `quote-buy` or `quote-sell`
3. Confirm risk acceptance before any write operation
4. Execute `buy`, `sell`, `send`, or `create` only through the CLI

Primary skill file:

- [skills/bfun-integration/SKILL.md](skills/bfun-integration/SKILL.md)

Reference material:

- [skills/bfun-integration/references/create-flow.md](skills/bfun-integration/references/create-flow.md)
- [skills/bfun-integration/references/trade-flow.md](skills/bfun-integration/references/trade-flow.md)
- [skills/bfun-integration/references/token-phases.md](skills/bfun-integration/references/token-phases.md)
- [skills/bfun-integration/references/contract-addresses.md](skills/bfun-integration/references/contract-addresses.md)
- [skills/bfun-integration/references/errors.md](skills/bfun-integration/references/errors.md)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `PRIVATE_KEY is not set` | Set `PRIVATE_KEY` in `.env` or export it in the shell |
| RPC connection timeout | Set `BSC_RPC_URL` to a different BSC RPC endpoint |
| `TransfersRestricted` on `send` | Token is still in bonding curve phase; use `sell` instead |
| `InsufficientFirstBuyFee` on `create` | First buy amount is below the minimum; check the error message for the required amount |
| `graduated` phase — cannot trade | Token is migrating to DEX; wait and re-check with `bfun token-info` |
| Slippage exceeded | Increase `--slippage` (in basis points, e.g. `500` = 5%) |

For a full list of error codes and solutions, see [skills/bfun-integration/references/errors.md](skills/bfun-integration/references/errors.md).

## Command Summary

Read-only:

- `bfun config`
- `bfun verify`
- `bfun token-info <tokenAddress>`
- `bfun token-get <tokenAddress>`
- `bfun token-list [--sort <value>] [--kw <keyword>] [--offset <n>] [--limit <n>]`
- `bfun rankings <orderBy> [--limit <n>]`
- `bfun quote-buy <tokenAddress> <bnbAmount> [--slippage <bps>]`
- `bfun quote-sell <tokenAddress> <tokenAmount> [--slippage <bps>]`
- `bfun tax-info <tokenAddress> [--user <address>]`
- `bfun events [fromBlock] [--toBlock <block>] [--chunk <n>]`

Write:

- `bfun buy <tokenAddress> <bnbAmount> [--slippage <bps>]`
- `bfun sell <tokenAddress> <tokenAmount> [--slippage <bps>]`
- `bfun send <toAddress> <amount> [--token <tokenAddress>]`
- `bfun create ...`
- `bfun 8004-register <name> [--image <url>] [--description <text>]`

ERC-8004 (read-only):

- `bfun 8004-balance [address]`

All commands return JSON for agent-friendly parsing. Success responses use `{ "success": true, "data": ... }`. Failures return `{ "success": false, "error": ... }` or, for `create` validation failures, `{ "success": false, "errors": [...] }`.
