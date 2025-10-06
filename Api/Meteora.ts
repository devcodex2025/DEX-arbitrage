import fs from "fs";
import fetch from "node-fetch";
import { TOKENS_FILE, RPC_ENDPOINT, SLIPPAGE_BPS, BASE_TOKEN_MINT } from "../Config/config.js"
import DLMM from "@meteora-ag/dlmm";
import { Connection, PublicKey } from '@solana/web3.js';
import BN from "bn.js";
import { getMint } from "@solana/spl-token";

// Initialize a connection to the Solana network (e.g., Mainnet)
const connection = new Connection("https://api.mainnet-beta.solana.com");

interface MeteoraPairInfo {
  address: string;
  reserve_y_amount: number;
}


export async function getMeteoraPairs(baseMint: string) {

  interface Token {
    mint: string;
    symbol: string;
    decimals: number;
    meteoraPairAddress?: string | null;
  }

  try {
    const allTokens = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"));
    const knownMints = new Set(allTokens.map((t: Token) => t.mint));

    const listUrl = `https://dlmm-api.meteora.ag/pair/all?include_unknown=false`;
    const res = await fetch(listUrl);
    const data = await res.json();

    if (!data || data.length === 0) {
      console.log(`⚠️ No Meteora pairs found`);
      return [];
    }

    const tokenToPair: Record<string, MeteoraPairInfo> = {};

    for (const pair of data) {
      // ✅ Беремо тільки ті пари, де baseMint є другим (mint_y)
      // і перший токен (mint_x) є у нашому файлі tokens.json
      if (pair.mint_y === baseMint && knownMints.has(pair.mint_x)) {
        tokenToPair[pair.mint_x] = {
          address: pair.address,
          reserve_y_amount: pair.reserve_y_amount // ліквідність базового токена у Lamports
        }
      }
    }
    // Вивід у консоль
    console.log("Available Tokens and their Meteora Pairs:");
    Object.entries(tokenToPair).forEach(([mint, info], index) => {
      console.log(`${index + 1}. Token: ${mint}, Pair Address: ${info.address}`);
    });

    console.log(`✅ Found ${Object.keys(tokenToPair).length} tokens with pairs on Meteora.`);

    return tokenToPair; // повертаємо об’єкт для зв’язку токен → пара

  } catch (err: unknown) {
    console.error("Error fetching Meteora pairs:", (err as Error)?.message ?? err);
    return {};
  }
}

interface QuoteResult {
  outputAmount: number;
  minOutputAmount: number;
  priceImpact: number;
  fee: number;
}

export async function getMeteoraQuote(
  poolAddress: string,
  amountLamports: number,
  baseTokenMint: string
): Promise<QuoteResult | null> {
  try {
    console.log(`\n=== Start getMeteoraQuote ===`);
    console.log(`Pool address: ${poolAddress}`);
    console.log(`Amount (Lamports): ${amountLamports}`);
    console.log(`Base token mint: ${baseTokenMint}`);

    // Validate baseTokenMint
    if (!baseTokenMint) {
      console.error('❌ Base token mint is undefined');
      return null;
    }

    // 1️⃣ Підключення до мережі
    const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    const pubPoolAddress = new PublicKey(poolAddress);

    // 2️⃣ Перевірка існування акаунта
    const accountInfo = await connection.getAccountInfo(pubPoolAddress);
    if (!accountInfo) {
      console.error(`❌ Pool account does not exist: ${poolAddress}`);
      return null;
    }

    // 3️⃣ Ініціалізація пулу
    let pool;
    try {
      pool = new DLMM(pubPoolAddress, connection);
      await pool.initialize(); // Initialize the pool
      console.log('✅ Pool initialized:', pool.address.toBase58());
    } catch (err: unknown) {
      console.error('❌ Error initializing pool:', err instanceof Error ? err.message : err);
      return null;
    }

    // 4️⃣ Отримання стану пулу
    let poolState;
    try {
      poolState = await pool.getPoolState();
      console.log('✅ Pool state fetched:', poolState);
    } catch (err: unknown) {
      console.error('❌ Error fetching pool state:', err instanceof Error ? err.message : err);
      return null;
    }

    // 5️⃣ Перевірка, яка сторона BASE
    const isBaseTokenA = poolState.pair.tokenXMint.toBase58() === baseTokenMint;
    console.log(`Is BASE token on side A (tokenX)? ${isBaseTokenA}`);

    // 6️⃣ Отримання mint-ів токенів
    let inputMint, outputMint;
    try {
      inputMint = new PublicKey(baseTokenMint);
      outputMint = new PublicKey(isBaseTokenA ? poolState.pair.tokenYMint : poolState.pair.tokenXMint);
      console.log('✅ Input mint:', inputMint.toBase58());
      console.log('✅ Output mint:', outputMint.toBase58());
    } catch (err: unknown) {
      console.error('❌ Error getting token mints:', err instanceof Error ? err.message : err);
      return null;
    }

    // 7️⃣ Конвертація amountLamports у токени (з урахуванням decimals)
    let amountInUnits: BN;
    try {
      const inputMintInfo = await getMint(connection, inputMint);
      amountInUnits = new BN(amountLamports).div(new BN(10 ** inputMintInfo.decimals));
      console.log(`Amount in token units: ${amountInUnits.toString()}`);
    } catch (err: unknown) {
      console.error('❌ Error converting amount:', err instanceof Error ? err.message : err);
      return null;
    }

    // 8️⃣ Отримання quote
    let quote;
    try {
      const quoteParams: QuoteParams = {
        amount: amountInUnits,
        inputMint,
        swapMode: 'ExactIn', // Swap exact input amount
        slippageBps: 50, // 0.5% slippage
      };
      quote = await pool.getQuote(quoteParams);
      console.log('✅ Quote received:', quote);
    } catch (err: unknown) {
      console.error('❌ Error getting quote:', err instanceof Error ? err.message : err);
      return null;
    }

    // 9️⃣ Вивід деталей quote
    console.log(`Expected output: ${quote.outAmount.toString()}`);
    console.log(`Minimum output: ${quote.minOutAmount.toString()}`);
    console.log(`Fee: ${quote.feeAmount.toString()}`);
    console.log(`Price impact: ${quote.priceImpactPct.toFixed(2)}%`);

    return {
      outputAmount: quote.outAmount.toNumber(),
      minOutputAmount: quote.minOutAmount.toNumber(),
      priceImpact: quote.priceImpactPct,
      fee: quote.feeAmount.toNumber(),
    };
  } catch (err: unknown) {
    console.error('❌ Unexpected error in getMeteoraQuote:', err instanceof Error ? err.message : err);
    return null;
  }
}

// Example usage
(async () => {
  const poolAddress = '7pw8khNqJrs6zf98wQJ4npHpwGaiJxa6p8D9qHiF2S21';
  const amountLamports = 1_000_000_000; // 1 SOL
  const baseTokenMint = 'So11111111111111111111111111111111111111112'; // SOL mint

  const result = await getMeteoraQuote(poolAddress, amountLamports, baseTokenMint);
  console.log('Result:', result);
})();

