import { createHash } from 'crypto';
import { encodeAbiParameters, parseUnits, isAddress } from 'viem';
import { ZERO_ADDRESS, getCollateralTemplate, getChainConfig } from './chain-configs.js';
import { getAddressesForChain } from './contracts.js';

// ── Duration Parsing ──────────────────────────────────────────────────
// Accepts: "6m", "90d", "1y", "180" (defaults to days), plain number (days)
export function parseDuration(value) {
  if (!value || value === '0') return 0n;
  const str = String(value).trim().toLowerCase();
  const num = parseFloat(str);
  if (str.endsWith('y')) return BigInt(Math.floor(num * 365 * 86400));
  if (str.endsWith('m')) return BigInt(Math.floor(num * 30 * 86400));
  if (str.endsWith('d')) return BigInt(Math.floor(num * 86400));
  // plain number = days
  return BigInt(Math.floor(Number(str) * 86400));
}

// ── MD5 Check Code (matches frontend m5/index.ts) ────────────────────
// md5Hex(address, txHash) = MD5( (last6 of address + last6 of hash).toLowerCase() )
export function md5Hex(a, b) {
  const c = ((a || '').slice(-6) + (b || '').slice(-6)).toLowerCase();
  return createHash('md5').update(c).digest('hex');
}

// ── Vault Data Encoding ──────────────────────────────────────────────
export function getVaultFactoryAddress(vaultType, chainId) {
  const addrs = getAddressesForChain(chainId);
  const map = {
    split: addrs.splitVaultFactory,
    snowball: addrs.snowBallVaultFactory,
    burn_dividend: addrs.burnDividendVaultFactory,
    gift: addrs.giftVaultFactory,
  };
  const addr = map[vaultType];
  if (!addr) throw new Error(`Unknown vault type: ${vaultType}`);
  return addr;
}

export function encodeVaultData(vaultType, options, chainId) {
  const config = getChainConfig(chainId);

  switch (vaultType) {
    case 'split': {
      // recipients: [{ address, pct }] → encode as tuple[] with bps
      const recipients = options.splitRecipients;
      if (!recipients || !recipients.length) {
        throw new Error('--split-recipients required for split vault');
      }
      for (const r of recipients) {
        if (!isAddress(r.address)) {
          throw new Error(`Invalid split recipient address: ${r.address}`);
        }
      }
      const totalPct = recipients.reduce((s, r) => s + r.pct, 0);
      if (totalPct !== 100) {
        throw new Error(`Split recipients percentages must sum to 100, got ${totalPct}`);
      }
      const encoded = encodeAbiParameters(
        [{ type: 'tuple[]', components: [
          { type: 'address', name: 'recipient' },
          { type: 'uint16', name: 'bps' },
        ]}],
        [recipients.map(r => ({ recipient: r.address, bps: r.pct * 100 }))]
      );
      return encoded;
    }

    case 'snowball':
    case 'burn_dividend': {
      // Both use VAULT_KEEPER address
      return encodeAbiParameters(
        [{ type: 'address' }],
        [config.VAULT_KEEPER]
      );
    }

    case 'gift': {
      const xHandle = options.giftXHandle;
      if (!xHandle) throw new Error('--gift-x-handle required for gift vault');
      if (!/^[a-zA-Z0-9_]{1,15}$/.test(xHandle)) {
        throw new Error('Gift X handle must be 1-15 alphanumeric/underscore characters');
      }
      return encodeAbiParameters(
        [{ type: 'tuple', components: [{ name: 'xHandle', type: 'string' }] }],
        [{ xHandle }]
      );
    }

    default:
      throw new Error(`Unknown vault type: ${vaultType}`);
  }
}

// ── Build CreateParams struct ────────────────────────────────────────
export function buildCreateParams(opts) {
  const {
    name,
    symbol,
    tokenUri,
    salt,
    account,
    chainId,
    pair = 'ETH',
    // Advanced
    targetRaise,
    bondingCurvePct = 80,
    vestingPct = 0,
    vestingDuration,
    cliffDuration,
    vestingRecipient,
    // Tax
    taxRate = 0,
    fundsPct = 0,
    burnPct = 0,
    dividendPct = 0,
    liquidityPct = 0,
    dividendMinBalance = 10000,
    fundsRecipient,
    // Vault
    vaultType,
    splitRecipients,
    giftXHandle,
  } = opts;

  const template = getCollateralTemplate(chainId, pair);
  const bondPct = Number(bondingCurvePct);
  const vestPct = Number(vestingPct);
  const migrationPct = 20;

  // Validation
  if (bondPct + vestPct + migrationPct !== 100) {
    throw new Error(`bonding(${bondPct}) + vesting(${vestPct}) + migration(${migrationPct}) must = 100`);
  }

  // Target raise — only set when user explicitly provides it
  let targetRaiseWei = 0n;
  if (targetRaise) {
    targetRaiseWei = parseUnits(String(targetRaise), template.DECIMALS);
    // Validate bounds: DEFAULT_TARGET_RAISE/2 .. DEFAULT_TARGET_RAISE*100
    const defaultRaise = BigInt(template.DEFAULT_TARGET_RAISE);
    const minRaise = defaultRaise / 2n;
    const maxRaise = defaultRaise * 100n;
    if (targetRaiseWei < minRaise || targetRaiseWei > maxRaise) {
      throw new Error(`Target raise out of range. Min: ${minRaise}, Max: ${maxRaise}, Got: ${targetRaiseWei}`);
    }
  }

  // Dividend min balance validation
  if (Number(dividendPct) > 0 && Number(dividendMinBalance) < 10000) {
    throw new Error('--dividend-min-balance must be >= 10000 when dividend allocation > 0');
  }

  // Vesting
  const lockBps = vestPct * 100;
  const lockupDur = parseDuration(cliffDuration);
  const vestingDur = parseDuration(vestingDuration);
  const lockAdmin = vestPct > 0 ? (vestingRecipient || account) : ZERO_ADDRESS;

  // Tax
  const taxRateBps = Number(taxRate) * 100; // taxRate is in percent (1,2,3,5)
  const hasTax = taxRateBps > 0;
  const taxDuration = hasTax ? 3153600000n : 0n; // ~100 years
  const antiFarmerDuration = hasTax ? 259200n : 0n; // 3 days

  // Tax allocations (in percent → bps)
  const fPct = Number(fundsPct);
  const bPct = Number(burnPct);
  const dPct = Number(dividendPct);
  const lPct = Number(liquidityPct);
  if (hasTax && (fPct + bPct + dPct + lPct !== 100)) {
    throw new Error(`Tax allocations must sum to 100%, got ${fPct + bPct + dPct + lPct}%`);
  }

  // Vault / market payout recipient
  // Contract rule: marketPayoutRecipient must be ZERO_ADDRESS when tax is disabled
  // (error MarketPayoutRecipientNotZeroWhenTaxDisabled)
  let marketVaultFactory = ZERO_ADDRESS;
  let marketVaultData = '0x';
  let marketPayoutRecipient = hasTax ? (fundsRecipient || account) : ZERO_ADDRESS;

  if (vaultType) {
    marketVaultFactory = getVaultFactoryAddress(vaultType, chainId);
    marketVaultData = encodeVaultData(vaultType, { splitRecipients, giftXHandle }, chainId);
    marketPayoutRecipient = ZERO_ADDRESS;
  }

  return {
    name,
    symbol,
    tokenURI: tokenUri,
    nonce: 0n,
    signature: '0x',
    tokenSalt: salt || '0x0000000000000000000000000000000000000000000000000000000000000000',
    payoutRecipient: account,
    marketPayoutRecipient,
    marketVaultFactory,
    marketVaultData,
    collateralToken: template.COLLATERAL_TOKEN,
    targetRaise: targetRaiseWei,
    lockBps,
    lockupDuration: lockupDur,
    vestingDuration: vestingDur,
    lockAdmin,
    taxRateBps,
    taxDuration,
    antiFarmerDuration,
    processorMarketBps: fPct * 100,
    processorDeflationBps: bPct * 100,
    processorLpBps: lPct * 100,
    processorDividendBps: dPct * 100,
    // Contract requires minimumShareBalance == 0 when dividends are disabled
    minimumShareBalance: dPct > 0 ? parseUnits(String(dividendMinBalance), 18) : 0n,
  };
}

// ── Salt Fetcher ─────────────────────────────────────────────────────
export async function fetchSalt(apiUrl, factoryAddr, implAddr) {
  const url = `${apiUrl}/coin/address/salt?factory=${factoryAddr}&implementation=${implAddr}`;
  let resp;
  try {
    resp = await fetch(url);
  } catch (err) {
    throw new Error(`Salt fetch network error (fatal — singleton mode requires valid salt): ${err.message}`);
  }
  if (!resp.ok) {
    throw new Error(`Salt fetch HTTP ${resp.status} (fatal — singleton mode requires valid salt)`);
  }
  const json = await resp.json();
  if (!json.data?.salt) {
    throw new Error(`Salt fetch returned no salt (fatal): ${JSON.stringify(json)}`);
  }
  return json.data.salt;
}

// ── Submit TX to Backend ─────────────────────────────────────────────
export async function submitTxId(apiUrl, chainId, txHash, userAddress) {
  const formData = new FormData();
  formData.append('chain_id', String(chainId));
  formData.append('tx_id', txHash);
  formData.append('tx_type', '1');
  formData.append('user_address', userAddress);
  formData.append('check_code', md5Hex(userAddress, txHash));

  const resp = await fetch(`${apiUrl}/coin/submit_tx_id`, {
    method: 'POST',
    body: formData,
  });
  return resp.json();
}
