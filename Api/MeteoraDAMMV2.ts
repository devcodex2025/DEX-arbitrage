import fs from "fs";
import fetch from "node-fetch";
import { TOKENS_FILE, RPC_ENDPOINT, SLIPPAGE_BPS, BASE_TOKEN_MINT } from "../Config/config.js"
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { Connection, PublicKey } from '@solana/web3.js';
import BN from "bn.js";
import { getMint } from "@solana/spl-token";
import { get } from "http";

interface MeteoraPairInfo {
  address: string;
  liquidity: number; // ліквідність базового токена у Lamports
  meteora_fee?: number; // комісія Meteora у %
}

export async function getMeteoraPairsDAMMV2(baseMint: string) {
  interface Token {
    mint: string;
    symbol: string;
    decimals: number;
    meteoraPairAddress?: string | null;
    meteora_fee?: number; // комісія Meteora
  }

  try {
    console.log("[Meteora] Loading tokens from file...");
    const allTokens: Token[] = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"));
    const knownMints = new Set(allTokens.map(t => t.mint));
    const tokenToPair: Record<string, MeteoraPairInfo> = {};

    const limit = 100;
    const MAX_PAGES = 10; // Зменшено для швидшого сканування
    const urls: string[] = [];

    // 🔹 Формуємо список усіх сторінок для запиту
    for (let offset = 0; offset < limit * MAX_PAGES; offset += limit) {
      urls.push(`https://dammv2-api.meteora.ag/pools?tokens_verified=true&limit=${limit}&offset=${offset}`);
    }

    console.log(`[Meteora] Fetching ${MAX_PAGES} pages (${urls.length} requests)...`);

    // 🔹 Виконуємо запити паралельно (до 5 одночасно, щоб не перевантажити API)
    const concurrency = 5;
    let totalPairsFound = 0;
    
    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      console.log(`[Meteora] Batch ${Math.floor(i/concurrency) + 1}/${Math.ceil(urls.length/concurrency)}...`);
      
      // Додаємо timeout для кожного запиту
      const fetchWithTimeout = (url: string, timeout = 10000) => {
        return Promise.race([
          fetch(url),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
        ]);
      };
      
      const responses = await Promise.allSettled(batch.map(url => fetchWithTimeout(url)));

      for (const res of responses) {
        if (res.status !== "fulfilled") {
          console.log(`[Meteora] Request failed or timed out`);
          continue;
        }
        
        try {
          const data = await (res.value as any).json();
          const poolsList = data.data;
          if (!poolsList || poolsList.length === 0) continue;

          for (const pair of poolsList) {
            // ✅ Фільтруємо лише релевантні пули
            if (pair.token_b_mint === baseMint && knownMints.has(pair.token_a_mint)) {
              tokenToPair[pair.token_a_mint] = {
                address: pair.pool_address,
                liquidity: pair.liquidity, // ліквідність базового токена у Lamports
                meteora_fee: pair.base_fee // комісія Meteora у %
              };
              totalPairsFound++;
            }
          }
        } catch (parseErr) {
          console.log(`[Meteora] Failed to parse response`);
        }
      }

      // ⏳ Коротка пауза між батчами (щоб не зловити rate limit)
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`[Meteora] ✅ Found ${Object.keys(tokenToPair).length} tokens with pairs`);
    return tokenToPair;
  } catch (err) {
    console.error("[Meteora] ❌ Error:", (err as Error)?.message ?? err);
    return {};
  }
}

interface QuoteResult {
  outputAmount: number;
  minOutputAmount: number;
  priceImpact: number;
  fee: number;
}

export async function getMeteoraQuoteDAMMV2(
  poolAddress: string,
  tokenRawAmount: number,
  isReverse = false
): Promise<BN | null> {
  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  const cpAmm = new CpAmm(connection);

  try {
    console.log(`   [Meteora DEBUG] Fetching pool state for ${poolAddress.substring(0, 8)}...`);
    const AddressPool = new PublicKey(poolAddress);
    const poolState = await cpAmm.fetchPoolState(AddressPool);
    
    // Перевірка валідності пулу
    if (!poolState) {
      console.log(`   [Meteora DEBUG] Pool state is null`);
      return null;
    }
    
    if (!poolState.tokenAMint || !poolState.tokenBMint) {
      console.log(`   [Meteora DEBUG] Missing token mints`);
      return null;
    }
    
    console.log(`   [Meteora DEBUG] Pool found, tokenA: ${poolState.tokenAMint.toString().substring(0, 8)}..., tokenB: ${poolState.tokenBMint.toString().substring(0, 8)}...`);
    console.log(`   [Meteora DEBUG] isReverse: ${isReverse}, amount: ${tokenRawAmount}`);
    
    const currentSlot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(currentSlot) ?? Math.floor(Date.now() / 1000);
    let tokenAMintPbkey = poolState.tokenAMint;
    let tokenBMintPbkey = poolState.tokenBMint;

    if (isReverse) {
      tokenAMintPbkey = poolState.tokenBMint;
      tokenBMintPbkey = poolState.tokenAMint;
      console.log(`   [Meteora DEBUG] After reverse - input: ${tokenAMintPbkey.toString().substring(0, 8)}..., output: ${tokenBMintPbkey.toString().substring(0, 8)}...`);
    }
    
    console.log(`   [Meteora DEBUG] Getting mint info...`);
    // отримуємо інформацію про токени
    const inputMintInfo = await getMint(connection, tokenAMintPbkey);
    const outputMintInfo = await getMint(connection, tokenBMintPbkey);
    const tokenADecimal = inputMintInfo.decimals;
    const tokenBDecimal = outputMintInfo.decimals;
    
    console.log(`   [Meteora DEBUG] Decimals - input: ${tokenADecimal}, output: ${tokenBDecimal}`);

    // поточний епох
    const epochInfo = await connection.getEpochInfo();
    const currentEpochNumber = epochInfo.epoch;

    console.log(`   [Meteora DEBUG] Calling getQuote...`);
    // Спроба отримати quote з обробкою помилки "Assertion failed"
    try {
      const quote = cpAmm.getQuote({
        inAmount: new BN(tokenRawAmount),
        inputTokenMint: tokenAMintPbkey,
        slippage: 0.5, // 0.5% slippage
        poolState,
        currentTime: blockTime,
        currentSlot,
        inputTokenInfo: {
          mint: inputMintInfo,      // об'єкт типу Mint (отриманий через getMint)
          currentEpoch: currentEpochNumber, // number
        },
        outputTokenInfo: {
          mint: outputMintInfo,     // також об'єкт типу Mint
          currentEpoch: currentEpochNumber, // number
        },
        tokenADecimal,
        tokenBDecimal,
      });
      console.log(`   [Meteora DEBUG] ✅ Quote success: ${quote.swapOutAmount.toString()}`);
      return quote.swapOutAmount;
    } catch (quoteErr) {
      // Детальне логування помилки
      const errMsg = quoteErr instanceof Error ? quoteErr.message : String(quoteErr);
      console.log(`   [Meteora DEBUG] ❌ Quote error: ${errMsg}`);
      if (quoteErr instanceof Error && quoteErr.stack) {
        console.log(`   [Meteora DEBUG] Stack: ${quoteErr.stack.substring(0, 200)}`);
      }
      return null;
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(`   [Meteora DEBUG] ❌ Pool error: ${errorMsg}`);
    if (err instanceof Error && err.stack) {
      console.log(`   [Meteora DEBUG] Stack: ${err.stack.substring(0, 200)}`);
    }
    return null;
  }
}

// Функція видалена - перевірка ліквідності відбувається через SDK