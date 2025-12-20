import fs from "fs";
import { Connection, Keypair, VersionedTransaction, PublicKey, SystemProgram, TransactionMessage, TransactionInstruction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getJupiterQuote } from "./Api/Jupiter.js";
import { getMeteoraQuoteDAMMV2, getMeteoraPairsDAMMV2 } from "./Api/MeteoraDAMMV2.js";
import { getMeteoraDLMMPairs, getMeteoraDLMMQuote } from "./Api/MeteoraDLMM.js";
import {
  BASE_TOKEN_MINT,
  BASE_TOKEN_SYMBOL,
  BASE_AMOUNT,
  BASE_TOKEN_LAMPORTS_AMOUNT,
  BASE_AMOUNT_IN_LAMPORTS,
  RPC_ENDPOINT,
  PRIVATE_KEY,
  DRY_RUN,
  MIN_PROFIT_PERCENT,
  ESTIMATED_FEES,
  MAX_CONCURRENT_SCANS,
  PRICE_CACHE_MS
} from "./Config/config.js";
import BN from "bn.js";
import getCommonTokenPairs from "./Functions/getCommonTokenPairs.js";
import bs58 from "bs58";

interface Token {
  mint: string;
  symbol: string;
  decimals: number;
  meteoraPairAddress?: string | null;
}

interface ArbitrageOpportunity {
  token: Token;
  direction: 'JUP_TO_MET' | 'MET_TO_JUP';
  profitPercent: number;
  profitSOL: number;
  jupiterAmount: number;
  meteoraAmount: number;
}

/**
 * AGGRESSIVE ARBITRAGE BOT
 * - Скануємо ВСІЙ пули: Meteora DAMM V2 + DLMM
 * - Більше токенів = більше можливостей
 * - Паралельна обробка токенів для швидкості
 * - Менший поріг прибутку (0.3% net)
 */
class AggressiveArbitrageBot {
  private connection: Connection;
  private wallet: Keypair | null = null;
  private stats = {
    scansCompleted: 0,
    opportunitiesFound: 0,
    tradesExecuted: 0,
    totalProfit: 0,
    errors: 0
  };
  private priceCache = new Map<string, { price: any, timestamp: number }>();
  private allTokens: Token[] = [];

  constructor() {
    this.connection = new Connection(RPC_ENDPOINT, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000
    });
    
    this.loadWallet();
  }

  private loadWallet() {
    try {
      if (PRIVATE_KEY) {
        const privateKeyBytes = bs58.decode(PRIVATE_KEY);
        this.wallet = Keypair.fromSecretKey(privateKeyBytes);
        console.log(`[OK] Wallet loaded: ${this.wallet.publicKey.toString()}`);
      } else {
        console.log("[WARNING] PRIVATE_KEY not found - simulation mode only");
      }
    } catch (err) {
      console.error("[ERROR] Failed to load wallet:", err);
    }
  }

  private getCachedPrice(key: string): any | null {
    const cached = this.priceCache.get(key);
    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_MS) {
      return cached.price;
    }
    return null;
  }

  private setCachedPrice(key: string, price: any) {
    this.priceCache.set(key, { price, timestamp: Date.now() });
  }

  async start() {
    console.log(`>>> AGGRESSIVE ARBITRAGE BOT`);
    console.log("=".repeat(60));
    console.log(`[MODE] ${DRY_RUN ? "SIMULATION (DRY RUN)" : "LIVE TRADING [WARNING]"}`);
    console.log(`[AMOUNT] Base: ${BASE_AMOUNT} ${BASE_TOKEN_SYMBOL}`);
    console.log(`[PROFIT] Min threshold: ${MIN_PROFIT_PERCENT}% NET (after ${ESTIMATED_FEES}% fees)`);
    console.log(`[PARALLEL] Concurrent scans: ${MAX_CONCURRENT_SCANS}`);
    console.log(`[STRATEGY] Multi-pool (DAMM V2 + DLMM)`);
    console.log(`[RPC] ${RPC_ENDPOINT.substring(0, 50)}...`);
    console.log("=".repeat(60) + "\n");

    // Завантажуємо токени з ОБОХ типів Meteora пулів
    await this.loadAllTokens();
    
    console.log(`\n[SCAN] Starting aggressive scan with ${this.allTokens.length} tokens...\n`);

    // Безкінечний цикл швидкого сканування
    while (true) {
      const startTime = Date.now();
      
      // Обробляємо токени ПАРАЛЕЛЬНО пакетами
      await this.scanBatch(this.allTokens);

      const cycleTime = Date.now() - startTime;
      this.printStats(cycleTime);
      
      // Короткий відпочинок перед новим циклом
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Завантажуємо токени з ВСІХ джерел
  private async loadAllTokens() {
    console.log("Loading tokens from multiple sources...");
    
    // DAMM V2 токени
    const dammTokens = await getCommonTokenPairs(getMeteoraPairsDAMMV2, "MeteoraDAMMV2");
    console.log(`✅ DAMM V2: ${dammTokens.length} tokens`);
    
    // DLMM токени
    const dlmmTokens = await getCommonTokenPairs(getMeteoraDLMMPairs, "MeteoraDLMM");
    console.log(`✅ DLMM: ${dlmmTokens.length} tokens`);
    
    // Об'єднуємо і видаляємо дублікати
    const allTokensMap = new Map<string, Token>();
    
    for (const token of [...dammTokens, ...dlmmTokens]) {
      if (!allTokensMap.has(token.mint)) {
        allTokensMap.set(token.mint, token);
      }
    }
    
    this.allTokens = Array.from(allTokensMap.values());
    console.log(`✅ TOTAL UNIQUE: ${this.allTokens.length} tokens\n`);
  }

  // Сканування пакета токенів паралельно
  private async scanBatch(tokens: Token[]) {
    // Розбиваємо на пакети по MAX_CONCURRENT_SCANS
    for (let i = 0; i < tokens.length; i += MAX_CONCURRENT_SCANS) {
      const batch = tokens.slice(i, i + MAX_CONCURRENT_SCANS);
      
      // Обробляємо пакет паралельно
      const promises = batch.map(token => this.scanToken(token));
      await Promise.allSettled(promises);
      
      // Коротка пауза між пакетами
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Сканування одного токена
  private async scanToken(token: Token): Promise<void> {
    try {
      this.stats.scansCompleted++;
      
      if (!token.meteoraPairAddress) return;
      
      const TOKEN_LAMPORTS = 10 ** token.decimals;
      
      // Паралельно отримуємо ціни
      const [jupBuyAmount, metBuyAmount] = await Promise.all([
        this.getJupiterBuyAmount(token.mint, BASE_AMOUNT_IN_LAMPORTS),
        this.getMeteoraBuyAmount(token.meteoraPairAddress, BASE_AMOUNT_IN_LAMPORTS)
      ]);
      
      if (!jupBuyAmount || !metBuyAmount) return;
      
      // Перевірка на нормальність даних
      const ratio = Math.max(jupBuyAmount, metBuyAmount) / Math.min(jupBuyAmount, metBuyAmount);
      if (ratio > 50) return; // Погана ліквідність
      
      // Аналізуємо обидва напрямки
      const opportunity = await this.findBestOpportunity(token, jupBuyAmount, metBuyAmount);
      
      if (opportunity) {
        this.stats.opportunitiesFound++;
        console.log(`\n💰 [OPPORTUNITY FOUND!]`);
        console.log(`   Token: ${token.symbol}`);
        console.log(`   Direction: ${opportunity.direction}`);
        console.log(`   Profit: ${opportunity.profitPercent.toFixed(2)}% (${opportunity.profitSOL.toFixed(6)} SOL)`);
        console.log(`   Jupiter: ${(opportunity.jupiterAmount / TOKEN_LAMPORTS).toFixed(4)} ${token.symbol}`);
        console.log(`   Meteora: ${(opportunity.meteoraAmount / TOKEN_LAMPORTS).toFixed(4)} ${token.symbol}`);
        
        // Тут можна додати логіку виконання угоди
        // if (!DRY_RUN) { await this.executeTrade(opportunity); }
      }
      
    } catch (err) {
      this.stats.errors++;
    }
  }

  // Знаходимо найкращу можливість
  private async findBestOpportunity(
    token: Token,
    jupBuyAmount: number,
    metBuyAmount: number
  ): Promise<ArbitrageOpportunity | null> {
    const TOKEN_LAMPORTS = 10 ** token.decimals;
    
    // Напрямок 1: Jupiter -> Meteora (купуємо на Jup, продаємо на Met)
    const metSellAmount1 = await this.getMeteoraSellAmount(token.meteoraPairAddress!, jupBuyAmount);
    let profit1 = 0;
    let profitPercent1 = 0;
    
    if (metSellAmount1) {
      profit1 = (metSellAmount1 - BASE_AMOUNT_IN_LAMPORTS) / LAMPORTS_PER_SOL;
      profitPercent1 = ((metSellAmount1 / BASE_AMOUNT_IN_LAMPORTS) - 1) * 100;
    }
    
    // Напрямок 2: Meteora -> Jupiter (купуємо на Met, продаємо на Jup)
    const jupSellAmount2 = await this.getJupiterSellAmount(token.mint, metBuyAmount);
    let profit2 = 0;
    let profitPercent2 = 0;
    
    if (jupSellAmount2) {
      profit2 = (jupSellAmount2 - BASE_AMOUNT_IN_LAMPORTS) / LAMPORTS_PER_SOL;
      profitPercent2 = ((jupSellAmount2 / BASE_AMOUNT_IN_LAMPORTS) - 1) * 100;
    }
    
    // Віднімаємо комісії
    const netProfit1 = profitPercent1 - ESTIMATED_FEES;
    const netProfit2 = profitPercent2 - ESTIMATED_FEES;
    
    // Вибираємо найкращий напрямок
    if (netProfit1 >= MIN_PROFIT_PERCENT && netProfit1 > netProfit2) {
      return {
        token,
        direction: 'JUP_TO_MET',
        profitPercent: netProfit1,
        profitSOL: profit1,
        jupiterAmount: jupBuyAmount,
        meteoraAmount: metSellAmount1!
      };
    }
    
    if (netProfit2 >= MIN_PROFIT_PERCENT && netProfit2 > netProfit1) {
      return {
        token,
        direction: 'MET_TO_JUP',
        profitPercent: netProfit2,
        profitSOL: profit2,
        jupiterAmount: jupSellAmount2!,
        meteoraAmount: metBuyAmount
      };
    }
    
    return null;
  }

  // API методи
  private async getJupiterBuyAmount(tokenMint: string, solAmount: number): Promise<number | null> {
    try {
      const quote = await getJupiterQuote(BASE_TOKEN_MINT, tokenMint, solAmount);
      return quote?.outAmount ? Number(quote.outAmount) : null;
    } catch {
      return null;
    }
  }
  
  private async getJupiterSellAmount(tokenMint: string, tokenAmount: number): Promise<number | null> {
    try {
      const quote = await getJupiterQuote(tokenMint, BASE_TOKEN_MINT, tokenAmount);
      return quote?.outAmount ? Number(quote.outAmount) : null;
    } catch {
      return null;
    }
  }
  
  private async getMeteoraBuyAmount(pairAddress: string, solAmount: number): Promise<number | null> {
    try {
      // Спробуємо DLMM спочатку
      const dlmmQuote = await getMeteoraDLMMQuote(pairAddress, solAmount, true);
      if (dlmmQuote?.outAmount) {
        return Number(dlmmQuote.outAmount);
      }
      
      // Якщо не вийшло - пробуємо DAMM V2
      const dammQuote = await getMeteoraQuoteDAMMV2(pairAddress, solAmount, true);
      return dammQuote?.outAmount ? Number(dammQuote.outAmount) : null;
    } catch {
      return null;
    }
  }
  
  private async getMeteoraSellAmount(pairAddress: string, tokenAmount: number): Promise<number | null> {
    try {
      // Спробуємо DLMM
      const dlmmQuote = await getMeteoraDLMMQuote(pairAddress, tokenAmount, false);
      if (dlmmQuote?.outAmount) {
        return Number(dlmmQuote.outAmount);
      }
      
      // DAMM V2
      const dammQuote = await getMeteoraQuoteDAMMV2(pairAddress, tokenAmount, false);
      return dammQuote?.outAmount ? Number(dammQuote.outAmount) : null;
    } catch {
      return null;
    }
  }

  private printStats(cycleTime: number) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[STATS] Cycle time: ${(cycleTime / 1000).toFixed(1)}s`);
    console.log(`   Scans: ${this.stats.scansCompleted} | Opportunities: ${this.stats.opportunitiesFound}`);
    console.log(`   Trades: ${this.stats.tradesExecuted} | Total profit: ${this.stats.totalProfit.toFixed(4)} SOL`);
    console.log(`   Errors: ${this.stats.errors}`);
    console.log(`${"=".repeat(60)}\n`);
  }
}

// Запуск бота
const bot = new AggressiveArbitrageBot();
bot.start().catch(console.error);
