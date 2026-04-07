import { get } from '../lib/api.js';

export async function taxInfoCommand(tokenAddress, options) {
  const params = { contract_address: tokenAddress };
  if (options.user) params.user_address = options.user;
  const res = await get('/coin/tax_info', params);
  return res.data;
}
