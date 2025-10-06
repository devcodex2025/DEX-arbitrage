import fs from "fs";
import fetch from "node-fetch";
import { TOKENS_FILE, RPC_ENDPOINT, SLIPPAGE_BPS } from "../Config/config.js"
import DLMM from '@meteora-ag/dlmm'
import { Connection, PublicKey } from '@solana/web3.js';
import BN from "bn.js";

const mainnetConnection = new Connection('https://api.mainnet-beta.solana.com');

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

export async function getMeteoraQuote(pairAddress: string, amountLamports: number): Promise<number | null> {
  try {
    const connection = new Connection('https://api.mainnet-beta.solana.com');
    const poolAddress = new PublicKey(pairAddress);
    const dlmmPool = DLMM.create(connection, poolAddress);
    const slippage = 0.1; // Max to 2 decimal place

    if (!dlmmPool) {
      console.error('Pool not found for address:', pairAddress);
      return null;
    }
    const binArrays = await dlmmPool.getBinArrayForSwap(true, 5);
    const swapQuote = dlmmPool.swapQuote(
      new BN(1000000), // 1 token input
      true, // swap X for Y
      new BN(100), // 1% slippage
      binArrays,
      false, // no partial fill
      2 // max extra bin arrays
    );

    return swapQuote.toNumber();
  } catch (err: unknown) {
    if (err instanceof Error) console.error('Error getting quote:', err.message);
    else console.error('Error getting quote:', err);
    return null;
  }
}
