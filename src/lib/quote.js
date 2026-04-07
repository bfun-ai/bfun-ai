import { formatEther, formatUnits, parseEther, parseUnits } from 'viem';
import { getTokenInfo } from './api.js';
import { getChainId, getPublicClient } from './chain.js';
import { getChainConfig, isNativeCollateralAddress, ZERO_ADDRESS, getCollateralTemplateByAddress } from './chain-configs.js';
import { getAmountOutAndFee, getGraduationQuoteFromCurrent } from './bonding-curve.js';
import { bFunFactoryABI, bondingCurveABI, erc20ABI, getAddresses, readContractsWithFallback, tradeHelperABI } from './contracts.js';
import { assertSupportedCoinVersion, shouldUseUniswapV2 } from './version.js';

const QUOTE_ACCOUNT = '0x000000000000000000000000000000000000dEaD';

function normalizeSlippageBpsInput(value, defaultValue = 500) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error(`Invalid slippage bps: ${value}`);
  }
  if (parsed < 0 || parsed > 10_000) {
    throw new Error(`Slippage bps must be between 0 and 10000. Received: ${parsed}`);
  }
  return parsed;
}

function applyMinOut(amount, slippageBps) {
  if (slippageBps <= 0) return amount;
  if (slippageBps >= 10_000) return 0n;
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

function unwrapApiResponse(response) {
  if (response && typeof response === 'object' && 'data' in response) {
    return response.data;
  }
  return response;
}

function safeJsonParse(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function selectTokenRecord(data, tokenAddress) {
  if (!data) return null;
  if (Array.isArray(data?.list)) {
    return selectTokenRecord(data.list, tokenAddress);
  }
  if (Array.isArray(data)) {
    const match = data.find(
      (item) => item?.contract_address?.toLowerCase() === tokenAddress.toLowerCase(),
    );
    if (!match) {
      throw new Error(`Token ${tokenAddress} not found in API response`);
    }
    return match;
  }
  if (data.contract_address?.toLowerCase() !== tokenAddress.toLowerCase()) {
    throw new Error(`Token mismatch: requested ${tokenAddress}, got ${data.contract_address}`);
  }
  return data;
}

function parseExtraData(extraData) {
  const parsed = safeJsonParse(extraData);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function deriveTokenPhase({ tradingStopped, sendingToPairForbidden }) {
  if (!tradingStopped) return 'curve';
  if (sendingToPairForbidden === true) return 'graduated';
  return 'dex';
}

function getTaxRateBps(extraData, { phase }) {
  const raw = BigInt(extraData?.tax_token_params?.taxRateBps || 0);
  if (phase === 'dex' && Number(extraData?.tax_token_poll_state || 0) === 4) {
    return 0n;
  }
  return raw;
}

function formatQuote(quote, tokenDecimals) {
  if (quote.side === 'buy') {
    return {
      tokenAddress: quote.tokenAddress,
      phase: quote.phase,
      pairType: quote.isEthPair ? 'eth' : 'collateral',
      collateralAddress: quote.collateralAddress,
      tradeWithEth: !quote.isEthPair,
      expectedOut: formatUnits(quote.expectedOutWei, tokenDecimals),
      minOut: formatUnits(quote.minOutWei, tokenDecimals),
      fee: quote.isEthPair ? formatEther(quote.feeWei) : formatUnits(quote.feeWei, quote.collateralDecimals || 18),
      feeAsset: quote.isEthPair ? 'BNB' : 'collateral',
      refund: quote.isEthPair ? formatEther(quote.refundWei) : formatUnits(quote.refundWei, quote.collateralDecimals || 18),
      refundAsset: quote.isEthPair ? 'BNB' : 'collateral',
      taxApplied: quote.taxApplied,
      taxRateBps: quote.taxRateBps.toString(),
      expectedOutWei: quote.expectedOutWei.toString(),
      minOutWei: quote.minOutWei.toString(),
      feeWei: quote.feeWei.toString(),
      refundWei: quote.refundWei.toString(),
      expectedTokenOut: formatUnits(quote.expectedOutWei, tokenDecimals),
      minTokenOut: formatUnits(quote.minOutWei, tokenDecimals),
      bnbIn: quote.inputAmount,
      bnbInWei: quote.inputWei.toString(),
    };
  }

  return {
    tokenAddress: quote.tokenAddress,
    phase: quote.phase,
    pairType: quote.isEthPair ? 'eth' : 'collateral',
    collateralAddress: quote.collateralAddress,
    tradeWithEth: !quote.isEthPair,
    expectedOut: formatEther(quote.expectedOutWei),
    minOut: formatEther(quote.minOutWei),
    fee: quote.isEthPair ? formatEther(quote.feeWei) : formatUnits(quote.feeWei, quote.collateralDecimals || 18),
    feeAsset: quote.isEthPair ? 'BNB' : 'collateral',
    taxApplied: quote.taxApplied,
    taxRateBps: quote.taxRateBps.toString(),
    expectedOutWei: quote.expectedOutWei.toString(),
    minOutWei: quote.minOutWei.toString(),
    feeWei: quote.feeWei.toString(),
    expectedBnbOut: formatEther(quote.expectedOutWei),
    minBnbOut: formatEther(quote.minOutWei),
    tokenIn: quote.inputAmount,
    tokenInWei: quote.inputWei.toString(),
  };
}

async function simulateHelper(client, helperAddress, functionName, args) {
  const { result } = await client.simulateContract({
    address: helperAddress,
    abi: tradeHelperABI,
    functionName,
    args,
    account: QUOTE_ACCOUNT,
  });
  return result;
}

async function quoteEthToCollateral(client, helperAddress, tokenAddress, ethIn) {
  if (ethIn === 0n) {
    return [ZERO_ADDRESS, 0n];
  }
  const result = await simulateHelper(client, helperAddress, 'quoteEthToCollateralForToken', [tokenAddress, ethIn]);
  return result;
}

async function quoteCollateralToEth(client, helperAddress, tokenAddress, collateralIn) {
  if (collateralIn === 0n) {
    return [ZERO_ADDRESS, 0n];
  }
  const result = await simulateHelper(client, helperAddress, 'quoteCollateralToEthForToken', [tokenAddress, collateralIn]);
  return result;
}

async function quoteDexExactInput(client, helperAddress, tokenIn, tokenOut, amountIn) {
  if (amountIn === 0n) return 0n;
  return client.readContract({
    address: helperAddress,
    abi: tradeHelperABI,
    functionName: 'quoteDexExactInput',
    args: [tokenIn, tokenOut, amountIn],
  });
}

async function loadTokenContext(tokenAddress) {
  const client = getPublicClient();
  const chainId = getChainId();
  const chainConfig = getChainConfig(chainId);
  const addresses = getAddresses();

  const infoResponse = await getTokenInfo(tokenAddress);
  const token = selectTokenRecord(unwrapApiResponse(infoResponse), tokenAddress);
  if (!token) {
    throw new Error(`Token info not found for ${tokenAddress}`);
  }

  const extraData = parseExtraData(token.extra_data);
  if (!token.contract_address) {
    throw new Error(`Token ${tokenAddress} metadata missing contract_address`);
  }
  const coinVersion = token.coin_version || extraData?.coin_version;
  if (!coinVersion) {
    throw new Error(`Token ${tokenAddress} metadata missing coin_version`);
  }
  assertSupportedCoinVersion(coinVersion);
  if (!shouldUseUniswapV2(coinVersion)) {
    throw new Error(`coin_version ${coinVersion} is not a Uniswap V2 token.`);
  }

  const collateralAddress = token.currency_address || ZERO_ADDRESS;
  const isEthPair = isNativeCollateralAddress(collateralAddress, chainConfig);

  const [tokenDecimals, collateralDecimalsRead, bondingCurveAddress] = await readContractsWithFallback(client, [
    { address: tokenAddress, abi: erc20ABI, functionName: 'decimals' },
    isEthPair
      ? { address: tokenAddress, abi: erc20ABI, functionName: 'decimals' }
      : { address: collateralAddress, abi: erc20ABI, functionName: 'decimals' },
    {
      address: addresses.bFunFactory,
      abi: bFunFactoryABI,
      functionName: 'tokenToBondingCurve',
      args: [tokenAddress],
    },
  ]);
  const resolvedCollateralDecimals = isEthPair ? 18 : collateralDecimalsRead;
  const [tradingStopped, sendingToPairForbidden] = await readContractsWithFallback(client, [
    {
      address: bondingCurveAddress,
      abi: bondingCurveABI,
      functionName: 'tradingStopped',
    },
    {
      address: bondingCurveAddress,
      abi: bondingCurveABI,
      functionName: 'sendingToPairForbidden',
    },
  ]);
  const phase = deriveTokenPhase({ tradingStopped, sendingToPairForbidden });

  // Merge collateral template over chain config (same logic as frontend useContractConfig):
  // { ...chainConfig, ...collateralTemplate[pair] }
  // This ensures per-pair FEE_BASIS_POINTS, FIRST_BUY_FEE, MC limits etc. are used.
  const pairTemplate = getCollateralTemplateByAddress(chainId, collateralAddress);
  const mergedConfig = pairTemplate ? { ...chainConfig, ...pairTemplate } : chainConfig;

  const dyn = extraData?.dynamic_params;
  const useDynamicParams = !!dyn?.targetRaise && !!dyn?.virtualCollateralReservesInitial;

  const targetRaise = useDynamicParams
    ? dyn.targetRaise
    : (mergedConfig.DEFAULT_TARGET_RAISE || mergedConfig.TARGET_COLLECTION_AMOUNT);
  const virtualCollateralReservesInitial = useDynamicParams
    ? dyn.virtualCollateralReservesInitial
    : (mergedConfig.VIRTUAL_COLLATERAL_RESERVES);

  return {
    client,
    chainId,
    chainConfig: mergedConfig,
    addresses,
    tokenAddress,
    token,
    extraData,
    coinVersion,
    phase,
    isEthPair,
    collateralAddress,
    tokenDecimals: Number(tokenDecimals),
    collateralDecimals: Number(resolvedCollateralDecimals),
    bondingCurveAddress,
    virtualCollateralReserves: parseUnits(String(token.virtual_collateral_reserves || '0'), Number(resolvedCollateralDecimals)),
    virtualTokenReserves: parseUnits(String(token.virtual_token_reserves || '0'), Number(tokenDecimals)),
    curveParams: {
      feeBps: BigInt(mergedConfig.FEE_BASIS_POINTS) + BigInt(extraData?.tax_token_params?.taxRateBps || 0),
      firstBuyFee: BigInt(mergedConfig.FIRST_BUY_FEE),
      firstBuyCompleted: Number.parseFloat(String(token.total_volume || '0')) > 0,
      mcUpperLimit: BigInt(mergedConfig.MC_UPPER_LIMIT),
      mcLowerLimit: BigInt(mergedConfig.MC_LOWER_LIMIT),
      totalSupply: BigInt(mergedConfig.TOTAL_SUPPLY),
      targetCollectionAmount: BigInt(targetRaise),
      virtualCollateralReservesInitial: BigInt(virtualCollateralReservesInitial),
    },
  };
}

export function normalizeSlippageBps(value, defaultValue = 500) {
  return normalizeSlippageBpsInput(value, defaultValue);
}

export async function quoteGraduation(tokenAddress) {
  const context = await loadTokenContext(tokenAddress);
  const formatCollateral = (amount) => formatUnits(amount, context.collateralDecimals);

  if (context.phase !== 'curve') {
    return {
      tokenAddress: context.tokenAddress,
      phase: context.phase,
      pairType: context.isEthPair ? 'eth' : 'collateral',
      collateralAddress: context.collateralAddress,
      grossAmountIn: 0n,
      grossAmountInFormatted: formatCollateral(0n),
      netCollateralNeeded: 0n,
      netCollateralNeededFormatted: formatCollateral(0n),
      firstBuyFee: 0n,
      firstBuyFeeFormatted: formatCollateral(0n),
      totalFeeBps: 0n,
      willStopTrading: true,
      reason: 'targetReached',
    };
  }

  const [
    virtualCollateralReserves,
    virtualTokenReserves,
    feeBPS,
    firstBuyCompleted,
    firstBuyFee,
    taxBps,
    isTaxToken,
    virtualCollateralReservesTarget,
    mcLowerLimit,
    mcUpperLimit,
  ] = await readContractsWithFallback(context.client, [
    {
      address: context.bondingCurveAddress,
      abi: bondingCurveABI,
      functionName: 'virtualCollateralReserves',
    },
    {
      address: context.bondingCurveAddress,
      abi: bondingCurveABI,
      functionName: 'virtualTokenReserves',
    },
    {
      address: context.bondingCurveAddress,
      abi: bondingCurveABI,
      functionName: 'feeBPS',
    },
    {
      address: context.bondingCurveAddress,
      abi: bondingCurveABI,
      functionName: 'firstBuyCompleted',
    },
    {
      address: context.bondingCurveAddress,
      abi: bondingCurveABI,
      functionName: 'firstBuyFee',
    },
    {
      address: context.bondingCurveAddress,
      abi: bondingCurveABI,
      functionName: 'taxBps',
    },
    {
      address: context.bondingCurveAddress,
      abi: bondingCurveABI,
      functionName: 'isTaxToken',
    },
    {
      address: context.bondingCurveAddress,
      abi: bondingCurveABI,
      functionName: 'virtualCollateralReservesTarget',
    },
    {
      address: context.bondingCurveAddress,
      abi: bondingCurveABI,
      functionName: 'mcLowerLimit',
    },
    {
      address: context.bondingCurveAddress,
      abi: bondingCurveABI,
      functionName: 'mcUpperLimit',
    },
  ]);

  const quote = getGraduationQuoteFromCurrent({
    virtualCollateralReserves,
    virtualTokenReserves,
    feeBPS,
    firstBuyCompleted,
    firstBuyFee,
    taxBps,
    isTaxToken,
    virtualCollateralReservesTarget,
    mcLowerLimit,
    mcUpperLimit,
  });

  return {
    tokenAddress: context.tokenAddress,
    phase: context.phase,
    pairType: context.isEthPair ? 'eth' : 'collateral',
    collateralAddress: context.collateralAddress,
    grossAmountIn: quote.grossAmountIn,
    grossAmountInFormatted: formatCollateral(quote.grossAmountIn),
    netCollateralNeeded: quote.netCollateralNeeded,
    netCollateralNeededFormatted: formatCollateral(quote.netCollateralNeeded),
    firstBuyFee: quote.firstBuyFee,
    firstBuyFeeFormatted: formatCollateral(quote.firstBuyFee),
    totalFeeBps: quote.totalFeeBps,
    willStopTrading: quote.willStopTrading,
    reason: quote.reason,
    maxTokenOutBeforeTarget: quote.maxTokenOutBeforeTarget,
    maxTokenOutBeforeTargetFormatted: formatUnits(quote.maxTokenOutBeforeTarget, context.tokenDecimals),
  };
}

export async function quoteBuy(tokenAddress, { bnbAmount, slippageBps = 500 } = {}) {
  const resolvedSlippageBps = normalizeSlippageBpsInput(slippageBps);
  const context = await loadTokenContext(tokenAddress);
  const amountInWei = parseEther(String(bnbAmount));
  const helperAddress = context.addresses.bFunFactoryTradeHelper;
  const taxRateBps = getTaxRateBps(context.extraData, { phase: context.phase });

  let expectedOutWei = 0n;
  let feeWei = 0n;
  let refundWei = 0n;

  if (context.phase === 'curve') {
    if (context.isEthPair) {
      const result = getAmountOutAndFee(
        amountInWei,
        context.virtualCollateralReserves,
        context.virtualTokenReserves,
        true,
        context.curveParams,
      );
      expectedOutWei = result.amount;
      feeWei = result.fee;
      refundWei = result.refund;
    } else {
      const [, collateralOut] = await quoteEthToCollateral(context.client, helperAddress, context.tokenAddress, amountInWei);
      const result = getAmountOutAndFee(
        collateralOut,
        context.virtualCollateralReserves,
        context.virtualTokenReserves,
        true,
        context.curveParams,
      );
      expectedOutWei = result.amount;
      // Non-ETH pair: contract refunds collateral tokens, not ETH.
      // Keep raw collateral values; formatQuote will label them correctly.
      feeWei = result.fee;
      refundWei = result.refund;
    }
  } else if (context.phase === 'dex') {
    if (context.isEthPair) {
      expectedOutWei = await quoteDexExactInput(context.client, helperAddress, ZERO_ADDRESS, context.tokenAddress, amountInWei);
    } else {
      const [collateralToken, collateralOut] = await quoteEthToCollateral(
        context.client,
        helperAddress,
        context.tokenAddress,
        amountInWei,
      );
      expectedOutWei = await quoteDexExactInput(
        context.client,
        helperAddress,
        collateralToken,
        context.tokenAddress,
        collateralOut,
      );
    }
  } else {
    throw new Error(
      "Token is in graduated state (migration pending). Trading is temporarily unavailable. Re-check with 'bfun token-info' later.",
    );
  }

  const minOutWei = applyMinOut(expectedOutWei, resolvedSlippageBps);

  return formatQuote(
    {
      side: 'buy',
      tokenAddress: context.tokenAddress,
      phase: context.phase,
      collateralAddress: context.collateralAddress,
      isEthPair: context.isEthPair,
      inputAmount: String(bnbAmount),
      inputWei: amountInWei,
      expectedOutWei,
      minOutWei,
      feeWei,
      refundWei,
      taxApplied: context.phase === 'curve' ? BigInt(context.extraData?.tax_token_params?.taxRateBps || 0) > 0n : taxRateBps > 0n,
      taxRateBps,
      collateralDecimals: context.collateralDecimals,
    },
    context.tokenDecimals,
  );
}

export async function quoteSell(tokenAddress, { tokenAmount, slippageBps = 500 } = {}) {
  const resolvedSlippageBps = normalizeSlippageBpsInput(slippageBps);
  const context = await loadTokenContext(tokenAddress);
  const amountInWei = parseUnits(String(tokenAmount), context.tokenDecimals);
  const helperAddress = context.addresses.bFunFactoryTradeHelper;
  const taxRateBps = getTaxRateBps(context.extraData, { phase: context.phase });

  let expectedOutWei = 0n;
  let feeWei = 0n;

  if (context.phase === 'curve') {
    const result = getAmountOutAndFee(
      amountInWei,
      context.virtualTokenReserves,
      context.virtualCollateralReserves,
      false,
      context.curveParams,
    );

    if (context.isEthPair) {
      expectedOutWei = result.amount;
      feeWei = result.fee;
    } else {
      expectedOutWei = (await quoteCollateralToEth(context.client, helperAddress, context.tokenAddress, result.amount))[1];
      // Fee is in collateral units; keep raw value, formatQuote will label correctly.
      feeWei = result.fee;
    }
  } else if (context.phase === 'dex') {
    if (context.isEthPair) {
      expectedOutWei = await quoteDexExactInput(
        context.client,
        helperAddress,
        context.tokenAddress,
        ZERO_ADDRESS,
        amountInWei,
      );
    } else {
      const collateralOut = await quoteDexExactInput(
        context.client,
        helperAddress,
        context.tokenAddress,
        context.collateralAddress,
        amountInWei,
      );
      expectedOutWei = (await quoteCollateralToEth(context.client, helperAddress, context.tokenAddress, collateralOut))[1];
    }
  } else {
    throw new Error(
      "Token is in graduated state (migration pending). Trading is temporarily unavailable. Re-check with 'bfun token-info' later.",
    );
  }

  const minOutWei = applyMinOut(expectedOutWei, resolvedSlippageBps);

  return formatQuote({
    side: 'sell',
    tokenAddress: context.tokenAddress,
    phase: context.phase,
    collateralAddress: context.collateralAddress,
    isEthPair: context.isEthPair,
    inputAmount: String(tokenAmount),
    inputWei: amountInWei,
    expectedOutWei,
    minOutWei,
    feeWei,
    taxApplied: context.phase === 'curve' ? BigInt(context.extraData?.tax_token_params?.taxRateBps || 0) > 0n : taxRateBps > 0n,
    taxRateBps,
    collateralDecimals: context.collateralDecimals,
  });
}
