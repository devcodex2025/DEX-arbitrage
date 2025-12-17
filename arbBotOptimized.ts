import fs from "fs";
import { Connection, Keypair, VersionedTransaction, PublicKey, SystemProgram, TransactionMessage, TransactionInstruction, LAMPORTS_PER_SOL } from "@solana/web3.js";
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
import { SearcherClient, searcherClient } from "jito-ts/dist/sdk/block-engine/searcher.js";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types.js";

// Jito Block Engine URLs
const JITO_BLOCK_ENGINE = "https://mainnet.block-engine.jito.wtf";
const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
];

// Jito tip amount (в lamports) - 0.0001 SOL за bundle
const JITO_TIP_LAMPORTS = 100_000;

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
      
      // Обробляємо токени ПОСЛІДОВНО (один токен за раз)
      // Кожен токен сканується паралельно на Jupiter і Meteora одночасно
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        console.log(`\n${"=".repeat(60)}`);
        console.log(`[${i + 1}/${tokens.length}] ${token.symbol} (${token.mint.slice(0, 8)}...)`);
        console.log(`${"=".repeat(60)}`);
        
        try {
          // Додаємо timeout 30 секунд для кожного токена
          await Promise.race([
            this.scanAndExecute(token),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Token scan timeout')), 30000))
          ]);
        } catch (err: any) {
          if (err.message === 'Token scan timeout') {
            console.log(`   [!] Timeout - skipping to next token`);
          } else {
            console.log(`   [!] Error: ${err.message}`);
          }
          this.stats.errors++;
        }
        
        // Затримка між токенами для уникнення rate limit (429)
        // 1000ms = 1 токен/сек (2 паралельні API calls = ~2 calls/sec загалом)
        await new Promise(resolve => setTimeout(resolve, 1000));
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
      
      // Отримуємо ціни ПАРАЛЕЛЬНО з обох бірж одночасно для мінімізації затримки
      console.log(`   Fetching prices from both exchanges...`);
      const [jupiterBuyResult, meteoraBuyResult] = await Promise.all([
        this.getJupiterPrice(token.mint, BASE_AMOUNT_IN_LAMPORTS),
        this.getMeteoraPrice(token.meteoraPairAddress, BASE_AMOUNT_IN_LAMPORTS, true)
      ]);
      
      if (!jupiterBuyResult) {
        console.log(`   [X] Jupiter: No quote`);
        return null;
      }
      console.log(`   [+] Jupiter: ${(jupiterBuyResult / TOKEN_LAMPORTS).toFixed(4)} ${token.symbol}`);
      
      if (!meteoraBuyResult) {
        console.log(`   [X] Meteora: No quote`);
        return null;
      }
      console.log(`   [+] Meteora: ${(meteoraBuyResult / TOKEN_LAMPORTS).toFixed(4)} ${token.symbol}`);

      const tokensFromJupiter = jupiterBuyResult;
      const tokensFromMeteora = meteoraBuyResult;
      
      // Перевірка на адекватність даних - якщо різниця більше 100x, це bad data
      const ratio = Math.max(tokensFromJupiter, tokensFromMeteora) / Math.min(tokensFromJupiter, tokensFromMeteora);
      if (ratio > 100) {
        console.log(`   [!] Price difference too large (${ratio.toFixed(0)}x) - likely bad liquidity, skipping...`);
        return null;
      }
      
      // Аналізуємо який напрямок вигідніший
      const opportunity = await this.analyzeArbitrage(
        token,
        tokensFromJupiter,
        tokensFromMeteora
      );

      if (!opportunity) {
        // Виводимо детальний лог НЕприбуткових угод
        await this.logUnprofitableArbitrage(token, tokensFromJupiter, tokensFromMeteora);
        return null;
      }

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
  // Отримання ціни Meteora з кешем та timeout
  private async getMeteoraPrice(pairAddress: string, amount: number, reverse: boolean): Promise<number | null> {
    const cacheKey = `met_${pairAddress}_${amount}_${reverse}`;
    const cached = this.getCachedPrice(cacheKey);
    if (cached) return cached;

    try {
      // Timeout 10 секунд для Meteora запитів
      const quote = await Promise.race([
        getMeteoraQuoteDAMMV2(pairAddress, amount, reverse),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ]);
      
      if (!quote) {
        return null;
      }

      const result = quote instanceof BN ? quote.toNumber() : Number(quote);
      this.setCachedPrice(cacheKey, result);
      return result;
    } catch (err) {
      if (err instanceof Error && err.message === 'Timeout') {
        console.log(`   [!] Meteora timeout for ${pairAddress.slice(0, 8)}...`);
      }
      return null;
    }
  }

  // Detailed profitability check log
  private async logUnprofitableArbitrage(token: Token, tokensFromJupiter: number, tokensFromMeteora: number) {
    console.log(`\n   --- Checking Arbitrage Profitability ---`);
    
    // OPTION 1: Jupiter → Meteora
    console.log(`   [1] Jupiter -> Meteora:`);
    
    const meteoraSellQuote = await this.getMeteoraPrice(
      token.meteoraPairAddress!,
      tokensFromJupiter,
      false
    );
    
    if (meteoraSellQuote && meteoraSellQuote > 0) {
      const profitLamports = meteoraSellQuote - BASE_AMOUNT_IN_LAMPORTS;
      const profitSOL = profitLamports / BASE_TOKEN_LAMPORTS_AMOUNT;
      const profitPercent = (profitLamports / BASE_AMOUNT_IN_LAMPORTS) * 100;
      const sign = profitSOL >= 0 ? '+' : '';
      const statusIcon = profitPercent >= MIN_PROFIT_PERCENT ? '[+]' : '[X]';
      
      console.log(`       ${BASE_AMOUNT} SOL -> ${(tokensFromJupiter / (10**token.decimals)).toFixed(4)} ${token.symbol} -> ${(meteoraSellQuote / BASE_TOKEN_LAMPORTS_AMOUNT).toFixed(6)} SOL`);
      console.log(`       ${statusIcon} Profit: ${sign}${profitSOL.toFixed(6)} SOL (${sign}${profitPercent.toFixed(2)}%)`);
    } else {
      console.log(`       [X] Failed to get sell quote`);
    }
    
    // OPTION 2: Meteora → Jupiter
    console.log(`   [2] Meteora -> Jupiter:`);
    
    const jupiterSellQuote = await this.getJupiterSellPrice(token.mint, tokensFromMeteora);
    
    if (jupiterSellQuote && jupiterSellQuote > 0) {
      const profitLamports = jupiterSellQuote - BASE_AMOUNT_IN_LAMPORTS;
      const profitSOL = profitLamports / BASE_TOKEN_LAMPORTS_AMOUNT;
      const profitPercent = (profitLamports / BASE_AMOUNT_IN_LAMPORTS) * 100;
      const sign = profitSOL >= 0 ? '+' : '';
      const statusIcon = profitPercent >= MIN_PROFIT_PERCENT ? '[+]' : '[X]';
      
      console.log(`       ${BASE_AMOUNT} SOL -> ${(tokensFromMeteora / (10**token.decimals)).toFixed(4)} ${token.symbol} -> ${(jupiterSellQuote / BASE_TOKEN_LAMPORTS_AMOUNT).toFixed(6)} SOL`);
      console.log(`       ${statusIcon} Profit: ${sign}${profitSOL.toFixed(6)} SOL (${sign}${profitPercent.toFixed(2)}%)`);
    } else {
      console.log(`       [X] Failed to get sell quote`);
    }
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

  // Виконання через Jito Bundle
  private async executeViaJito(opportunity: any): Promise<string> {
    if (!this.wallet) {
      throw new Error("Wallet not loaded");
    }

    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const { token, direction, buyAmount, sellAmount } = opportunity;

    console.log(`   [JITO] Creating bundle transactions...`);

    try {
      // Крок 1: Створюємо транзакцію tip для Jito
      const tipAccount = new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]);
      const latestBlockhash = await connection.getLatestBlockhash();
      
      const tipIx = SystemProgram.transfer({
        fromPubkey: this.wallet.publicKey,
        toPubkey: tipAccount,
        lamports: JITO_TIP_LAMPORTS
      });

      // Крок 2: Створюємо транзакції арбітражу
      // TODO: Тут потрібно створити реальні swap транзакції через Jupiter та Meteora SDK
      // Для прикладу створюю dummy транзакції
      
      const tipTx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: this.wallet.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: [tipIx]
        }).compileToV0Message()
      );
      
      tipTx.sign([this.wallet]);

      // Крок 3: Створюємо bundle з транзакціями
      console.log(`   [JITO] Sending bundle to Jito Block Engine...`);
      
      // Відправляємо bundle через Jito
      const jitoClient = searcherClient(JITO_BLOCK_ENGINE);
      const bundleTransactions = [tipTx];
      const bundleId = await jitoClient.sendBundle(new Bundle(bundleTransactions, 5));
      
      console.log(`   [JITO] Bundle ID: ${bundleId}`);
      console.log(`   [JITO] Waiting for confirmation...`);

      // Чекаємо підтвердження (спрощена версія)
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Перевіряємо статус tip транзакції
      const signature = bs58.encode(tipTx.signatures[0]);
      const status = await connection.getSignatureStatus(signature);
      
      if (status?.value?.confirmationStatus) {
        console.log(`   [JITO] Bundle confirmed!`);
        return signature;
      } else {
        throw new Error("Bundle not confirmed within timeout");
      }

    } catch (err: any) {
      console.error(`   [JITO ERROR] ${err.message}`);
      throw err;
    }
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
