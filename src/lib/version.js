function parseVersion(version) {
  return String(version || '0.0.0')
    .split('.')
    .map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isNaN(value) ? 0 : value;
    });
}

export function compareVersion(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    const lhs = a[i] || 0;
    const rhs = b[i] || 0;
    if (lhs > rhs) return 1;
    if (lhs < rhs) return -1;
  }

  return 0;
}

export function assertSupportedCoinVersion(coinVersion) {
  if (compareVersion(coinVersion, '11.1.0') < 0) {
    throw new Error(`Unsupported coin_version ${coinVersion}. This CLI only supports coin_version >= 11.1.0.`);
  }
}

export function shouldUseUniswapV2(coinVersion) {
  return compareVersion(coinVersion, '11.0.0') >= 0;
}
