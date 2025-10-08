import fs from "fs";
import fetch from "node-fetch";
import { TOKENS_FILE } from "../Config/config.js";
import DLMM from '@meteora-ag/dlmm';
import { Connection, PublicKey } from '@solana/web3.js';
import BN from "bn.js";
export async function getMeteoraPairsDLMM(baseMint) {
    try {
        const allTokens = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"));
        const knownMints = new Set(allTokens.map(t => t.mint));
        const tokenToPair = {};
        const limit = 100;
        const MAX_PAGES = 5; // безпечний максимум
        const concurrency = 5; // скільки сторінок запитуємо одночасно
        let page = 0;
        let keepFetching = true;
        while (keepFetching && page < MAX_PAGES) {
            const batchPages = Array.from({ length: concurrency }, (_, i) => page + i);
            const responses = await Promise.allSettled(batchPages.map(p => fetch(`https://dlmm-api.meteora.ag/pair/all_with_pagination?include_unknown=false&limit=${limit}&page=${p}`)));
            let anyData = false;
            for (let i = 0; i < responses.length; i++) {
                const res = responses[i];
                const currentPage = batchPages[i];
                if (res.status !== "fulfilled")
                    continue;
                const data = await res.value.json();
                const pairs = data.pairs;
                const total = data.total;
                if (!pairs || total === 0)
                    continue;
                anyData = true;
                for (const pair of pairs) {
                    if (pair.mint_y === baseMint && knownMints.has(pair.mint_x)) {
                        tokenToPair[pair.mint_x] = {
                            address: pair.address,
                            liquidity: pair.liquidity
                        };
                    }
                }
                console.log(`page number: ${currentPage}, total pairs: ${total}`);
            }
            if (!anyData) {
                keepFetching = false; // зупиняємося, якщо жодної пари не знайдено
            }
            page += concurrency; // переходимо до наступного батчу сторінок
            await new Promise(r => setTimeout(r, 100)); // коротка пауза між батчами
        }
        console.log(`✅ Found ${Object.keys(tokenToPair).length} tokens with pairs on Meteora DLMM.`);
        return tokenToPair;
    }
    catch (err) {
        console.error("❌ Error fetching Meteora pairs:", err?.message ?? err);
        return {};
    }
}
export async function getMeteoraQuoteDLMM(poolAddress, lamportAmount) {
    const poolAdressPubkey = new PublicKey(poolAddress);
    const connection = new Connection("https://api.mainnet-beta.solana.com");
    const dLMMPool = await DLMM.create(connection, poolAdressPubkey);
    // console.log('DLMM Pool Info:', dLMM);
    //return null; // тимчасово, поки не налагоджено
    try {
        const inAmount = new BN(lamportAmount);
        const swapForY = true; // або false, залежно від напрямку свапу
        const allowedSlippage = new BN(50); // 0.5% = 50 bps
        const binArrays = await dLMMPool.getBinArrays(); // масив BinArrayAccount з пулу
        const quote = dLMMPool.swapQuote(inAmount, swapForY, allowedSlippage, binArrays, false, // isPartialFill
        0 // maxExtraBinArrays
        );
        // отримуємо кількість Lamports після свапу
        console.log(`quote:`, quote);
        return quote.outAmount ?? null;
    }
    catch (err) {
        console.error('❌ Unexpected error in getMeteoraQuote:', err instanceof Error ? err.message : err);
        return null;
    }
}
//# sourceMappingURL=MeteoraDLMM.js.map