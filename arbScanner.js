import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import { getJupiterQuote } from "./Api/Jupiter.js";
import { getMeteoraQuote, getMeteoraPairs } from "./Api/Meteora.js";
import { calculateSpreadLamports } from "./Calculations/spreadCalculation.js";
import { BASE_TOKEN_MINT, BASE_TOKEN_SYMBOL, BASE_AMOUNT, DELAY_MS, TOKENS_FILE, RESULTS_FOLDER, BASE_TOKEN_LAMPORTS } from "./Config/config.js";
import { saveResultsToExcel } from "./utils/saveResultsToExcel.js";

// Конвертуємо BASE_AMOUNT у Lamports
const BASE_AMOUNT_LAMPORTS = BASE_AMOUNT * BASE_TOKEN_LAMPORTS;

// Завантажуємо токени з файлу, виключаючи базовий токен
let allTokens = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"))
  .filter(t => t.mint !== BASE_TOKEN_MINT);

// ====== ОТРИМАННЯ СПІЛЬНИХ ТОКЕНІВ ======
async function getCommonTokens() {
  console.log("Fetching available Meteora pairs...");
  const meteoraMints = await getMeteoraPairs(BASE_TOKEN_MINT);

  if (!meteoraMints || meteoraMints.length === 0) {
    console.log("⚠️ No Meteora pairs found — scanning all tokens instead...");
    return allTokens;
  }

  const filtered = allTokens.filter(t => meteoraMints.includes(t.mint));
  console.log(`✅ Found ${filtered.length} common tokens on Jupiter & Meteora.`);
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

    // Розрахунок зворотного свапу через Meteora
    const sellAmountLamports = await getMeteoraQuote(token.mint, tokenAmountJupiter, token.decimals);
    console.log(`sellAmountLamports: ${sellAmountLamports}`);
    if (!sellAmountLamports) {
      console.log(`Price for ${token.symbol} not available on Meteora, skipping...`);
      continue;
    }

    const sellDisplay = Number(sellAmountLamports) / BASE_TOKEN_LAMPORTS;
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
      sellAmount_lamports: sellAmountLamports?.toString()
    });


    results.push({
      pair: `${BASE_TOKEN_SYMBOL} / ${token.symbol}`,
      buyAmount_lamports: tokenAmountJupiter.toString(),
      tokenAmount_display: tokenDisplay.toString(),
      sellAmount_lamports: sellAmountLamports.toString(),
      sellAmount_display: sellDisplay.toString(),
      profitPercent: profitPercent.toFixed(2),
      source: "Meteora",
    });
  }

  saveResultsToExcel(results, RESULTS_FOLDER);
}

scanArb();
