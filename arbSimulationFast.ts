import fs from "fs";
import { getJupiterQuote } from "./Api/Jupiter.js";
import { getMeteoraQuoteDAMMV2, getMeteoraPairsDAMMV2 } from "./Api/MeteoraDAMMV2.js";
import {
  BASE_TOKEN_MINT,
  BASE_TOKEN_SYMBOL,
  BASE_AMOUNT,
  BASE_TOKEN_LAMPORTS_AMOUNT,
  BASE_AMOUNT_IN_LAMPORTS
} from "./Config/config.js";
import BN from "bn.js";
import getCommonTokenPairs from "./Functions/getCommonTokenPairs.js";

// ===== ПРАВИЛЬНА БІЗНЕС-ЛОГІКА АРБІТРАЖУ =====

const SIMULATION_DURATION_MS = 2 * 60 * 1000; // 2 хвилини
const MIN_PROFIT_PERCENT = 0.5; // мінімальний профіт після комісій
const ESTIMATED_FEES_PERCENT = 1.5; // Jupiter (~1%) + Meteora (~0.5%)

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
  jupiterPrice: number;
  meteoraPrice: number;
  spreadPercent: number;
  netProfitPercent: number; // після комісій
  estimatedProfit: string;
}

const opportunities: ArbitrageOpportunity[] = [];
let simulationActive = true;
let totalScans = 0;
let priceComparisons = 0;

console.log(`🚀 FAST ARBITRAGE SCANNER`);
console.log(`⚡ Scanning for price differences between Jupiter & Meteora`);
console.log(`💰 Base amount: ${BASE_AMOUNT} ${BASE_TOKEN_SYMBOL}`);
console.log(`📊 Min net profit: ${MIN_PROFIT_PERCENT}% (after ${ESTIMATED_FEES_PERCENT}% fees)\n`);

const startTime = Date.now();
setTimeout(() => {
  simulationActive = false;
  console.log("\n⏱️ Time's up! Generating report...");
}, SIMULATION_DURATION_MS);

// === ГОЛОВНА ФУНКЦІЯ ===
async function runFastScanner() {
  const filteredTokens = await getCommonTokenPairs(getMeteoraPairsDAMMV2, "MeteoraDAMMV2");
  console.log(`\n🔍 Starting fast scan with ${filteredTokens.length} tokens...\n`);

  while (simulationActive) {
    // Створюємо батч запитів для паралельної обробки
    const batchSize = 5; // скільки токенів обробляти одночасно
    
    for (let i = 0; i < filteredTokens.length && simulationActive; i += batchSize) {
      const batch = filteredTokens.slice(i, i + batchSize);
      
      // Паралельно скануємо всі токени в батчі
      await Promise.allSettled(
        batch.map(token => scanTokenFast(token))
      );
      
      totalScans += batch.length;
      
      // Мінімальна затримка між батчами для уникнення rate limit
      await new Promise(r => setTimeout(r, 500));
    }
    
    if (simulationActive) {
      console.log(`🔄 Completed cycle. Scanned ${totalScans} pairs. Found ${opportunities.length} opportunities.\n`);
    }
  }

  generateReport();
}

// === ШВИДКЕ СКАНУВАННЯ ОДНІЄЇ ПАРИ ===
async function scanTokenFast(token: Token) {
  try {
    if (!token.meteoraPairAddress) return;
    
    const TOKEN_LAMPORTS = 10 ** token.decimals;
    
    // 🔥 КЛЮЧОВИЙ МОМЕНТ: Отримуємо ціни ОДНОЧАСНО
    const [jupiterResult, meteoraResult] = await Promise.allSettled([
      // Отримуємо ціну на Jupiter (скільки токенів за BASE_AMOUNT)
      getJupiterQuote(BASE_TOKEN_MINT, token.mint, BASE_AMOUNT_IN_LAMPORTS),
      // Отримуємо ціну на Meteora (скільки SOL за такуж кількість токенів)
      getMeteoraQuoteDAMMV2(token.meteoraPairAddress, BASE_AMOUNT_IN_LAMPORTS, true)
    ]);

    // Перевіряємо чи отримали обидві ціни
    if (jupiterResult.status !== "fulfilled" || !jupiterResult.value?.outAmount) return;
    if (meteoraResult.status !== "fulfilled" || !meteoraResult.value) return;

    const tokensFromJupiter = Number(jupiterResult.value.outAmount);
    const tokensFromMeteora = meteoraResult.value instanceof BN 
      ? meteoraResult.value.toNumber() 
      : Number(meteoraResult.value);

    // Розраховуємо "ціну" 1 токена в SOL lamports
    const jupiterPricePerToken = BASE_AMOUNT_IN_LAMPORTS / tokensFromJupiter; // SOL per token
    const meteoraPricePerToken = BASE_AMOUNT_IN_LAMPORTS / tokensFromMeteora; // SOL per token

    priceComparisons++;

    // === ВАРІАНТ 1: Jupiter дешевше (купуємо там, продаємо на Meteora) ===
    if (jupiterPricePerToken < meteoraPricePerToken) {
      const spreadPercent = ((meteoraPricePerToken - jupiterPricePerToken) / jupiterPricePerToken) * 100;
      const netProfitPercent = spreadPercent - ESTIMATED_FEES_PERCENT;
      
      if (netProfitPercent >= MIN_PROFIT_PERCENT) {
        // Розрахунок: купуємо на Jupiter, продаємо на Meteora
        const meteoraSellResult = await getMeteoraQuoteDAMMV2(
          token.meteoraPairAddress, 
          tokensFromJupiter
        );
        
        if (meteoraSellResult) {
          const sellAmount = meteoraSellResult instanceof BN 
            ? meteoraSellResult.toNumber() 
            : Number(meteoraSellResult);
          const actualProfit = ((sellAmount - BASE_AMOUNT_IN_LAMPORTS) / BASE_AMOUNT_IN_LAMPORTS) * 100;
          
          if (actualProfit >= MIN_PROFIT_PERCENT) {
            recordOpportunity(token, "Jupiter→Meteora", spreadPercent, actualProfit, sellAmount);
          }
        }
      }
    }
    
    // === ВАРІАНТ 2: Meteora дешевше (купуємо там, продаємо на Jupiter) ===
    else if (meteoraPricePerToken < jupiterPricePerToken) {
      const spreadPercent = ((jupiterPricePerToken - meteoraPricePerToken) / meteoraPricePerToken) * 100;
      const netProfitPercent = spreadPercent - ESTIMATED_FEES_PERCENT;
      
      if (netProfitPercent >= MIN_PROFIT_PERCENT) {
        // Розрахунок: купуємо на Meteora, продаємо на Jupiter
        const jupiterSellResult = await getJupiterQuote(
          token.mint, 
          BASE_TOKEN_MINT, 
          tokensFromMeteora
        );
        
        if (jupiterSellResult?.outAmount) {
          const sellAmount = Number(jupiterSellResult.outAmount);
          const actualProfit = ((sellAmount - BASE_AMOUNT_IN_LAMPORTS) / BASE_AMOUNT_IN_LAMPORTS) * 100;
          
          if (actualProfit >= MIN_PROFIT_PERCENT) {
            recordOpportunity(token, "Meteora→Jupiter", spreadPercent, actualProfit, sellAmount);
          }
        }
      }
    }

  } catch (err: any) {
    // Тиха обробка помилок для швидкості
  }
}

// === ЗАПИС ЗНАЙДЕНОЇ МОЖЛИВОСТІ ===
function recordOpportunity(
  token: Token, 
  direction: string, 
  spread: number, 
  netProfit: number,
  sellAmount: number
) {
  const profitAmount = ((sellAmount - BASE_AMOUNT_IN_LAMPORTS) / BASE_TOKEN_LAMPORTS_AMOUNT).toFixed(6);
  
  const opp: ArbitrageOpportunity = {
    timestamp: new Date().toISOString(),
    pair: `${BASE_TOKEN_SYMBOL}/${token.symbol}`,
    direction,
    jupiterPrice: 0, // можна додати деталі
    meteoraPrice: 0,
    spreadPercent: spread,
    netProfitPercent: netProfit,
    estimatedProfit: `${profitAmount} ${BASE_TOKEN_SYMBOL}`
  };
  
  opportunities.push(opp);
  console.log(`✅ [${direction}] ${token.symbol}: Spread ${spread.toFixed(2)}% → Net ${netProfit.toFixed(2)}% (+${profitAmount} ${BASE_TOKEN_SYMBOL})`);
}

// === ГЕНЕРАЦІЯ ЗВІТУ ===
function generateReport() {
  const endTime = Date.now();
  const durationMinutes = (endTime - startTime) / 60000;
  
  console.log("\n" + "=".repeat(70));
  console.log("📊 FAST ARBITRAGE SCAN REPORT");
  console.log("=".repeat(70));
  console.log(`⏱️  Duration: ${durationMinutes.toFixed(2)} minutes`);
  console.log(`🔍 Total scans: ${totalScans}`);
  console.log(`📈 Price comparisons: ${priceComparisons}`);
  console.log(`🎯 Opportunities found: ${opportunities.length}`);
  
  if (opportunities.length === 0) {
    console.log("\n❌ No profitable opportunities found.");
    console.log("\n💡 This is normal because:");
    console.log("   1. DEX prices are very close due to arbitrage bots");
    console.log("   2. Fees (1.5%) eat most small spreads");
    console.log("   3. MEV bots execute in milliseconds, not seconds");
    console.log("   4. You need < 100ms latency to catch real opportunities");
  } else {
    const totalProfit = opportunities.reduce((sum, opp) => 
      sum + parseFloat(opp.estimatedProfit.split(' ')[0]), 0
    );
    const avgProfit = opportunities.reduce((sum, opp) => 
      sum + opp.netProfitPercent, 0) / opportunities.length;
    const maxProfit = Math.max(...opportunities.map(opp => opp.netProfitPercent));
    
    console.log(`💰 Total potential earnings: ${totalProfit.toFixed(6)} ${BASE_TOKEN_SYMBOL}`);
    console.log(`📊 Average net profit: ${avgProfit.toFixed(2)}%`);
    console.log(`🚀 Max net profit: ${maxProfit.toFixed(2)}%`);
    
    // Прогноз
    const earningsPerMinute = totalProfit / durationMinutes;
    console.log("\n💡 EARNINGS PROJECTION:");
    console.log(`   Per minute: ${earningsPerMinute.toFixed(4)} ${BASE_TOKEN_SYMBOL}`);
    console.log(`   Per hour: ${(earningsPerMinute * 60).toFixed(4)} ${BASE_TOKEN_SYMBOL}`);
    console.log(`   Per day: ${(earningsPerMinute * 60 * 24).toFixed(4)} ${BASE_TOKEN_SYMBOL}`);
    
    // Топ-5
    console.log("\n🏆 TOP 5 OPPORTUNITIES:");
    const top5 = [...opportunities]
      .sort((a, b) => b.netProfitPercent - a.netProfitPercent)
      .slice(0, 5);
    
    top5.forEach((opp, i) => {
      console.log(`${i + 1}. ${opp.pair} [${opp.direction}]: ${opp.netProfitPercent.toFixed(2)}% (${opp.estimatedProfit})`);
    });
  }
  
  console.log("=".repeat(70));
  
  // Зберігаємо результати
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").split("Z")[0];
  const reportFile = `./data/results/fast_simulation_${timestamp}.json`;
  
  fs.mkdirSync("./data/results", { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify({
    duration: durationMinutes,
    totalScans,
    priceComparisons,
    opportunities
  }, null, 2));
  
  console.log(`\n💾 Full report saved: ${reportFile}`);
  
  console.log("\n📚 KEY LEARNINGS:");
  console.log("   • Fast scanning (parallel requests) is crucial");
  console.log("   • Compare prices simultaneously, not sequentially");
  console.log("   • Real arbitrage needs < 100ms execution time");
  console.log("   • Professional bots use direct blockchain access");
  console.log("   • Public APIs always have ~1-2 second delay");
}

// Запуск
runFastScanner().catch(console.error);
