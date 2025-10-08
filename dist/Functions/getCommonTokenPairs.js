import { BASE_TOKEN_MINT } from "../Config/config";
import { TOKENS_FILE } from "../Config/config";
import fs from "fs";
// Завантажуємо токени з файлу, виключаючи базовий токен
const allTokens = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8")).filter((t) => t.mint !== BASE_TOKEN_MINT);
export default async function getCommonTokenPairs(getPairsFn, source) {
    console.log("Fetching available Meteora pairs...");
    const meteoraPairs = await getPairsFn(BASE_TOKEN_MINT || "");
    if (!meteoraPairs || Object.keys(meteoraPairs).length === 0) {
        console.log("⚠️ No Meteora pairs found — scanning all tokens instead...");
        return allTokens.map(t => ({ ...t, meteoraPairAddress: null }));
    }
    const filtered = allTokens
        .filter(t => meteoraPairs[t.mint])
        .map(t => ({
        ...t,
        meteoraPairAddress: meteoraPairs[t.mint].address,
    }));
    console.log(`✅ Found ${filtered.length} common & liquid tokens on Jupiter & ${source}.`);
    return filtered;
}
//# sourceMappingURL=getCommonTokenPairs.js.map