import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import { getJupiterQuote } from "./Api/Jupiter.js";
import { getMeteoraQuote } from "./Api/Meteora.js";
import { calculateSpreadLamports } from "./Calculations/spreadCalculation.js";
import { BASE_TOKEN_MINT, BASE_TOKEN_SYMBOL, BASE_AMOUNT, DELAY_MS, TOKENS_FILE, RESULTS_FOLDER, BASE_TOKEN_LAMPORTS } from "./Config/config.js";


// Конвертуємо BASE_AMOUNT у Lamports
const BASE_AMOUNT_LAMPORTS = Math.floor(BASE_AMOUNT * 10 ** BASE_TOKEN_LAMPORTS);

// Завантажуємо токени з файлу, виключаючи базовий токен
let tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"))
  .filter(t => t.mint !== BASE_TOKEN_MINT);


// ======= ГОЛОВНА ФУНКЦІЯ =======
async function scanArb() {
  const results = [];

  for (const token of tokens) {
    console.log(`\n--- Scanning ${BASE_TOKEN_SYMBOL} / ${token.symbol} ---`);

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
    const sellAmountLamports = await getMeteoraQuote(token.mint, tokenAmountJupiter);
    if (!sellAmountLamports) {
      console.log(`Price for ${token.symbol} not available on Meteora, skipping...`);
      continue;
    }

    const sellDisplay = Number(sellAmountLamports) / TOKEN_LAMPORTS;
    const profitPercent = calculateSpreadLamports(BASE_AMOUNT_LAMPORTS, sellAmountLamports);

    console.log(
      `${token.symbol} → ${BASE_TOKEN_SYMBOL} (Meteora): ${sellAmountLamports} Lamports (≈ ${sellDisplay} ${BASE_TOKEN_SYMBOL})`
    );
    console.log(`Profit/Spread: ${profitPercent.toFixed(2)} %`);

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

  // Збереження в Excel
  if (!fs.existsSync(RESULTS_FOLDER)) fs.mkdirSync(RESULTS_FOLDER);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(results);
  XLSX.utils.book_append_sheet(wb, ws, "ArbScan");
  const filePath = path.join(RESULTS_FOLDER, "Tokens_spread.xlsx");
  XLSX.writeFile(wb, filePath);
  console.log("\n✅ Results saved to Tokens_spread.xlsx");
}

scanArb();
