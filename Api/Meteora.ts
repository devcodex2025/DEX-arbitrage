import fs from "fs";
import fetch from "node-fetch";
import { TOKENS_FILE, RPC_ENDPOINT, SLIPPAGE_BPS, BASE_TOKEN_MINT } from "../Config/config.js"
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { Connection, PublicKey } from '@solana/web3.js';
import BN from "bn.js";
import { getMint } from "@solana/spl-token";

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

    const tokenToPair: Record<string, MeteoraPairInfo> = {};
    const limit = 100;
    let offset = 0;

    while (true) {
      const listUrl = `https://dammv2-api.meteora.ag/pools?tokens_verified=true&limit=${limit}&offset=${offset}`;
      const res = await fetch(listUrl);
      const data = await res.json();
      const poolsList = data.data;

      if (!poolsList || poolsList.length === 0) break;

      for (const pair of poolsList) {
        // ✅ Беремо тільки ті пари, де baseMint є другим (mint_y)
        // і перший токен (mint_x) є у нашому файлі tokens.json
        if (pair.token_b_mint === baseMint && knownMints.has(pair.token_a_mint)) {
          tokenToPair[pair.token_a_mint] = {
            address: pair.pool_address,
            liquidity: pair.liquidity // ліквідність базового токена у Lamports
          }
        }
      }
      offset += limit; // зсув на наступну "сторінку"
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
): Promise<BN | null> {


  const connection = new Connection("https://api.mainnet-beta.solana.com");
  const cpAmm = new CpAmm(connection);

  try {
    const AddressPool = new PublicKey('8Pm2kZpnxD3hoMmt4bjStX2Pw2Z9abpbHzZxMPqxPmie');
    const poolState = await cpAmm.fetchPoolState(AddressPool);
    const currentSlot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(currentSlot) ?? Math.floor(Date.now() / 1000);
    const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const usdtMint = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

    // отримуємо інформацію про токени
    const inputMintInfo = await getMint(connection, usdcMint);
    const outputMintInfo = await getMint(connection, usdtMint);

    const tokenADecimal = inputMintInfo.decimals;
    const tokenBDecimal = outputMintInfo.decimals;

    // поточний епох
    const epochInfo = await connection.getEpochInfo();
    const currentEpochNumber = epochInfo.epoch;

    const quote = cpAmm.getQuote({
      inAmount: new BN(100_000_000), // 100 USDC
      inputTokenMint: usdcMint,
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
  } catch (err: unknown) {
    console.error('❌ Unexpected error in getMeteoraQuote:', err instanceof Error ? err.message : err);
    return null;
  }
}
