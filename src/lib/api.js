import axios from 'axios';
import { getApiUrl, getChainId } from './chain.js';

const DEFAULT_TIMEOUT = 30000;

function createAxiosInstance() {
  return axios.create({
    baseURL: getApiUrl(),
    timeout: DEFAULT_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

const api = createAxiosInstance();

// Re-create instance if API URL changes
export function resetApi() {
  // axios instance is stateless, no reset needed
}

export async function get(endpoint, params = {}) {
  const chainId = getChainId();
  const queryParams = { ...params, chain_id: chainId };

  const response = await api.get(endpoint, { params: queryParams });
  return response.data;
}

export async function post(endpoint, data = {}) {
  const chainId = getChainId();
  const body = { ...data, chain_id: chainId };

  const response = await api.post(endpoint, body);
  return response.data;
}

// Token list API
export async function getTokenList(options = {}) {
  const { sort = 'block_create_time', kw = '', offset = 0, limit = 30 } = options;
  return get('/coin/list', { sort, kw, offset, limit });
}

// Token info API
export async function getTokenInfo(contractAddress) {
  return get('/coin/info', { contract_address: contractAddress });
}

// Token trade data API
export async function getTokenTradeData(contractAddresses) {
  const addressList = Array.isArray(contractAddresses)
    ? contractAddresses.join(',')
    : contractAddresses;
  return post('/coin/get_coin_trade_data', {
    contract_address_list: addressList,
  });
}

// Tax info API
export async function getTaxInfo(coinId, userAddress) {
  const params = { coin_id: coinId };
  if (userAddress) params.user_address = userAddress;
  return get('/coin/tax_info', params);
}

// Rankings API (same as token list with different sort)
export async function getRankings(orderBy, limit = 30) {
  return get('/coin/list', { sort: orderBy, offset: 0, limit });
}

export default api;
