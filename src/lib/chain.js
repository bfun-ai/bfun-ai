import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';

const DEFAULT_RPC_URL = 'https://bsc-rpc.publicnode.com';
const DEFAULT_CHAIN_ID = 56; // BSC mainnet

const chainId = parseInt(process.env.BFUN_CHAIN_ID || String(DEFAULT_CHAIN_ID), 10);

let config = {
  rpcUrl: process.env.BSC_RPC_URL || DEFAULT_RPC_URL,
  chainId,
  apiUrl: process.env.BFUN_API_URL || 'https://api.b.fun',
};

export function getConfig() {
  return { ...config };
}

export function setConfig(newConfig) {
  config = { ...config, ...newConfig };
}

export function getChain() {
  if (config.chainId !== 56) {
    throw new Error(`Unsupported chain ID: ${config.chainId}. This package only supports BSC mainnet (56).`);
  }
  return bsc;
}

let publicClient = null;

export function getPublicClient() {
  if (!publicClient) {
    const chain = getChain();
    publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });
  }
  return publicClient;
}

export function getChainId() {
  return config.chainId;
}

export function getApiUrl() {
  return config.apiUrl;
}

// For testing - reset the client when config changes
export function resetClient() {
  publicClient = null;
}
