import fs from "fs";
import { Connection, Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js";
import { getJupiterQuote } from "./Api/Jupiter.js";
import { getMeteoraQuoteDAMMV2, getMeteoraPairsDAMMV2 } from "./Api/MeteoraDAMMV2.js";
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

// Jito Block Engine URLs (найшвидші endpoints)
const JITO_ENDPOINTS = [
  "https://mainnet.block-engine.jito.wtf",
  "https://amsterdam.mainnet.block-engine.jito.wtf",
  "https://frankfurt.mainnet.block-engine.jito.wtf",
  "https://ny.mainnet.block-engine.jito.wtf",
  "https://tokyo.mainnet.block-engine.jito.wtf"
];

interface Token {
  mint: string;
  symbol: string;
  decimals: number;
  meteoraPairAddress?: string | null;
}

interface ArbitrageResult {
  success: boolean;
  pair: string;
  direction: string;
  profitPercent: number;
  profitAmount: string;
  signature?: string;
  error?: string;
}

class OptimizedArbitrageBot {
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

  constructor() {
    this.connection = new Connection(RPC_ENDPOINT, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000
    });
    
    // Завантажуємо гаманець завжди (для готовності), але виконуємо транзакції тільки якщо DRY_RUN=false
    this.loadWallet();
  }

  private loadWallet() {
    try {
      // Спробуємо завантажити wallet з .env
      if (PRIVATE_KEY) {
        const privateKeyBytes = bs58.decode(PRIVATE_KEY);
        this.wallet = Keypair.fromSecretKey(privateKeyBytes);
        console.log(`[OK] Wallet loaded: ${this.wallet.publicKey.toString()}`);
      } else {
        console.log("[WARNING] PRIVATE_KEY not found in .env - running in simulation mode");
        console.log("[INFO] Add PRIVATE_KEY=your_base58_private_key to .env for real trading");
      }
    } catch (err) {
      console.error("[ERROR] Failed to load wallet:", err);
    }
  }

  // Кешування цін для зменшення API запитів
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

  // Швидке паралельне сканування
  async start() {
    console.log(`>>> OPTIMIZED ARBITRAGE BOT`);
    console.log("=".repeat(60));
    console.log(`[MODE] ${DRY_RUN ? "SIMULATION (DRY RUN)" : "LIVE TRADING [WARNING]"}`);
    console.log(`[AMOUNT] Base: ${BASE_AMOUNT} ${BASE_TOKEN_SYMBOL}`);
    console.log(`[PROFIT] Min threshold: ${MIN_PROFIT_PERCENT}% (after ${ESTIMATED_FEES}% fees)`);
    console.log(`[PARALLEL] Concurrent scans: ${MAX_CONCURRENT_SCANS}`);
    console.log(`[RPC] ${RPC_ENDPOINT.substring(0, 50)}...`);
    console.log("=".repeat(60) + "\n");

    if (!DRY_RUN && !this.wallet) {
      console.log("[ERROR] Cannot run in LIVE mode without wallet!");
      return;
    }

    const tokens = await getCommonTokenPairs(getMeteoraPairsDAMMV2, "MeteoraDAMMV2");
    console.log(`\n[SCAN] Starting continuous scan with ${tokens.length} tokens...\n`);

    // Безкінечний цикл сканування
    while (true) {
      const startTime = Date.now();
      
      // Обробляємо токени ПОСЛІДОВНО (один за раз)
      for (const token of tokens) {
        await this.scanAndExecute(token);
      }

      const cycleTime = Date.now() - startTime;
      this.printStats(cycleTime);
      
      // Короткий відпочинок між циклами
      await new Promise(r => setTimeout(r, 5000)); // Збільшено до 5 секунд
    }
  }

  // Сканування та виконання арбітражу для одного токена
  private async scanAndExecute(token: Token): Promise<ArbitrageResult | null> {
    try {
      this.stats.scansCompleted++;

      if (!token.meteoraPairAddress) return null;

      const TOKEN_LAMPORTS = 10 ** token.decimals;

      // Отримуємо ціни ПОСЛІДОВНО з затримкою для rate limiting (max 1 req/sec)
      const jupiterBuyResult = await this.getJupiterPrice(token.mint, BASE_AMOUNT_IN_LAMPORTS);
      await new Promise(r => setTimeout(r, 1000)); // 1000ms затримка = 1 req/sec
      
      const meteoraBuyResult = await this.getMeteoraPrice(token.meteoraPairAddress, BASE_AMOUNT_IN_LAMPORTS, true);
      await new Promise(r => setTimeout(r, 1000)); // Затримка перед наступним запитом

      if (!jupiterBuyResult) return null;
      if (!meteoraBuyResult) return null;

      const tokensFromJupiter = jupiterBuyResult;
      const tokensFromMeteora = meteoraBuyResult;

      // Аналізуємо який напрямок вигідніший
      const opportunity = await this.analyzeArbitrage(
        token,
        tokensFromJupiter,
        tokensFromMeteora
      );

      if (!opportunity) return null;

      // Якщо знайшли можливість - виконуємо або симулюємо
      return await this.executeArbitrage(opportunity);

    } catch (err: any) {
      this.stats.errors++;
      return null;
    }
  }

  // Отримання ціни Jupiter з кешем
  private async getJupiterPrice(tokenMint: string, amount: number): Promise<number | null> {
    const cacheKey = `jup_${tokenMint}_${amount}`;
    const cached = this.getCachedPrice(cacheKey);
    if (cached) return cached;

    // Купуємо токен за SOL: inputMint=SOL, outputMint=token
    const quote = await getJupiterQuote(BASE_TOKEN_MINT, tokenMint, amount);
    if (!quote?.outAmount) return null;

    const result = Number(quote.outAmount);
    this.setCachedPrice(cacheKey, result);
    return result;
  }
  // Отримання ціни Jupiter для продажу (продаємо токен за SOL)
  private async getJupiterSellPrice(tokenMint: string, amount: number): Promise<number | null> {
    const cacheKey = `jup_sell_${tokenMint}_${amount}`;
    const cached = this.getCachedPrice(cacheKey);
    if (cached) return cached;

    // Продаємо токен за SOL: inputMint=token, outputMint=SOL
    const quote = await getJupiterQuote(tokenMint, BASE_TOKEN_MINT, amount);
    if (!quote?.outAmount) return null;

    const result = Number(quote.outAmount);
    this.setCachedPrice(cacheKey, result);
    return result;
  }
  // Отримання ціни Meteora з кешем
  private async getMeteoraPrice(pairAddress: string, amount: number, reverse: boolean): Promise<number | null> {
    const cacheKey = `met_${pairAddress}_${amount}_${reverse}`;
    const cached = this.getCachedPrice(cacheKey);
    if (cached) return cached;

    const quote = await getMeteoraQuoteDAMMV2(pairAddress, amount, reverse);
    if (!quote) return null;

    const result = quote instanceof BN ? quote.toNumber() : Number(quote);
    this.setCachedPrice(cacheKey, result);
    return result;
  }

  // Аналіз арбітражної можливості
  private async analyzeArbitrage(
    token: Token,
    tokensFromJupiter: number,
    tokensFromMeteora: number
  ): Promise<any | null> {
    const TOKEN_LAMPORTS = 10 ** token.decimals;
    
    // 🔍 Діагностика: виводимо сирі значення
    const jupDisplay = (tokensFromJupiter / TOKEN_LAMPORTS).toFixed(4);
    const metDisplay = (tokensFromMeteora / TOKEN_LAMPORTS).toFixed(4);
    
    // Перевірка на адекватність даних
    if (tokensFromJupiter <= 0 || tokensFromMeteora <= 0) {
      return null;
    }
    
    // Максимальна різниця - якщо більше 10x, це помилка в decimals
    const ratio = Math.max(tokensFromJupiter, tokensFromMeteora) / Math.min(tokensFromJupiter, tokensFromMeteora);
    if (ratio > 100) {
      // Дуже велика різниця - ймовірно проблема з decimals або dead pool
      return null;
    }

    // ВАРІАНТ 1: Купити на Jupiter → Продати на Meteora
    const meteoraSellQuote = await this.getMeteoraPrice(
      token.meteoraPairAddress!,
      tokensFromJupiter,
      false
    );

    if (meteoraSellQuote && meteoraSellQuote > 0) {
      const profit1 = ((meteoraSellQuote - BASE_AMOUNT_IN_LAMPORTS) / BASE_AMOUNT_IN_LAMPORTS) * 100;
      
      // Фільтр: макс реалістичний прибуток 200%
      if (profit1 >= MIN_PROFIT_PERCENT && profit1 <= 200) {
        return {
          token,
          direction: "Jupiter→Meteora",
          buyAmount: tokensFromJupiter,
          sellAmount: meteoraSellQuote,
          profitPercent: profit1,
          profitLamports: meteoraSellQuote - BASE_AMOUNT_IN_LAMPORTS,
          tokensDisplay: jupDisplay
        };
      }
    }

    // ВАРІАНТ 2: Купити на Meteora → Продати на Jupiter
    // Продаємо токен за SOL: inputMint=token, outputMint=SOL
    const jupiterSellQuote = await this.getJupiterSellPrice(token.mint, tokensFromMeteora);
    
    if (jupiterSellQuote && jupiterSellQuote > 0) {
      const profit2 = ((jupiterSellQuote - BASE_AMOUNT_IN_LAMPORTS) / BASE_AMOUNT_IN_LAMPORTS) * 100;
      
      // Фільтр: макс реалістичний прибуток 200%
      if (profit2 >= MIN_PROFIT_PERCENT && profit2 <= 200) {
        return {
          token,
          direction: "Meteora→Jupiter",
          buyAmount: tokensFromMeteora,
          sellAmount: jupiterSellQuote,
          profitPercent: profit2,
          profitLamports: jupiterSellQuote - BASE_AMOUNT_IN_LAMPORTS,
          tokensDisplay: metDisplay
        };
      }
    }

    return null;
  }

  // Виконання арбітражу
  private async executeArbitrage(opportunity: any): Promise<ArbitrageResult> {
    const { token, direction, profitPercent, profitLamports, tokensDisplay, buyAmount, sellAmount } = opportunity;
    const profitAmount = (profitLamports / BASE_TOKEN_LAMPORTS_AMOUNT).toFixed(6);

    this.stats.opportunitiesFound++;

    console.log(`\n>>> OPPORTUNITY FOUND!`);
    console.log(`   Token: ${token.symbol} (${token.decimals} decimals)`);
    console.log(`   Direction: ${direction}`);
    console.log(`   Buy: ${(buyAmount / BASE_TOKEN_LAMPORTS_AMOUNT).toFixed(6)} SOL -> ${tokensDisplay} ${token.symbol}`);
    console.log(`   Sell: ${tokensDisplay} ${token.symbol} -> ${(sellAmount / BASE_TOKEN_LAMPORTS_AMOUNT).toFixed(6)} SOL`);
    console.log(`   Profit: ${profitPercent.toFixed(2)}% (+${profitAmount} ${BASE_TOKEN_SYMBOL})`);

    if (DRY_RUN) {
      console.log(`   [DRY RUN] No actual trade executed`);
      return {
        success: true,
        pair: `${BASE_TOKEN_SYMBOL}/${token.symbol}`,
        direction,
        profitPercent,
        profitAmount
      };
    }

    // Реальне виконання через Jito
    try {
      console.log(`   [EXECUTE] Executing trade via Jito...`);
      
      // Тут буде логіка виконання через Jito Bundle
      // Поки що заглушка
      const signature = await this.executeViaJito(opportunity);
      
      this.stats.tradesExecuted++;
      this.stats.totalProfit += parseFloat(profitAmount);

      console.log(`   [SUCCESS] Trade executed! Signature: ${signature}`);

      return {
        success: true,
        pair: `${BASE_TOKEN_SYMBOL}/${token.symbol}`,
        direction,
        profitPercent,
        profitAmount,
        signature
      };

    } catch (err: any) {
      console.log(`   [FAILED] Trade failed: ${err.message}`);
      this.stats.errors++;
      
      return {
        success: false,
        pair: `${BASE_TOKEN_SYMBOL}/${token.symbol}`,
        direction,
        profitPercent,
        profitAmount,
        error: err.message
      };
    }
  }

  // Виконання через Jito (заглушка - потрібна повна імплементація)
  private async executeViaJito(opportunity: any): Promise<string> {
    // TODO: Імплементувати:
    // 1. Створити транзакції купівлі/продажу
    // 2. Запакувати в Jito bundle
    // 3. Відправити на Jito Block Engine
    // 4. Дочекатися підтвердження
    
    throw new Error("Jito execution not implemented yet - enable when ready");
  }

  // Виведення статистики
  private printStats(cycleTime: number) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[STATS] Cycle time: ${(cycleTime / 1000).toFixed(1)}s`);
    console.log(`   Scans: ${this.stats.scansCompleted} | Opportunities: ${this.stats.opportunitiesFound}`);
    console.log(`   Trades: ${this.stats.tradesExecuted} | Total profit: ${this.stats.totalProfit.toFixed(4)} ${BASE_TOKEN_SYMBOL}`);
    console.log(`   Errors: ${this.stats.errors}`);
    console.log(`${"=".repeat(60)}\n`);
  }
}

// Запуск бота
const bot = new OptimizedArbitrageBot();
bot.start().catch(console.error);
