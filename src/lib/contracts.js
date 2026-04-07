import { getChainId } from './chain.js';

const addresses = {
  56: {
    bFunFactory: '0x718Fa87734Cc6fCe3e7374663a0DAfa334aa4876',
    bFunFactoryImpl: '0xf67BA0688aCb514AD3D5adE4AE140a2e8478C407',
    bFunFactoryTradeHelper: '0x164319437119132bbf8b3bEe180c669ad450e817',
    bondingCurveImpl: '0x7Bd40ef58c5D8Fe2ee97851Dd3b18956b5087F2B',
    bFunTokenSwap: '0x569242A5269eFd635654214253dbE498B2eDb9eC',
    bFunTokenImplementation: '0x84882b87929Eb8c62CD05658327B688cba789E31',
    bFunTaxTokenImplementation: '0x91589835927D2133b8B18f71537A9bF06d7629AD',
    splitVaultFactory: '0xB2935b344417e6240C380235262FA65e15746375',
    snowBallVaultFactory: '0x68C082cC36ee2166CF2dd7D82f8AcfF36331Fd54',
    burnDividendVaultFactory: '0xD4cDe006422348D1c62db86ade854FECA4eA77D2',
    giftVaultFactory: '0xA158E4F7271441A4bD2181389153AC8B2b931e16',
    vaultKeeper: '0x1f7f8a8963DF54E4bFC1315882ae517018CBB64a',
  },
};

export function getAddressesForChain(chainId) {
  const config = addresses[chainId];
  if (!config) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return config;
}

export function getAddresses() {
  return getAddressesForChain(getChainId());
}

export async function readContractsWithFallback(client, contracts) {
  if (!Array.isArray(contracts) || contracts.length === 0) {
    return [];
  }

  if (typeof client?.multicall === 'function') {
    try {
      return await client.multicall({
        contracts,
        allowFailure: false,
      });
    } catch {
      // Some public RPCs disable or rate-limit multicall; fall back to individual reads.
    }
  }

  if (typeof client?.readContract !== 'function') {
    throw new Error('Public client does not support readContract');
  }

  return Promise.all(contracts.map((contract) => client.readContract(contract)));
}

const createParamsComponents = [
  { name: 'name', type: 'string' },
  { name: 'symbol', type: 'string' },
  { name: 'tokenURI', type: 'string' },
  { name: 'nonce', type: 'uint256' },
  { name: 'signature', type: 'bytes' },
  { name: 'tokenSalt', type: 'bytes32' },
  { name: 'payoutRecipient', type: 'address' },
  { name: 'marketPayoutRecipient', type: 'address' },
  { name: 'marketVaultFactory', type: 'address' },
  { name: 'marketVaultData', type: 'bytes' },
  { name: 'collateralToken', type: 'address' },
  { name: 'targetRaise', type: 'uint256' },
  { name: 'lockBps', type: 'uint16' },
  { name: 'lockupDuration', type: 'uint64' },
  { name: 'vestingDuration', type: 'uint64' },
  { name: 'lockAdmin', type: 'address' },
  { name: 'taxRateBps', type: 'uint16' },
  { name: 'taxDuration', type: 'uint64' },
  { name: 'antiFarmerDuration', type: 'uint64' },
  { name: 'processorMarketBps', type: 'uint16' },
  { name: 'processorDeflationBps', type: 'uint16' },
  { name: 'processorLpBps', type: 'uint16' },
  { name: 'processorDividendBps', type: 'uint16' },
  { name: 'minimumShareBalance', type: 'uint256' },
];

const buyParamsComponents = [
  { name: 'collateralAmountIn', type: 'uint256' },
  { name: 'tokenAmountMin', type: 'uint256' },
];

export const bFunFactoryCreateABI = [
  {
    name: 'createBFunToken',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '', type: 'tuple', components: createParamsComponents }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'createBFunTokenAndBuy',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '', type: 'tuple', components: createParamsComponents },
      { name: '', type: 'tuple', components: buyParamsComponents },
    ],
    outputs: [
      { name: '', type: 'address' },
      { name: '', type: 'uint256' },
    ],
  },
];

export const bFunFactoryABI = [
  {
    name: 'tokenToBondingCurve',
    type: 'function',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'buyExactIn',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'minTokenOut', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'buyExactInWithCollateral',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'collateralAmount', type: 'uint256' },
      { name: 'minTokenOut', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'sellExactIn',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'tokenAmountIn', type: 'uint256' },
      { name: 'minCollateralOut', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  ...bFunFactoryCreateABI,
];

export const bondingCurveABI = [
  {
    name: 'virtualCollateralReserves',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'virtualTokenReserves',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'feeBPS',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'taxBps',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'isTaxToken',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'firstBuyCompleted',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'firstBuyFee',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'tradingStopped',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'sendingToPairForbidden',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'virtualCollateralReservesTarget',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'mcLowerLimit',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'mcUpperLimit',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getAmountOutAndFee',
    type: 'function',
    inputs: [
      { name: '_amountIn', type: 'uint256' },
      { name: '_reserveIn', type: 'uint256' },
      { name: '_reserveOut', type: 'uint256' },
      { name: '_paymentTokenIsIn', type: 'bool' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'fee', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
];

export const bFunFactoryEvents = [
  {
    name: 'NewBFunToken',
    type: 'event',
    inputs: [
      { name: 'addr', type: 'address', indexed: false },
      { name: 'bondingCurve', type: 'address', indexed: false },
      { name: 'creator', type: 'address', indexed: false },
      { name: 'signature', type: 'bytes', indexed: false },
      { name: 'payoutRecipient', type: 'address', indexed: false },
      { name: 'owner', type: 'address', indexed: false },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'name', type: 'string', indexed: false },
      { name: 'symbol', type: 'string', indexed: false },
      { name: 'tokenURI', type: 'string', indexed: false },
      { name: 'version', type: 'string', indexed: false },
    ],
  },
  {
    name: 'BFunTokenBuy',
    type: 'event',
    inputs: [
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'collateralAmount', type: 'uint256', indexed: false },
      { name: 'tokenAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'BFunTokenSell',
    type: 'event',
    inputs: [
      { name: 'seller', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'tokenAmount', type: 'uint256', indexed: false },
      { name: 'collateralAmount', type: 'uint256', indexed: false },
    ],
  },
];

export const erc20ApproveABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
];

export const erc20ABI = [
  {
    name: 'name',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'symbol',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'decimals',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  ...erc20ApproveABI,
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
];

export const tradeHelperABI = [
  {
    name: 'buyWithEth',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'funds', type: 'uint256' },
      { name: 'minTokenOut', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'sellForEth',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'tokenAmountIn', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'dexBuyWithEth',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'funds', type: 'uint256' },
      { name: 'minTokenOut', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'dexSellForEth',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'tokenAmountIn', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'quoteEthToCollateralForToken',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'ethIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'collateralOut', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    name: 'quoteCollateralToEthForToken',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'collateralIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'ethOut', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    name: 'quoteDexExactInput',
    type: 'function',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOutReceivedExpected', type: 'uint256' }],
    stateMutability: 'view',
  },
];

export const ERC8004_NFT_ADDRESS = process.env.ERC8004_NFT_ADDRESS || '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

export const erc8004ABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'tokenURI',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'ownerOf',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
];

export const erc8004Events = [
  {
    name: 'Registered',
    type: 'event',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
];

export default {
  getAddresses,
  getAddressesForChain,
  bFunFactoryABI,
  bFunFactoryCreateABI,
  bondingCurveABI,
  bFunFactoryEvents,
  erc20ApproveABI,
  erc20ABI,
  tradeHelperABI,
  ERC8004_NFT_ADDRESS,
  erc8004ABI,
  erc8004Events,
};
