import { BASE_TOKEN_SYMBOL, BASE_TOKEN_MINT, BASE_TOKEN_LAMPORTS_AMOUNT, DELAY_MS } from "../Config/config";
import { getJupiterQuote } from "../Api/Jupiter";

interface Token {
  mint: string;
  symbol: string;
  decimals: number;
  meteoraPairAddress?: string | null;
}

interface ScanResult {
  pair: string;               // "SOL / BONK"
  buyAmount_lamports: string; // витрачені Lamports на покупку
  tokenAmount_display: string;// токен у зручному форматі
  sellAmount_lamports: string; // отримані Lamports після продажу
  sellAmount_display: string;  // відображення проданого токена у базовій валюті
  profitPercent: string;       // прибуток у %
  source: string;              // "MeteoraDAMMV2", "MeteoraDLMM", ...
}


export default async function scanTokenPairs({
  tokens,
  getMeteoraQuoteFn,
  source,
  results,
}: {
  tokens: Token[];
  getMeteoraQuoteFn: (pairAddress: string, amountLamports: number) => Promise<number | null | undefined>;
  source: string; // ✅ універсальне значення
  results: ScanResult[]; // масив, куди будемо додавати записи
}) {
  for (const token of tokens) {
    console.log(`\n--- Scanning ${BASE_TOKEN_SYMBOL} / ${token.symbol} (${source}) ---`);
    console.log(`Base token mint: ${BASE_TOKEN_MINT}, Token mint: ${token.mint}, Base amount (Lamports): ${BASE_TOKEN_LAMPORTS_AMOUNT}`);

    // Jupiter quote
    const jupiterQuote = await getJupiterQuote(BASE_TOKEN_MINT, token.mint, BASE_TOKEN_LAMPORTS_AMOUNT);
    if (!jupiterQuote.outAmount) {
      console.log(`Failed to buy ${token.symbol} on Jupiter.`);
      continue;
    }

    const TOKEN_LAMPORTS = 10 ** token.decimals;
    const tokenAmountJupiter = Number(jupiterQuote.outAmount);
    const tokenDisplay = tokenAmountJupiter / TOKEN_LAMPORTS;

    console.log(`${BASE_TOKEN_SYMBOL} → ${token.symbol} (Jupiter): ${tokenAmountJupiter} Lamports (≈ ${tokenDisplay} ${token.symbol})`);

    await new Promise(r => setTimeout(r, DELAY_MS));

    const pairAddress = token.meteoraPairAddress;
    if (!pairAddress) {
      console.log(`No ${source} pair for ${token.symbol}, skipping...`);
      continue;
    }

    // Зворотний свап через вказану модель
    const sellAmountLamports = await getMeteoraQuoteFn(pairAddress, tokenAmountJupiter);
    if (!sellAmountLamports) {
      console.log(`Price for ${token.symbol} not available on ${source}, skipping...`);
      continue;
    }

    const sellDisplay = sellAmountLamports / BASE_TOKEN_LAMPORTS_AMOUNT;
    const profitPercent = ((sellAmountLamports - BASE_TOKEN_LAMPORTS_AMOUNT) / BASE_TOKEN_LAMPORTS_AMOUNT) * 100;

    console.log(`Spent: ${tokenAmountJupiter} Lamports, Received: ${sellAmountLamports} Lamports, Profit: ${profitPercent.toFixed(2)}%`);
    console.log(`${token.symbol} → ${BASE_TOKEN_SYMBOL} (${source}): ${sellAmountLamports} Lamports (≈ ${sellDisplay} ${BASE_TOKEN_SYMBOL})`);

    // Без змін у логіці збереження
    results.push({
      pair: `${BASE_TOKEN_SYMBOL} / ${token.symbol}`,
      buyAmount_lamports: tokenAmountJupiter.toString(),
      tokenAmount_display: tokenDisplay.toString(),
      sellAmount_lamports: sellAmountLamports.toString(),
      sellAmount_display: sellDisplay.toString(),
      profitPercent: profitPercent.toFixed(2),
      source, // ✅ динамічно додаємо назву моделі
    });
  }
}