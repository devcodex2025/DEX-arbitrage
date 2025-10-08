import { BASE_TOKEN_SYMBOL, BASE_TOKEN_MINT, BASE_TOKEN_LAMPORTS_AMOUNT, DELAY_MS } from "../Config/config";
import { getJupiterQuote } from "../Api/Jupiter";
import BN from "bn.js";
export default async function scanTokenPairs({ tokens, getMeteoraQuoteFn, source, results, }) {
    for (const token of tokens) {
        console.log(`\n--- Scanning ${BASE_TOKEN_SYMBOL} / ${token.symbol} (${source}) ---`);
        console.log(`Base token mint: ${BASE_TOKEN_MINT}, Token mint: ${token.mint}, Base amount (Lamports): ${BASE_TOKEN_LAMPORTS_AMOUNT}`);
        // Jupiter quote
        const jupiterQuote = await getJupiterQuote(BASE_TOKEN_MINT, token.mint, BASE_TOKEN_LAMPORTS_AMOUNT);
        if (!jupiterQuote) {
            console.log(`Failed to buy ${token.symbol} on Jupiter.`);
            continue;
        }
        const lamportsReceived = Number(jupiterQuote.outAmount);
        const TOKEN_LAMPORTS = 10 ** token.decimals;
        //const lamportsReceived = Number(jupiterQuote.outAmount);
        const tokenDisplay = lamportsReceived / TOKEN_LAMPORTS;
        console.log(`${BASE_TOKEN_SYMBOL} → ${token.symbol} (Jupiter): ${lamportsReceived} Lamports (≈ ${tokenDisplay} ${token.symbol})`);
        await new Promise(r => setTimeout(r, DELAY_MS));
        const pairAddress = token.meteoraPairAddress;
        if (!pairAddress) {
            console.log(`No ${source} pair for ${token.symbol}, skipping...`);
            continue;
        }
        // Зворотний свап через вказану модель
        const sellAmountLamports = await getMeteoraQuoteFn(pairAddress, lamportsReceived);
        if (!sellAmountLamports) {
            console.log(`Price for ${token.symbol} not available on ${source}, skipping...`);
            continue;
        }
        console.log(`sell amount (Lamports): ${sellAmountLamports}`);
        const sellAmountLamportsNum = sellAmountLamports instanceof BN ? sellAmountLamports.toNumber() : sellAmountLamports;
        const sellDisplay = sellAmountLamportsNum / BASE_TOKEN_LAMPORTS_AMOUNT;
        const profitPercent = ((sellAmountLamportsNum - BASE_TOKEN_LAMPORTS_AMOUNT) / BASE_TOKEN_LAMPORTS_AMOUNT) * 100;
        console.log(`Spent: ${lamportsReceived} Lamports, Received: ${sellAmountLamports} Lamports, Profit: ${profitPercent.toFixed(2)}%`);
        console.log(`${token.symbol} → ${BASE_TOKEN_SYMBOL} (${source}): ${sellAmountLamports} Lamports (≈ ${sellDisplay} ${BASE_TOKEN_SYMBOL})`);
        // Без змін у логіці збереження
        results.push({
            pair: `${BASE_TOKEN_SYMBOL} / ${token.symbol}`,
            buyAmount_lamports: lamportsReceived.toString(),
            tokenAmount_display: tokenDisplay.toString(),
            sellAmount_lamports: sellAmountLamports.toString(),
            sellAmount_display: sellDisplay.toString(),
            profitPercent: profitPercent.toFixed(2),
            source, // ✅ динамічно додаємо назву моделі
        });
    }
}
//# sourceMappingURL=scanTokenPairs.js.map