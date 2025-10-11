import { BASE_TOKEN_SYMBOL, BASE_TOKEN_MINT, BASE_TOKEN_LAMPORTS_AMOUNT, DELAY_MS } from "../Config/config";
import { getJupiterQuote } from "../Api/Jupiter";
import BN from "bn.js";

interface Token {
  mint: string;
  symbol: string;
  decimals: number;
  meteoraPairAddress?: string | null;
}

interface ScanResult {
  pair: string;
  buyAmount_lamports: string;
  tokenAmount_display: string;
  sellAmount_lamports: string;
  sellAmount_display: string;
  profitPercent: string;
  source: string;
}


export default async function scanTokenPairs({
  tokens,
  getMeteoraQuoteFn,
  source,
  results,
  checkForward = true,
  checkReverse = true,
}: {
  tokens: Token[];
  getMeteoraQuoteFn: (pairAddress: string, amountLamports: number) => Promise<BN | null | undefined>;
  source: string;
  results: ScanResult[];
  checkForward?: boolean;
  checkReverse?: boolean;
}) {
  for (const token of tokens) {
    try {
      console.log(`\n--- Scanning ${BASE_TOKEN_SYMBOL} / ${token.symbol} (${source}) ---`);
      const pairAddress = token.meteoraPairAddress;
      if (!pairAddress) {
        console.log(`No ${source} pair for ${token.symbol}, skipping...`);
        continue;
      }

      const TOKEN_LAMPORTS = 10 ** token.decimals;

      // === 1️⃣ Напрямок: Jupiter → Meteora ===
      if (checkForward) {
        await scanForward(token, TOKEN_LAMPORTS, pairAddress, getMeteoraQuoteFn, source, results);
      }

      // === 2️⃣ Напрямок: Meteora → Jupiter ===
      if (checkReverse) {
        await scanReverse(token, TOKEN_LAMPORTS, pairAddress, getMeteoraQuoteFn, source, results);
      }
    } catch (err: any) {
      console.error(`Error scanning ${token.symbol}:`, err.message);
    }
  }
}


// === 1️⃣ Функція для напрямку Jupiter → Meteora ===
async function scanForward(
  token: Token,
  TOKEN_LAMPORTS: number,
  pairAddress: string,
  getMeteoraQuoteFn: (pairAddress: string, amountLamports: number) => Promise<BN | null | undefined>,
  source: string,
  results: ScanResult[]
) {
  console.log(`\n➡️ Checking Jupiter → ${source} for ${token.symbol}`);
  const jupiterQuote = await getJupiterQuote(BASE_TOKEN_MINT, token.mint, BASE_TOKEN_LAMPORTS_AMOUNT);
  if (!jupiterQuote) {
    console.log(`Failed to get Jupiter quote for ${token.symbol}`);
    return;
  }
  const lamportsReceived = Number(jupiterQuote.outAmount);
  //const lamportsReceived = Number(jupiterQuote.outAmount);
  const tokenDisplay = lamportsReceived / TOKEN_LAMPORTS;

  console.log(`${BASE_TOKEN_SYMBOL} → ${token.symbol} (Jupiter): ${lamportsReceived} Lamports (≈ ${tokenDisplay} ${token.symbol})`);

  await new Promise(r => setTimeout(r, DELAY_MS));

  if (!pairAddress) {
    console.log(`No ${source} pair for ${token.symbol}, skipping...`);
    return;
  }

  // Зворотний свап через вказану модель
  const sellAmountLamports = await getMeteoraQuoteFn(pairAddress, lamportsReceived);
  if (!sellAmountLamports) {
    console.log(`Price for ${token.symbol} not available on ${source}, skipping...`);
    return;
  }
  console.log(`sell amount (Lamports): ${sellAmountLamports}`);
  const sellAmountLamportsNum = sellAmountLamports instanceof BN ? sellAmountLamports.toNumber() : sellAmountLamports;
  const sellDisplay = sellAmountLamportsNum / BASE_TOKEN_LAMPORTS_AMOUNT;
  const profitPercent = ((sellAmountLamportsNum - BASE_TOKEN_LAMPORTS_AMOUNT) / BASE_TOKEN_LAMPORTS_AMOUNT) * 100;

  console.log(`Spent: ${lamportsReceived} Lamports, Received: ${sellAmountLamports} Lamports, Profit: ${profitPercent.toFixed(2)}%`);
  console.log(`${token.symbol} → ${BASE_TOKEN_SYMBOL} (${source}): ${sellAmountLamports} Lamports (≈ ${sellDisplay} ${BASE_TOKEN_SYMBOL})`);

  // Без змін у логіці збереження
  results.push({
    pair: `${BASE_TOKEN_SYMBOL} / ${token.symbol}`,
    buyAmount_lamports: lamportsReceived.toString(),
    tokenAmount_display: tokenDisplay.toString(),
    sellAmount_lamports: sellAmountLamports.toString(),
    sellAmount_display: sellDisplay.toString(),
    profitPercent: profitPercent.toFixed(2),
    source, // ✅ динамічно додаємо назву моделі
  });

}
// === 2️⃣ Функція для напрямку Meteora → Jupiter ===
async function scanReverse(
  token: Token,
  TOKEN_LAMPORTS: number,
  pairAddress: string,
  getMeteoraQuoteFn: (pairAddress: string, amountLamports: number, isReverse: boolean) => Promise<BN | null | undefined>,
  source: string,
  results: ScanResult[]
) {
  // Функція затримки
  function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  await sleep(1200);
  // 1️⃣ Купуємо токен на Meteora
  const meteoraBuy = await getMeteoraQuoteFn(pairAddress, BASE_TOKEN_LAMPORTS_AMOUNT, true);
  if (!meteoraBuy) {
    console.log(`Reverse buy not available for ${token.symbol}`);
    return;
  }
  const tokenAmountFromMeteora = meteoraBuy instanceof BN ? meteoraBuy.toNumber() : Number(meteoraBuy);
  console.log(`Bought on Meteora: ${tokenAmountFromMeteora} units of ${token.symbol}`);

  // 2️⃣ Продаємо токен на Jupiter
  const jupiterSell = await getJupiterQuote(token.mint, BASE_TOKEN_MINT, tokenAmountFromMeteora);
  if (!jupiterSell) {
    console.log(`Reverse sell not available for ${token.symbol}`);
    return;
  }
  const sellAmountReverse = Number(jupiterSell.outAmount);
  const sellDisplayReverse = sellAmountReverse / BASE_TOKEN_LAMPORTS_AMOUNT;
  const profitPercentReverse = ((sellAmountReverse - BASE_TOKEN_LAMPORTS_AMOUNT) / BASE_TOKEN_LAMPORTS_AMOUNT) * 100;

  console.log(`Sold on Jupiter: ${sellAmountReverse} Lamports`);
  console.log(`Profit vs initial: ${profitPercentReverse.toFixed(2)}%`);

  // 3️⃣ Зберігаємо результат
  results.push({
    pair: `${BASE_TOKEN_SYMBOL} / ${token.symbol}`,
    buyAmount_lamports: BASE_TOKEN_LAMPORTS_AMOUNT.toString(),
    tokenAmount_display: (tokenAmountFromMeteora / TOKEN_LAMPORTS).toFixed(6),
    sellAmount_lamports: sellAmountReverse.toString(),
    sellAmount_display: sellDisplayReverse.toFixed(6),
    profitPercent: profitPercentReverse.toFixed(2),
    source: `${source} (Meteora→Jupiter)`
  });
}