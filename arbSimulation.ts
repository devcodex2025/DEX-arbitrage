import fs from "fs";
import { getJupiterQuote } from "./Api/Jupiter.js";
import { getMeteoraQuoteDAMMV2, getMeteoraPairsDAMMV2 } from "./Api/MeteoraDAMMV2.js";
import { getMeteoraQuoteDLMM, getMeteoraPairsDLMM } from "./Api/MeteoraDLMM.js";
import {
  BASE_TOKEN_MINT,
  BASE_TOKEN_SYMBOL,
  BASE_AMOUNT,
  DELAY_MS,
  BASE_TOKEN_LAMPORTS_AMOUNT,
  BASE_AMOUNT_IN_LAMPORTS
} from "./Config/config.js";
import { saveResultsToExcel } from "./utils/saveResultsToExcel.js";
import BN from "bn.js";
import getCommonTokenPairs from "./Functions/getCommonTokenPairs.js";

// ===== Конфігурація симуляції =====
const SIMULATION_DURATION_MS = 1 * 60 * 1000; // 1 хвилина (мінімум для тесту)
const MIN_PROFIT_PERCENT = 0.5; // дуже низький поріг для виявлення будь-яких можливостей

interface Token {
  mint: string;
  symbol: string;
  decimals: number;
  meteoraPairAddress?: string | null;
}

interface ArbitrageOpportunity {
  timestamp: string;
  pair: string;
  direction: string;
  buyPrice: string;
  sellPrice: string;
  profitPercent: number;
  profitAmount: string;
  potentialEarnings: string; // реальний прибуток з BASE_AMOUNT
}

interface SimulationStats {
  startTime: string;
  endTime: string;
  durationMinutes: number;
  totalOpportunities: number;
  avgProfitPercent: number;
  maxProfitPercent: number;
  totalPotentialEarnings: string;
  opportunitiesByDirection: {
    jupiterToMeteora: number;
    meteoraToJupiter: number;
  };
}

const opportunities: ArbitrageOpportunity[] = [];
let simulationActive = true;

console.log(`🎬 Starting arbitrage simulation for ${SIMULATION_DURATION_MS / 60000} minutes...`);
console.log(`💰 Base amount: ${BASE_AMOUNT} ${BASE_TOKEN_SYMBOL}`);
console.log(`📊 Min profit threshold: ${MIN_PROFIT_PERCENT}%\n`);

// Таймер завершення
const startTime = Date.now();
setTimeout(() => {
  simulationActive = false;
  console.log("\n⏱️ Simulation time finished. Generating report...");
}, SIMULATION_DURATION_MS);

// === Головна функція симуляції ===
async function runSimulation() {
  // Отримуємо токени для сканування
  const filteredDAMMV2 = await getCommonTokenPairs(getMeteoraPairsDAMMV2, "MeteoraDAMMV2");
  
  console.log(`\n🔍 Starting scan loop with ${filteredDAMMV2.length} tokens...`);
  
  let scanCount = 0;
  while (simulationActive) {
    for (const token of filteredDAMMV2) {
      if (!simulationActive) {
        console.log(`\n⏸️ Simulation stopped. Scanned ${scanCount} pairs.`);
        break;
      }
      
      scanCount++;
      console.log(`\n[${scanCount}/${filteredDAMMV2.length}] Scanning ${BASE_TOKEN_SYMBOL}/${token.symbol}...`);
      
      try {
        // Сканування Jupiter → Meteora
        await scanDirection(token, "Jupiter→Meteora", async () => {
          return await scanJupiterToMeteora(token);
        });

        // Сканування Meteora → Jupiter
        await scanDirection(token, "Meteora→Jupiter", async () => {
          return await scanMeteoraToJupiter(token);
        });

      } catch (err: any) {
        console.error(`❌ Error scanning ${token.symbol}:`, err.message);
      }
    }
    
    if (simulationActive) {
      console.log(`\n🔄 Completed one cycle. Restarting scan...`);
    }
  }

  // Генеруємо фінальний звіт
  generateReport();
}

// === Сканування Jupiter → Meteora ===
async function scanJupiterToMeteora(token: Token) {
  const pairAddress = token.meteoraPairAddress;
  if (!pairAddress) {
    console.log(`   ⚠️ No pair address for ${token.symbol}`);
    return null;
  }

  // 1. Купуємо токен на Jupiter
  console.log(`   → Buying ${token.symbol} on Jupiter...`);
  const jupiterQuote = await getJupiterQuote(BASE_TOKEN_MINT, token.mint, BASE_AMOUNT_IN_LAMPORTS);
  if (!jupiterQuote?.outAmount) {
    console.log(`   ❌ Jupiter quote failed`);
    return null;
  }
  console.log(`   ✓ Got ${jupiterQuote.outAmount.toString()} ${token.symbol}`);

  const tokensReceived = Number(jupiterQuote.outAmount);
  const TOKEN_LAMPORTS = 10 ** token.decimals;
  
  await new Promise(r => setTimeout(r, DELAY_MS));

  // 2. Продаємо токен на Meteora
  console.log(`   → Selling on Meteora...`);
  const meteoraSell = await getMeteoraQuoteDAMMV2(pairAddress, tokensReceived);
  if (!meteoraSell) {
    console.log(`   ❌ Meteora quote failed`);
    return null;
  }

  const sellAmountLamports = meteoraSell instanceof BN ? meteoraSell.toNumber() : Number(meteoraSell);
  const profitPercent = ((sellAmountLamports - BASE_AMOUNT_IN_LAMPORTS) / BASE_AMOUNT_IN_LAMPORTS) * 100;

  console.log(`   📊 Profit: ${profitPercent.toFixed(2)}%`);
  if (profitPercent < MIN_PROFIT_PERCENT) {
    console.log(`   ⚠️ Below threshold (${MIN_PROFIT_PERCENT}%)`);
    return null;
  }

  return {
    buyPrice: (tokensReceived / TOKEN_LAMPORTS).toFixed(6),
    sellPrice: (sellAmountLamports / BASE_TOKEN_LAMPORTS_AMOUNT).toFixed(6),
    profitPercent,
    profitAmount: ((sellAmountLamports - BASE_AMOUNT_IN_LAMPORTS) / BASE_TOKEN_LAMPORTS_AMOUNT).toFixed(6)
  };
}

// === Сканування Meteora → Jupiter ===
async function scanMeteoraToJupiter(token: Token) {
  const pairAddress = token.meteoraPairAddress;
  if (!pairAddress) return null;

  // 1. Купуємо токен на Meteora
  const meteoraBuy = await getMeteoraQuoteDAMMV2(pairAddress, BASE_AMOUNT_IN_LAMPORTS, true);
  if (!meteoraBuy) return null;

  const tokensReceived = meteoraBuy instanceof BN ? meteoraBuy.toNumber() : Number(meteoraBuy);
  const TOKEN_LAMPORTS = 10 ** token.decimals;
  
  await new Promise(r => setTimeout(r, DELAY_MS));

  // 2. Продаємо токен на Jupiter
  const jupiterSell = await getJupiterQuote(token.mint, BASE_TOKEN_MINT, tokensReceived);
  if (!jupiterSell?.outAmount) return null;

  const sellAmountLamports = Number(jupiterSell.outAmount);
  const profitPercent = ((sellAmountLamports - BASE_AMOUNT_IN_LAMPORTS) / BASE_AMOUNT_IN_LAMPORTS) * 100;

  if (profitPercent < MIN_PROFIT_PERCENT) return null;

  return {
    buyPrice: (tokensReceived / TOKEN_LAMPORTS).toFixed(6),
    sellPrice: (sellAmountLamports / BASE_TOKEN_LAMPORTS_AMOUNT).toFixed(6),
    profitPercent,
    profitAmount: ((sellAmountLamports - BASE_AMOUNT_IN_LAMPORTS) / BASE_TOKEN_LAMPORTS_AMOUNT).toFixed(6)
  };
}

// === Обробка напрямку сканування ===
async function scanDirection(token: Token, direction: string, scanFn: () => Promise<any>) {
  const result = await scanFn();
  if (!result) return;

  const opportunity: ArbitrageOpportunity = {
    timestamp: new Date().toISOString(),
    pair: `${BASE_TOKEN_SYMBOL}/${token.symbol}`,
    direction,
    buyPrice: result.buyPrice,
    sellPrice: result.sellPrice,
    profitPercent: result.profitPercent,
    profitAmount: result.profitAmount,
    potentialEarnings: `${result.profitAmount} ${BASE_TOKEN_SYMBOL}`
  };

  opportunities.push(opportunity);
  
  console.log(`✅ [${direction}] ${token.symbol}: +${result.profitPercent.toFixed(2)}% (${result.profitAmount} ${BASE_TOKEN_SYMBOL})`);
}

// === Генерація звіту ===
function generateReport() {
  const endTime = Date.now();
  const durationMinutes = (endTime - startTime) / 60000;

  if (opportunities.length === 0) {
    console.log("\n❌ No profitable opportunities found during simulation.");
    return;
  }

  const totalProfit = opportunities.reduce((sum, opp) => sum + parseFloat(opp.profitAmount), 0);
  const avgProfit = opportunities.reduce((sum, opp) => sum + opp.profitPercent, 0) / opportunities.length;
  const maxProfit = Math.max(...opportunities.map(opp => opp.profitPercent));

  const jupiterToMeteora = opportunities.filter(o => o.direction === "Jupiter→Meteora").length;
  const meteoraToJupiter = opportunities.filter(o => o.direction === "Meteora→Jupiter").length;

  const stats: SimulationStats = {
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
    durationMinutes: parseFloat(durationMinutes.toFixed(2)),
    totalOpportunities: opportunities.length,
    avgProfitPercent: parseFloat(avgProfit.toFixed(2)),
    maxProfitPercent: parseFloat(maxProfit.toFixed(2)),
    totalPotentialEarnings: `${totalProfit.toFixed(6)} ${BASE_TOKEN_SYMBOL}`,
    opportunitiesByDirection: {
      jupiterToMeteora,
      meteoraToJupiter
    }
  };

  console.log("\n" + "=".repeat(60));
  console.log("📊 SIMULATION REPORT");
  console.log("=".repeat(60));
  console.log(`⏱️  Duration: ${stats.durationMinutes} minutes`);
  console.log(`🎯 Total opportunities: ${stats.totalOpportunities}`);
  console.log(`📈 Average profit: ${stats.avgProfitPercent}%`);
  console.log(`🚀 Max profit: ${stats.maxProfitPercent}%`);
  console.log(`💰 Total potential earnings: ${stats.totalPotentialEarnings}`);
  console.log(`\n📊 By direction:`);
  console.log(`   Jupiter→Meteora: ${jupiterToMeteora} opportunities`);
  console.log(`   Meteora→Jupiter: ${meteoraToJupiter} opportunities`);
  console.log("=".repeat(60));

  // Збереження результатів
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").split("Z")[0];
  const reportFile = `./data/results/simulation_${timestamp}.json`;
  
  fs.mkdirSync("./data/results", { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify({ stats, opportunities }, null, 2));
  
  console.log(`\n💾 Full report saved: ${reportFile}`);

  // Топ-5 найприбутковіших можливостей
  const top5 = [...opportunities]
    .sort((a, b) => b.profitPercent - a.profitPercent)
    .slice(0, 5);

  console.log("\n🏆 TOP 5 OPPORTUNITIES:");
  top5.forEach((opp, i) => {
    console.log(`${i + 1}. ${opp.pair} [${opp.direction}]: ${opp.profitPercent.toFixed(2)}% (${opp.profitAmount} ${BASE_TOKEN_SYMBOL})`);
  });

  // Прогноз заробітку за годину
  const earningsPerMinute = totalProfit / durationMinutes;
  const projectedHourly = earningsPerMinute * 60;
  const projectedDaily = projectedHourly * 24;

  console.log("\n💡 EARNINGS PROJECTION:");
  console.log(`   Per minute: ${earningsPerMinute.toFixed(4)} ${BASE_TOKEN_SYMBOL}`);
  console.log(`   Per hour: ${projectedHourly.toFixed(4)} ${BASE_TOKEN_SYMBOL}`);
  console.log(`   Per day (24h): ${projectedDaily.toFixed(4)} ${BASE_TOKEN_SYMBOL}`);
}

// Запускаємо симуляцію
runSimulation().catch(console.error);
