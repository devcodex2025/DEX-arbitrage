import Decimal from "decimal.js";

// ======= ФУНКЦІЯ: Розрахунок спреду у % =======
export function calculateSpreadLamports(buyLamports, sellLamports) {
  const buy = new Decimal(buyLamports.toString());
  const sell = new Decimal(sellLamports.toString());
  return sell.minus(buy).dividedBy(buy).times(100).toNumber();
}