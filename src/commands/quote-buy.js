import { quoteBuy } from '../lib/quote.js';

export async function quoteBuyCommand(tokenAddress, bnbAmount, options) {
  return quoteBuy(tokenAddress, {
    bnbAmount,
    slippageBps: options?.slippage,
  });
}
