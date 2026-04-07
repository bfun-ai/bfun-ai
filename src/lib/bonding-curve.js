const MAX_BPS = 10_000n;
const ONE_TOKEN = 10n ** 18n;

function basisPoints(amount, bps) {
  return (amount * bps) / MAX_BPS;
}

function ceilDiv(a, b) {
  if (b === 0n) {
    throw new Error('Division by zero in ceilDiv');
  }
  return a === 0n ? 0n : ((a - 1n) / b) + 1n;
}

function mulDiv(a, b, c) {
  if (c === 0n) {
    throw new Error('Division by zero in mulDiv');
  }
  return (a * b) / c;
}

function errorWithCause(message, cause) {
  const error = new Error(message);
  error.cause = cause;
  return error;
}

function virtualCollateralReservesTarget(params) {
  return params.virtualCollateralReservesInitial + params.targetCollectionAmount;
}

function maxTokenOutBeforeTarget(virtualCollateralReserves, virtualTokenReserves, params) {
  const target = virtualCollateralReservesTarget(params);
  if (virtualCollateralReserves >= target) return 0n;
  const remainingNetCollateral = target - virtualCollateralReserves;
  return mulDiv(
    remainingNetCollateral,
    virtualTokenReserves,
    virtualCollateralReserves + remainingNetCollateral,
  );
}

function shouldTradingBeStopped(virtualCollateralReserves, virtualTokenReserves, params) {
  const target = virtualCollateralReservesTarget(params);
  if (virtualCollateralReserves >= target) return true;
  return maxTokenOutBeforeTarget(virtualCollateralReserves, virtualTokenReserves, params) < ONE_TOKEN;
}

export function getGraduationQuoteFromCurrent(state) {
  const virtualCollateral = BigInt(state.virtualCollateralReserves);
  const virtualToken = BigInt(state.virtualTokenReserves);
  const target = state.virtualCollateralReservesTarget !== undefined
    ? BigInt(state.virtualCollateralReservesTarget)
    : virtualCollateralReservesTarget(state);
  const mcLowerLimit = BigInt(state.mcLowerLimit ?? 0n);
  const mcUpperLimit = BigInt(state.mcUpperLimit ?? 0n);

  if (mcLowerLimit !== 0n || mcUpperLimit !== 0n) {
    throw new Error('Graduation quote is only supported for dynamic-create markets');
  }

  const taxBps = BigInt(state.taxBps ?? 0n);
  const totalFeeBps = BigInt(
    state.totalFeeBps ?? ((state.feeBps ?? state.feeBPS ?? 0n) + ((state.isTaxToken ?? false) ? taxBps : 0n)),
  );

  if (totalFeeBps >= MAX_BPS) {
    throw new Error(`totalFeeBps (${totalFeeBps}) must be less than 10000`);
  }

  const firstBuyFee = state.firstBuyCompleted ? 0n : BigInt(state.firstBuyFee ?? 0n);
  const netCollateralNeeded = virtualCollateral < target ? target - virtualCollateral : 0n;
  const maxTokenOut = netCollateralNeeded > 0n
    ? mulDiv(netCollateralNeeded, virtualToken, virtualCollateral + netCollateralNeeded)
    : 0n;

  if (netCollateralNeeded === 0n) {
    return {
      grossAmountIn: 0n,
      netCollateralNeeded,
      firstBuyFee,
      totalFeeBps,
      willStopTrading: true,
      reason: 'targetReached',
      maxTokenOutBeforeTarget: maxTokenOut,
    };
  }

  if (maxTokenOut < ONE_TOKEN) {
    return {
      grossAmountIn: 0n,
      netCollateralNeeded,
      firstBuyFee,
      totalFeeBps,
      willStopTrading: true,
      reason: 'dustThreshold',
      maxTokenOutBeforeTarget: maxTokenOut,
    };
  }

  const grossNeeded = totalFeeBps === 0n
    ? netCollateralNeeded
    : ceilDiv(netCollateralNeeded * MAX_BPS, MAX_BPS - totalFeeBps);

  return {
    grossAmountIn: firstBuyFee + grossNeeded + 1n,
    netCollateralNeeded,
    firstBuyFee,
    totalFeeBps,
    willStopTrading: true,
    reason: 'targetReached',
    maxTokenOutBeforeTarget: maxTokenOut,
  };
}

export function getAmountOutAndFee(amountIn, reserveIn, reserveOut, paymentTokenIsIn, params) {
  if (amountIn === 0n) throw new Error('AmountInZero');
  if (reserveIn === 0n || reserveOut === 0n) throw new Error('InvalidLiquidity');
  if (params.feeBps >= MAX_BPS) {
    throw new Error(`feeBps (${params.feeBps}) must be less than 10000`);
  }

  const { feeBps, firstBuyFee, firstBuyCompleted } = params;

  if (paymentTokenIsIn) {
    if (shouldTradingBeStopped(reserveIn, reserveOut, params)) {
      throw new Error('TradingStopped');
    }

    if (!firstBuyCompleted && amountIn <= firstBuyFee) {
      const minRequired = Number(firstBuyFee) / 1e18;
      throw new Error(`InsufficientFirstBuyFee: first buy amount must be greater than ${minRequired} (first buy fee). You sent ${Number(amountIn) / 1e18}.`);
    }

    let remainingValue = amountIn;
    let firstFee = 0n;
    if (!firstBuyCompleted) {
      remainingValue -= firstBuyFee;
      firstFee = firstBuyFee;
    }

    const collateralToPayWithFeeFull = remainingValue;
    const tradeFeeFull = basisPoints(collateralToPayWithFeeFull, feeBps);
    const netFull = collateralToPayWithFeeFull - tradeFeeFull;

    const virtualCollateral = reserveIn;
    const virtualCollateralTarget = virtualCollateralReservesTarget(params);

    let netUsed = netFull;
    let collateralToPayWithFee = collateralToPayWithFeeFull;
    let tradeFee = tradeFeeFull;

    if (virtualCollateral < virtualCollateralTarget) {
      const remainingNet = virtualCollateralTarget - virtualCollateral;
      if (netFull > remainingNet) {
        netUsed = remainingNet;

        if (feeBps === 0n) {
          collateralToPayWithFee = netUsed;
          tradeFee = 0n;
        } else {
          collateralToPayWithFee = (netUsed * MAX_BPS) / (MAX_BPS - feeBps);
          tradeFee = collateralToPayWithFee - netUsed;
        }
      }
    }

    const amountOut = netUsed > 0n ? mulDiv(netUsed, reserveOut, reserveIn + netUsed) : 0n;
    if (amountOut >= reserveOut) {
      throw new Error('InsufficientLiquidity');
    }

    const totalFee = tradeFee + firstFee;
    const usedGross = firstFee + collateralToPayWithFee;
    const refund = amountIn > usedGross ? amountIn - usedGross : 0n;

    return { amount: amountOut, fee: totalFee, refund, amountOutUsed: amountOut };
  }

  if (shouldTradingBeStopped(reserveOut, reserveIn, params)) {
    throw new Error('TradingStopped');
  }
  const grossOut = mulDiv(amountIn, reserveOut, reserveIn + amountIn);
  const fee = basisPoints(grossOut, feeBps);
  const amountOut = grossOut - fee;
  return { amount: amountOut, fee, refund: 0n, amountOutUsed: amountOut };
}

export function getAmountInAndFee(amountOut, reserveIn, reserveOut, paymentTokenIsOut, params) {
  if (amountOut === 0n) throw new Error('AmountOutZero');
  if (reserveIn === 0n || reserveOut === 0n) throw new Error('InvalidLiquidity');

  const { feeBps, firstBuyFee, firstBuyCompleted } = params;

  if (paymentTokenIsOut) {
    if (shouldTradingBeStopped(reserveOut, reserveIn, params)) {
      throw new Error('TradingStopped');
    }
    if (feeBps >= MAX_BPS) throw new Error('InvalidFeeBps');

    const grossOut = mulDiv(amountOut, MAX_BPS, MAX_BPS - feeBps);
    if (grossOut >= reserveOut) throw new Error('InsufficientLiquidity');

    const amountIn = mulDiv(grossOut, reserveIn, reserveOut - grossOut);
    const fee = grossOut - amountOut;
    return { amount: amountIn, fee, refund: 0n, amountOutUsed: amountOut };
  }

  if (shouldTradingBeStopped(reserveIn, reserveOut, params)) {
    const target = virtualCollateralReservesTarget(params);
    const remainingNetCollateral = reserveIn < target ? target - reserveIn : 0n;
    const maxOut = maxTokenOutBeforeTarget(reserveIn, reserveOut, params);
    throw errorWithCause('TradingStopped', {
      remainingNetCollateral,
      maxTokenOutBeforeTarget: maxOut,
    });
  }

  const virtualCollateral = reserveIn;
  const virtualCollateralTarget = virtualCollateralReservesTarget(params);
  const remainingNet = virtualCollateral < virtualCollateralTarget ? virtualCollateralTarget - virtualCollateral : 0n;

  if (remainingNet === 0n) {
    throw errorWithCause('TradingStopped', { remainingNetCollateral: 0n });
  }

  if (reserveOut === 0n) throw new Error('InsufficientLiquidity');
  const maxByVirtualReserves = reserveOut > 0n ? reserveOut - 1n : 0n;
  const maxByTarget = mulDiv(remainingNet, reserveOut, reserveIn + remainingNet);
  const maxAllowed = maxByTarget < maxByVirtualReserves ? maxByTarget : maxByVirtualReserves;

  let amountOutUsed = amountOut > maxAllowed ? maxAllowed : amountOut;
  if (amountOutUsed === 0n) throw new Error('InsufficientLiquidity');

  let collateralToSpend = mulDiv(amountOutUsed, reserveIn, reserveOut - amountOutUsed);
  if (collateralToSpend > remainingNet) {
    let guard = 0;
    while (amountOutUsed > 0n && collateralToSpend > remainingNet && guard < 32) {
      amountOutUsed -= 1n;
      collateralToSpend = mulDiv(amountOutUsed, reserveIn, reserveOut - amountOutUsed);
      guard += 1;
    }
    if (amountOutUsed === 0n || collateralToSpend > remainingNet) {
      throw errorWithCause('CollectionTargetExceeded', maxByTarget);
    }
  }

  const tradeFee = basisPoints(collateralToSpend, feeBps);
  const collateralToPayWithFee = collateralToSpend + tradeFee;

  let amountIn = collateralToPayWithFee;
  let fee = tradeFee;

  if (!firstBuyCompleted) {
    amountIn += firstBuyFee;
    fee += firstBuyFee;
  }

  return { amount: amountIn, fee, refund: 0n, amountOutUsed };
}
