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
    const allTokens: Token[] = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"));
    const knownMints = new Set(allTokens.map(t => t.mint));
    const tokenToPair: Record<string, MeteoraPairInfo> = {};

    const limit = 100;
    const MAX_PAGES = 100; // безпечний максимум (змінюй якщо треба)
    const urls: string[] = [];

    // 🔹 Формуємо список усіх сторінок для запиту
    for (let offset = 0; offset < limit * MAX_PAGES; offset += limit) {
      urls.push(`https://dammv2-api.meteora.ag/pools?tokens_verified=true&limit=${limit}&offset=${offset}`);
    }

    // 🔹 Виконуємо запити паралельно (до 5 одночасно, щоб не перевантажити API)
    const concurrency = 5;
    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      const responses = await Promise.allSettled(batch.map(url => fetch(url)));

      for (const res of responses) {
        if (res.status !== "fulfilled") continue;
        const data = await res.value.json();
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
          }
        }
      }

      // ⏳ Коротка пауза між батчами (щоб не зловити rate limit)
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`✅ Found ${Object.keys(tokenToPair).length} tokens with pairs on Meteora.`);
    return tokenToPair;
  } catch (err) {
    console.error("❌ Error fetching Meteora pairs:", (err as Error)?.message ?? err);
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
    const AddressPool = new PublicKey(poolAddress);
    const poolState = await cpAmm.fetchPoolState(AddressPool);
    
    // Перевірка валідності пулу
    if (!poolState || !poolState.tokenAMint || !poolState.tokenBMint) {
      return null;
    }
    
    const currentSlot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(currentSlot) ?? Math.floor(Date.now() / 1000);
    let tokenAMintPbkey = poolState.tokenAMint;
    let tokenBMintPbkey = poolState.tokenBMint;

    if (isReverse) {
      tokenAMintPbkey = poolState.tokenBMint;
      tokenBMintPbkey = poolState.tokenAMint;
    }
    
    // отримуємо інформацію про токени
    const inputMintInfo = await getMint(connection, tokenAMintPbkey);
    const outputMintInfo = await getMint(connection, tokenBMintPbkey);
    const tokenADecimal = inputMintInfo.decimals;
    const tokenBDecimal = outputMintInfo.decimals;

    // поточний епох
    const epochInfo = await connection.getEpochInfo();
    const currentEpochNumber = epochInfo.epoch;

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
      return quote.swapOutAmount;
    } catch (quoteErr) {
      // Тихо ігноруємо помилки getQuote (наприклад, "Assertion failed" для пулів з нульовою ліквідністю)
      return null;
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Meteora error for ${poolAddress}: ${errorMsg}`);
    return null;
  }
}

// Функція видалена - перевірка ліквідності відбувається через SDK