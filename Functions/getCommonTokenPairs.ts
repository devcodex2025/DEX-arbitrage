import { BASE_TOKEN_MINT, LIQUIDITY_USD } from "../Config/config";
import { TOKENS_FILE } from "../Config/config";
import fs from "fs";

interface Token {
  mint: string;
  symbol: string;
  decimals: number;
  meteoraPairAddress?: string | null;
}

interface MeteoraPairInfo {
  address: string;
  liquidity: number;
}

// Завантажуємо токени з файлу, виключаючи базовий токен
const allTokens: Token[] = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8")).filter(
  (t: Token) => t.mint !== BASE_TOKEN_MINT
);

export default async function getCommonTokenPairs(
  getPairsFn: (baseMint: string) => Promise<Record<string, MeteoraPairInfo>>,
  source: string
): Promise<Token[]> {
  console.log("Fetching available Meteora pairs...");

  const meteoraPairs = await getPairsFn(BASE_TOKEN_MINT || "");

  if (!meteoraPairs || Object.keys(meteoraPairs).length === 0) {
    console.log("⚠️ No Meteora pairs found — scanning all tokens instead...");
    return allTokens.map(t => ({ ...t, meteoraPairAddress: null }));
  }
 
  const filtered = allTokens
    .filter(t => {
      const pair = meteoraPairs[t.mint];
      // Просто перевіряємо наявність пари (ліквідність від API некоректна)
      return pair !== undefined;
    })
    .map(t => ({
      ...t,
      meteoraPairAddress: meteoraPairs[t.mint].address,
    }))
    .slice(0, 20); // Обмежуємо до 20 токенів для балансу між швидкістю та rate limits

  console.log(`✅ Found ${Object.keys(meteoraPairs).length} tokens with pairs on Meteora.`);
  console.log(`✅ Found ${filtered.length} tokens to scan on Jupiter & ${source}.`);
  return filtered;
}