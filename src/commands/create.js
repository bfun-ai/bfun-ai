import { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parseUnits, decodeEventLog, isAddress } from 'viem';
import { getApiUrl, getChainId, getPublicClient } from '../lib/chain.js';
import { getAccount, getWalletClient } from '../lib/wallet.js';
import { getAddresses, bFunFactoryABI, bFunFactoryEvents, erc20ABI } from '../lib/contracts.js';
import { getCollateralTemplate, ZERO_ADDRESS } from '../lib/chain-configs.js';
import { buildCreateParams, md5Hex } from '../lib/create-helpers.js';
import axios from 'axios';

export const create = new Command('create')
  .description('Create a new token (standard or advanced)')
  // Required
  .requiredOption('-n, --name <name>', 'Token name (max 32 chars)')
  .requiredOption('-s, --symbol <symbol>', 'Token symbol (max 15 chars)')
  .requiredOption('-i, --image <path>', 'Path to token image')
  // Basic optional
  .option('-d, --description <text>', 'Token description')
  .option('-w, --website <url>', 'Website URL')
  .option('-t, --twitter <handle>', 'Twitter handle')
  .option('--telegram <handle>', 'Telegram handle')
  .option('--pair <type>', 'Payment token pair (ETH|CAKE|USDT|USD1|ASTER|U|USDC)', 'ETH')
  // Advanced
  .option('--target-raise <amount>', 'Target raise in collateral units (e.g. "12" for 12 BNB)')
  .option('--bonding-curve-pct <pct>', 'Bonding curve % (50-80)', '80')
  .option('--vesting-pct <pct>', 'Creator vesting % (0-30)', '0')
  .option('--vesting-duration <value>', 'Vesting period (e.g. "6m", "90d", "1y")')
  .option('--cliff-duration <value>', 'Cliff/lockup period (e.g. "3m", "30d")')
  .option('--vesting-recipient <address>', 'Vesting recipient address')
  // Tax
  .option('--tax-rate <pct>', 'Tax rate: 1, 2, 3, or 5 (percent)')
  .option('--funds-pct <pct>', 'Funds allocation % (0-100)')
  .option('--burn-pct <pct>', 'Burn allocation % (0-100)')
  .option('--dividend-pct <pct>', 'Dividend allocation % (0-100)')
  .option('--liquidity-pct <pct>', 'Liquidity allocation % (0-100)')
  .option('--dividend-min-balance <tokens>', 'Min tokens for dividend eligibility', '10000')
  .option('--funds-recipient <address>', 'Funds recipient wallet')
  // Vault
  .option('--vault-type <type>', 'Vault type: split|snowball|burn_dividend|gift')
  .option('--split-recipients <json>', 'Split vault recipients JSON: [{"address":"0x...","pct":50},...]')
  .option('--gift-x-handle <handle>', 'Gift vault X/Twitter handle (without @)')
  // First buy
  .option('--buy-amount <amount>', 'Optional first buy amount in collateral units')
  .action(async (options) => {
    try {
      // ── Validate inputs ──
      const errors = [];
      if (!options.name) errors.push('--name is required');
      if (options.name && options.name.length > 32) errors.push('--name max 32 chars');
      if (!options.symbol) errors.push('--symbol is required');
      if (options.symbol && options.symbol.length > 15) errors.push('--symbol max 15 chars');

      const imagePath = resolve(process.cwd(), options.image);
      if (!existsSync(imagePath)) errors.push(`Image not found: ${imagePath}`);

      const bondingPct = parseInt(options.bondingCurvePct, 10);
      const vestingPct = parseInt(options.vestingPct, 10);
      if (bondingPct < 50 || bondingPct > 80) errors.push('--bonding-curve-pct must be 50-80');
      if (vestingPct < 0 || vestingPct > 30) errors.push('--vesting-pct must be 0-30');
      if (bondingPct + vestingPct + 20 !== 100) {
        errors.push(`bonding(${bondingPct}) + vesting(${vestingPct}) + migration(20) must = 100`);
      }

      const taxRate = options.taxRate != null ? parseInt(options.taxRate, 10) : 0;
      if (options.taxRate != null && (isNaN(taxRate) || ![0, 1, 2, 3, 5].includes(taxRate))) {
        errors.push(`--tax-rate must be 0, 1, 2, 3, or 5, got: "${options.taxRate}"`);
      }
      if (taxRate > 0) {
        if (![1, 2, 3, 5].includes(taxRate)) errors.push('--tax-rate must be 1, 2, 3, or 5');
        const fPct = parseInt(options.fundsPct || '0', 10);
        const bPct = parseInt(options.burnPct || '0', 10);
        const dPct = parseInt(options.dividendPct || '0', 10);
        const lPct = parseInt(options.liquidityPct || '0', 10);
        if (fPct + bPct + dPct + lPct !== 100) {
          errors.push(`Tax allocations must sum to 100%, got ${fPct + bPct + dPct + lPct}%`);
        }
        if (fPct > 0 && !options.fundsRecipient && !options.vaultType) {
          errors.push('--funds-recipient or --vault-type required when --funds-pct > 0');
        }
      }

      // Parse split recipients
      let splitRecipients = null;
      if (options.splitRecipients) {
        try {
          splitRecipients = JSON.parse(options.splitRecipients);
        } catch {
          errors.push('Invalid --split-recipients JSON');
        }
      }

      if (options.vaultType === 'split' && !splitRecipients) errors.push('--split-recipients required for split vault');
      if (options.vaultType === 'gift' && !options.giftXHandle) errors.push('--gift-x-handle required for gift vault');

      // Address validation for recipient fields
      if (options.fundsRecipient && !isAddress(options.fundsRecipient)) {
        errors.push(`Invalid --funds-recipient address: ${options.fundsRecipient}`);
      }
      if (options.vestingRecipient && !isAddress(options.vestingRecipient)) {
        errors.push(`Invalid --vesting-recipient address: ${options.vestingRecipient}`);
      }

      if (errors.length > 0) {
        console.error(JSON.stringify({ success: false, errors }));
        process.exit(1);
      }

      const chainId = getChainId();
      const account = getAccount();
      const walletClient = getWalletClient();
      const publicClient = getPublicClient();
      const addrs = getAddresses();
      const apiUrl = getApiUrl();
      const pair = (options.pair || 'ETH').toUpperCase();
      const template = getCollateralTemplate(chainId, pair);
      const buildParams = ({ tokenUri, salt }) =>
        buildCreateParams({
          name: options.name,
          symbol: options.symbol,
          tokenUri,
          salt,
          account: account.address,
          chainId,
          pair,
          targetRaise: options.targetRaise,
          bondingCurvePct: options.bondingCurvePct,
          vestingPct: options.vestingPct,
          vestingDuration: options.vestingDuration,
          cliffDuration: options.cliffDuration,
          vestingRecipient: options.vestingRecipient,
          taxRate: options.taxRate,
          fundsPct: options.fundsPct,
          burnPct: options.burnPct,
          dividendPct: options.dividendPct,
          liquidityPct: options.liquidityPct,
          dividendMinBalance: options.dividendMinBalance,
          fundsRecipient: options.fundsRecipient,
          vaultType: options.vaultType,
          splitRecipients,
          giftXHandle: options.giftXHandle,
        });

      // ── Step 1: Validate CreateParams locally (no network calls) ──
      buildParams({
        tokenUri: 'ipfs://validation-only',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000000',
      });

      // ── Step 2: Validate buy amount locally ──
      let isBuying = false;
      let buyAmountWei = 0n;
      if (options.buyAmount != null) {
        const buyAmountRaw = parseFloat(options.buyAmount);
        if (!Number.isFinite(buyAmountRaw) || buyAmountRaw < 0) {
          throw new Error(`Invalid --buy-amount: "${options.buyAmount}"`);
        }
        isBuying = buyAmountRaw > 0;
        buyAmountWei = isBuying ? parseUnits(options.buyAmount, template.DECIMALS) : 0n;
      }

      // ── Step 3: Upload image + metadata ──
      console.error('📤 Uploading to IPFS...');
      const imageBuffer = readFileSync(imagePath);
      const blob = new Blob([imageBuffer]);
      const formData = new FormData();
      formData.append('name', options.name);
      formData.append('symbol', options.symbol);
      if (options.description) formData.append('description', options.description);
      if (options.website) formData.append('website', options.website);
      if (options.twitter) formData.append('twitter', options.twitter);
      if (options.telegram) formData.append('telegram', options.telegram);
      formData.append('image', blob, 'image.png');

      let tokenUri, imageUri;
      const uploadResp = await axios.post(`${apiUrl}/private/token/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      if (uploadResp.data.code !== 0) {
        throw new Error(`IPFS upload failed: ${uploadResp.data.msg}`);
      }
      tokenUri = uploadResp.data.data.token_uri;
      imageUri = uploadResp.data.data.image_uri;
      console.error('✅ Metadata uploaded');

      // ── Step 4: Get salt (fatal — singleton mode requires valid salt) ──
      const isTaxEnabled = taxRate > 0;
      const implAddress = isTaxEnabled
        ? addrs.bFunTaxTokenImplementation
        : addrs.bFunTokenImplementation;
      const saltResp = await axios.get(
        `${apiUrl}/coin/address/salt?factory=${addrs.bFunFactory}&implementation=${implAddress}&chain_id=${chainId}`,
      );
      if (!saltResp.data?.data?.salt) {
        throw new Error(`Salt fetch returned no salt: ${JSON.stringify(saltResp.data)}`);
      }
      const salt = saltResp.data.data.salt;
      console.error(`🔑 Salt: ${salt.slice(0, 10)}...`);

      // ── Step 5: Build CreateParams with real URI + salt ──
      const createParams = buildParams({ tokenUri, salt });

      const isEthPair = template.COLLATERAL_TOKEN === ZERO_ADDRESS;
      const txValue = isEthPair ? buyAmountWei : 0n;

      // ── Step 6: ERC20 approve if non-ETH pair with buy ──
      if (!isEthPair && isBuying) {
        console.error('🔓 Approving ERC20 spend...');
        const allowance = await publicClient.readContract({
          address: template.COLLATERAL_TOKEN,
          abi: erc20ABI,
          functionName: 'allowance',
          args: [account.address, addrs.bFunFactory],
        });
        if (allowance < buyAmountWei) {
          // USDT-like tokens require resetting allowance to 0 before setting a new value
          // (zeroFirstOnChange pattern from frontend buildErc20ApproveCalls)
          if (allowance > 0n) {
            console.error('🔄 Resetting allowance to 0 (USDT-safe)...');
            const resetTx = await walletClient.writeContract({
              address: template.COLLATERAL_TOKEN,
              abi: erc20ABI,
              functionName: 'approve',
              args: [addrs.bFunFactory, 0n],
            });
            const resetReceipt = await publicClient.waitForTransactionReceipt({ hash: resetTx });
            if (resetReceipt.status !== 'success') {
              throw new Error(`ERC20 approve reset reverted (tx: ${resetTx}). Aborting.`);
            }
          }
          const approveTx = await walletClient.writeContract({
            address: template.COLLATERAL_TOKEN,
            abi: erc20ABI,
            functionName: 'approve',
            args: [addrs.bFunFactory, buyAmountWei],
          });
          console.error(`✅ Approve tx: ${approveTx}`);
          const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
          if (approveReceipt.status !== 'success') {
            throw new Error(`ERC20 approve reverted (tx: ${approveTx}). Aborting to avoid wasting gas.`);
          }
        } else {
          console.error('✅ Allowance sufficient');
        }
      }

      // ── Step 7: Send create transaction ──
      const functionName = isBuying ? 'createBFunTokenAndBuy' : 'createBFunToken';
      const args = isBuying
        ? [createParams, { collateralAmountIn: buyAmountWei, tokenAmountMin: 0n }]
        : [createParams];

      console.error(`📝 Sending ${functionName}...`);

      const txHash = await walletClient.writeContract({
        address: addrs.bFunFactory,
        abi: bFunFactoryABI,
        functionName,
        args,
        ...(txValue > 0n ? { value: txValue } : {}),
      });

      console.error(`✅ Tx sent: ${txHash}`);
      console.error('⏳ Waiting for confirmation...');

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status !== 'success') {
        console.error(JSON.stringify({ success: false, error: 'Transaction reverted', transactionHash: txHash }));
        process.exit(1);
      }

      // Parse NewBFunToken event
      let tokenAddress = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: bFunFactoryEvents,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'NewBFunToken') {
            tokenAddress = decoded.args.addr;
            break;
          }
        } catch {
          // not our event
        }
      }

      // ── Step 8: Notify backend ──
      try {
        const submitForm = new FormData();
        submitForm.append('chain_id', String(chainId));
        submitForm.append('tx_id', txHash);
        submitForm.append('tx_type', '1');
        submitForm.append('user_address', account.address);
        submitForm.append('check_code', md5Hex(account.address, txHash));
        await axios.post(`${apiUrl}/coin/submit_tx_id`, submitForm, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        console.error('✅ Backend notified');
      } catch (err) {
        console.error(`⚠️ Backend notify failed: ${err.message}`);
      }

      // ── Output ──
      const isAdvanced = parseFloat(options.targetRaise || '0') > 0 ||
        parseInt(options.vestingPct || '0', 10) > 0 ||
        taxRate > 0 ||
        !!options.vaultType;

      console.log(JSON.stringify({
        success: true,
        data: {
          tokenAddress,
          transactionHash: txHash,
          mode: isAdvanced ? 'advanced' : 'standard',
          pair,
          taxEnabled: taxRate > 0,
          buyAmount: options.buyAmount || '0',
        },
      }, null, 2));

    } catch (err) {
      console.error(JSON.stringify({ success: false, error: err.message }));
      process.exit(1);
    }
  });
