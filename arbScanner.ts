import fs from "fs";
import { getJupiterQuote } from "./Api/Jupiter.js";
import { getMeteoraQuote, getMeteoraPairs } from "./Api/Meteora.js";
import {
  BASE_TOKEN_MINT,
  BASE_TOKEN_SYMBOL,
  BASE_AMOUNT,
  DELAY_MS,
  TOKENS_FILE,
  RESULTS_FOLDER,
  BASE_TOKEN_LAMPORTS_AMOUNT
} from "./Config/config.js";
import { saveResultsToExcel } from "./utils/saveResultsToExcel.js";

if (!BASE_TOKEN_MINT) {
  throw new Error("❌ BASE_TOKEN_MINT is not defined in .env or config.js");
}

// ===== Типи =====
interface Token {
  mint: string;
  symbol: string;
  decimals: number;
  meteoraPairAddress?: string | null;
}

interface MeteoraPairInfo {
  address: string;
  reserve_y_amount: number;
}

interface ResultRow {
  pair: string;
  buyAmount_lamports: string;
  tokenAmount_display: string;
  sellAmount_lamports: string;
  sellAmount_display: string;
  profitPercent: string;
  source: string;
}

// Конвертуємо BASE_AMOUNT у Lamports
const BASE_AMOUNT_LAMPORTS = BASE_AMOUNT * BASE_TOKEN_LAMPORTS_AMOUNT;

// Завантажуємо токени з файлу, виключаючи базовий токен
const allTokens: Token[] = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8")).filter(
  (t: Token) => t.mint !== BASE_TOKEN_MINT
);

// ====== ОТРИМАННЯ СПІЛЬНИХ ТОКЕНІВ ======
async function getCommonTokens(): Promise<Token[]> {
  console.log("Fetching available Meteora pairs...");
  const meteoraPairs: Record<string, MeteoraPairInfo> = await getMeteoraPairs(BASE_TOKEN_MINT || "");

  if (!meteoraPairs || Object.keys(meteoraPairs).length === 0) {
    console.log("⚠️ No Meteora pairs found — scanning all tokens instead...");
    return allTokens.map(t => ({ ...t, meteoraPairAddress: null })); // якщо пар немає
  }

  // залишаємо тільки токени, що є в об’єкті meteoraPairs і підв’язуємо адресу пари
  const filtered = allTokens
    .filter(t => {
      const pairInfo = meteoraPairs[t.mint]
      return !!pairInfo;
      // Фільтр по ліквідності: reserve_y_amount >= BASE_AMOUNT_LAMPORTS і достатня ліквідність
      //return pairInfo.reserve_y_amount >= BASE_AMOUNT_LAMPORTS;
    })
    .map(t => ({
      ...t,
      meteoraPairAddress: meteoraPairs[t.mint].address // підв’язуємо адресу пари
    }));

  console.log(`✅ Found ${filtered.length} common & liquid tokens on Jupiter & Meteora.`);
  return filtered;
}

// ======= ГОЛОВНА ФУНКЦІЯ =======
async function scanArb() {
  const results = [];
  const tokens = await getCommonTokens();

  for (const token of tokens) {
    console.log(`\n--- Scanning ${BASE_TOKEN_SYMBOL} / ${token.symbol} ---`);
    console.log(`Base token mint: ${BASE_TOKEN_MINT}, Token mint: ${token.mint}, Base amount (Lamports): ${BASE_AMOUNT_LAMPORTS}`);
    // Jupiter quote у Lamports
    const jupiterQuote = await getJupiterQuote(BASE_TOKEN_MINT, token.mint, BASE_AMOUNT_LAMPORTS);
    if (!jupiterQuote.outAmount) {
      console.log(`Failed to buy ${token.symbol} on Jupiter.`);
      continue;
    }
    const TOKEN_LAMPORTS = 10 ** token.decimals;
    const tokenAmountJupiter = jupiterQuote.outAmount;
    const tokenDisplay = Number(tokenAmountJupiter) / TOKEN_LAMPORTS;

    console.log(
      `${BASE_TOKEN_SYMBOL} → ${token.symbol} (Jupiter): ${tokenAmountJupiter} Lamports (≈ ${tokenDisplay} ${token.symbol})`
    );

    await new Promise(r => setTimeout(r, DELAY_MS));
    const pairAddress = token.meteoraPairAddress;
    if (!pairAddress) {
      console.log(`No Meteora pair for ${token.symbol}, skipping...`);
      continue;
    }
    // Розрахунок зворотного свапу через Meteora
    const sellAmountLamports: number | null | undefined  = await getMeteoraQuote(pairAddress, BASE_TOKEN_LAMPORTS_AMOUNT);
    console.log(`sellAmountLamports: ${sellAmountLamports}`);
    //break;
    if (!sellAmountLamports) {
      console.log(`Price for ${token.symbol} not available on Meteora, skipping...`);
      continue;
    }

    const sellDisplay = Number(sellAmountLamports) / BASE_TOKEN_LAMPORTS_AMOUNT;
    // Скільки Lamports витрачено на купівлю токена
    const lamportsSpent = BASE_AMOUNT_LAMPORTS;

    // Скільки Lamports базового токена отримали після зворотного свапу
    const lamportsReceived = sellAmountLamports;

    // Розрахунок прибутку/спреду у %
    const profitPercent = ((lamportsReceived - lamportsSpent) / lamportsSpent) * 100;

    console.log(`Spent: ${lamportsSpent} Lamports, Received: ${lamportsReceived} Lamports, Profit: ${profitPercent.toFixed(2)}%`);

    console.log(
      `${token.symbol} → ${BASE_TOKEN_SYMBOL} (Meteora): ${sellAmountLamports} Lamports (≈ ${sellDisplay} ${BASE_TOKEN_SYMBOL})`
    );
    console.log(`Profit/Spread: ${profitPercent} %`);

    console.log("Appending result:", {
      pair: `${BASE_TOKEN_SYMBOL} / ${token.symbol}`,
      buyAmount_lamports: tokenAmountJupiter.toString(),
      sellAmount_lamports: (sellAmountLamports as number | null)?.toString() ?? null,
    });


    results.push({
      pair: `${BASE_TOKEN_SYMBOL} / ${token.symbol}`,
      buyAmount_lamports: tokenAmountJupiter.toString(),
      tokenAmount_display: tokenDisplay.toString(),
      sellAmount_lamports: (sellAmountLamports as number | null)?.toString() ?? null,
      sellAmount_display: sellDisplay.toString(),
      profitPercent: profitPercent.toFixed(2),
      source: "Meteora",
    });
  }

  saveResultsToExcel(results, RESULTS_FOLDER);
}

scanArb();
