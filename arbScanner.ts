import fs from "fs";
import { getJupiterQuote } from "./Api/Jupiter.js";
import { getMeteoraQuoteDAMMV2, getMeteoraPairsDAMMV2 } from "./Api/MeteoraDAMMV2.js";
import { getMeteoraQuoteDLMM, getMeteoraPairsDLMM } from "./Api/MeteoraDLMM.js";
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
import BN from "bn.js";
import { get } from "http";
import scanTokenPairs from "./Functions/scanTokenPairs.js";
import getCommonTokenPairs from "./Functions/getCommonTokenPairs.js";

if (!BASE_TOKEN_MINT) {
  throw new Error("❌ BASE_TOKEN_MINT is not defined in .env or config.js");
}

// ===== Типи =====

interface ScanResult {
  pair: string;               // "SOL / BONK"
  buyAmount_lamports: string; // витрачені Lamports на покупку
  tokenAmount_display: string;// токен у зручному форматі
  sellAmount_lamports: string; // отримані Lamports після продажу
  sellAmount_display: string;  // відображення проданого токена у базовій валюті
  profitPercent: string;       // прибуток у %
  source: string;              // "MeteoraDAMMV2", "MeteoraDLMM", ...
}

// Конвертуємо BASE_AMOUNT у Lamports
const BASE_AMOUNT_LAMPORTS = BASE_AMOUNT * BASE_TOKEN_LAMPORTS_AMOUNT;

// 1️⃣ Отримуємо токени для DAMMV2
// const filteredDAMMV2 = await getCommonTokenPairs(getMeteoraPairsDAMMV2, "MeteoraDAMMV2");

// 2️⃣ Отримуємо токени для DLMM
const filteredDLMM = await getCommonTokenPairs(getMeteoraPairsDLMM, "MeteoraDLMM");


const results: ScanResult[] = []; // Глобальний масив для всіх моделей
// 🔹 Скануємо DAMMV2
// await scanTokenPairs({
//   tokens: filteredDAMMV2,
//   getMeteoraQuoteFn: getMeteoraQuoteDAMMV2,
//   source: "MeteoraDAMMV2",
//   results
// });

// 🔹 Скануємо DLMM
await scanTokenPairs({
  tokens: filteredDLMM,
  getMeteoraQuoteFn: getMeteoraQuoteDLMM,
  source: "MeteoraDLMM",
  results
});

// 🔹 Після всіх сканувань — зберігаємо результати
saveResultsToExcel(results, RESULTS_FOLDER);
console.log(`✅ All results saved to Excel in folder: ${RESULTS_FOLDER}`);
