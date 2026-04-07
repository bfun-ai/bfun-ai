import { parseEther } from 'viem';
import { quoteBuy } from '../lib/quote.js';
import { getPublicClient } from '../lib/chain.js';
import { getAddresses, tradeHelperABI } from '../lib/contracts.js';
import { getAccount, getWalletClient } from '../lib/wallet.js';

function getSimulationReason(err) {
  return err?.cause?.reason || err?.shortMessage || err?.message || 'Unknown error';
}

export async function buyCommand(tokenAddress, bnbAmount, options) {
  if (!bnbAmount || Number(bnbAmount) <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  const quote = await quoteBuy(tokenAddress, {
    bnbAmount,
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
  const amountInWei = parseEther(String(bnbAmount));
  const minTokenOutWei = BigInt(quote.minOutWei);

  if (minTokenOutWei <= 0n) {
    throw new Error('Quoted minimum output is 0. Trade would result in no output.');
  }

  const isDex = quote.phase === 'dex';
  const functionName = isDex ? 'dexBuyWithEth' : 'buyWithEth';
  const request = {
    address: addresses.bFunFactoryTradeHelper,
    abi: tradeHelperABI,
    functionName,
    args: [tokenAddress, amountInWei, minTokenOutWei],
    value: amountInWei,
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
    action: 'buy',
    phase: quote.phase,
    from: account.address,
    token: tokenAddress,
    bnbAmount,
    expectedTokenOut: quote.expectedTokenOut,
    minTokenOut: quote.minTokenOut,
    receipt: {
      status: receipt.status,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
    },
  };
}
