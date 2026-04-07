import { parseUnits } from 'viem';
import { quoteSell } from '../lib/quote.js';
import { getPublicClient } from '../lib/chain.js';
import { getAddresses, tradeHelperABI, erc20ABI } from '../lib/contracts.js';
import { getAccount, getWalletClient } from '../lib/wallet.js';

function getSimulationReason(err) {
  return err?.cause?.reason || err?.shortMessage || err?.message || 'Unknown error';
}

async function ensureAllowance(publicClient, walletClient, tokenAddress, spender, amount, owner) {
  const currentAllowance = await publicClient.readContract({
    address: tokenAddress,
    abi: erc20ABI,
    functionName: 'allowance',
    args: [owner, spender],
  });

  if (currentAllowance < amount) {
    const hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: erc20ABI,
      functionName: 'approve',
      args: [spender, amount],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error('Token approve failed');
    }
  }
}

export async function sellCommand(tokenAddress, tokenAmount, options) {
  if (!tokenAmount || Number(tokenAmount) <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  const quote = await quoteSell(tokenAddress, {
    tokenAmount,
    slippageBps: options?.slippage,
  });
  if (quote.phase === 'graduated') {
    throw new Error(
      "Token is in graduated state (migration pending). Trading is temporarily unavailable. Re-check with 'bfun token-info' later.",
    );
  }

  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const addresses = getAddresses();
  const account = getAccount();
  const amountInWei = BigInt(quote.tokenInWei);
  const minEthOutWei = BigInt(quote.minOutWei);

  if (minEthOutWei <= 0n) {
    throw new Error('Quoted minimum output is 0. Trade would result in no output.');
  }

  const isDex = quote.phase === 'dex';

  // Curve: Factory does transferFrom via sellExactIn; DEX: TradeHelper does transferFrom via dexSellForEth
  const spender = isDex ? addresses.bFunFactoryTradeHelper : addresses.bFunFactory;
  await ensureAllowance(publicClient, walletClient, tokenAddress, spender, amountInWei, account.address);

  const functionName = isDex ? 'dexSellForEth' : 'sellForEth';
  const request = {
    address: addresses.bFunFactoryTradeHelper,
    abi: tradeHelperABI,
    functionName,
    args: [tokenAddress, amountInWei, minEthOutWei],
  };

  try {
    await publicClient.simulateContract({
      ...request,
      account: account.address,
    });
  } catch (err) {
    throw new Error(`Transaction would fail: ${getSimulationReason(err)}`);
  }

  const hash = await walletClient.writeContract(request);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') {
    throw new Error(`Transaction reverted (tx: ${receipt.transactionHash})`);
  }

  return {
    txHash: hash,
    action: 'sell',
    phase: quote.phase,
    from: account.address,
    token: tokenAddress,
    tokenAmount,
    expectedBnbOut: quote.expectedBnbOut,
    minBnbOut: quote.minBnbOut,
    receipt: {
      status: receipt.status,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
    },
  };
}
