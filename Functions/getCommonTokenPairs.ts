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
    .filter(t => meteoraPairs[t.mint] && meteoraPairs[t.mint].liquidity > LIQUIDITY_USD) //)
    .map(t => ({
      ...t,
      meteoraPairAddress: meteoraPairs[t.mint].address,
    }));

  console.log(`✅ Found ${filtered.length} common & liquid tokens on Jupiter & ${source}.`);
  return filtered;
}