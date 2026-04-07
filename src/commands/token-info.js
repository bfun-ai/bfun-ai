import { getPublicClient } from '../lib/chain.js';
import { getAddresses, bFunFactoryABI, bondingCurveABI, erc20ABI, readContractsWithFallback } from '../lib/contracts.js';

export function deriveTokenPhase({ tradingStopped, sendingToPairForbidden }) {
  if (!tradingStopped) return 'curve';
  if (sendingToPairForbidden === true) return 'graduated';
  return 'dex';
}

export async function tokenInfoCommand(tokenAddress) {
  const client = getPublicClient();
  const addrs = getAddresses();

  // Get BondingCurve address for this token
  const curveAddress = await client.readContract({
    address: addrs.bFunFactory,
    abi: bFunFactoryABI,
    functionName: 'tokenToBondingCurve',
    args: [tokenAddress],
  });

  if (!curveAddress || curveAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error(`No BondingCurve found for token ${tokenAddress}`);
  }

  // Read token ERC20 info + curve data in a single batched multicall
  const [
    name,
    symbol,
    decimals,
    collateralReserves,
    tokenReserves,
    feeBPS,
    taxBps,
    isTaxToken,
    firstBuyCompleted,
    firstBuyFee,
    tradingStopped,
    sendingToPairForbidden,
  ] =
    await readContractsWithFallback(client, [
      { address: tokenAddress, abi: erc20ABI, functionName: 'name' },
      { address: tokenAddress, abi: erc20ABI, functionName: 'symbol' },
      { address: tokenAddress, abi: erc20ABI, functionName: 'decimals' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'virtualCollateralReserves' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'virtualTokenReserves' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'feeBPS' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'taxBps' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'isTaxToken' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'firstBuyCompleted' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'firstBuyFee' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'tradingStopped' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'sendingToPairForbidden' },
    ]);

  const phase = deriveTokenPhase({ tradingStopped, sendingToPairForbidden });

  return {
    token: tokenAddress,
    bondingCurve: curveAddress,
    name,
    symbol,
    decimals,
    virtualCollateralReserves: collateralReserves.toString(),
    virtualTokenReserves: tokenReserves.toString(),
    feeBPS: Number(feeBPS),
    taxBps: Number(taxBps),
    isTaxToken,
    firstBuyCompleted,
    firstBuyFee: firstBuyFee.toString(),
    phase,
    isGraduated: phase !== 'curve',
    isMigrated: phase === 'dex',
  };
}
