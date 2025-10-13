import fs from "fs";
import fetch from "node-fetch";
import { TOKENS_FILE, RPC_ENDPOINT, SLIPPAGE_BPS, BASE_TOKEN_MINT, MAX_TOKEN_PAGES_SCAN } from "../Config/config.js"
import DLMM from '@meteora-ag/dlmm'
import { Connection, PublicKey } from '@solana/web3.js';
import BN from "bn.js";
import { getMint } from "@solana/spl-token";

interface MeteoraPairInfo {
    address: string;
    liquidity: number; // ліквідність базового токена у Lamports
}

export async function getMeteoraPairsDLMM(baseMint: string) {
    interface Token {
        mint: string;
        symbol: string;
        decimals: number;
        meteoraPairAddress?: string | null;
    }

    try {
        const allTokens: Token[] = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"));
        const knownMints = new Set(allTokens.map(t => t.mint));
        const tokenToPair: Record<string, MeteoraPairInfo> = {};

        const limit = 100;
        const MAX_PAGES = MAX_TOKEN_PAGES_SCAN; // безпечний максимум
        const concurrency = 5; // скільки сторінок запитуємо одночасно
        let page = 0;
        let keepFetching = true;

        while (keepFetching && page < MAX_PAGES) {
            const batchPages = Array.from({ length: concurrency }, (_, i) => page + i);

            const responses = await Promise.allSettled(
                batchPages.map(p =>
                    fetch(`https://dlmm-api.meteora.ag/pair/all_with_pagination?include_unknown=false&limit=${limit}&page=${p}`)
                )
            );

            let anyData = false;

            for (let i = 0; i < responses.length; i++) {
                const res = responses[i];
                const currentPage = batchPages[i];

                if (res.status !== "fulfilled") continue;

                const data = await res.value.json();
                const pairs = data.pairs;
                const total = data.total;

                if (!pairs || total === 0) continue;

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

export async function getMeteoraQuoteDLMM(
    poolAddress: string,
    lamportAmount: number
): Promise<BN | null> {

    const poolAdressPubkey = new PublicKey(poolAddress);

    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const dLMMPool = await DLMM.create(connection, poolAdressPubkey);
    // console.log('DLMM Pool Info:', dLMM);
    //return null; // тимчасово, поки не налагоджено

    try {
        const inAmount = new BN(lamportAmount);
        const swapForY = true; // або false, залежно від напрямку свапу
        const allowedSlippage = new BN(50); // 0.5% = 50 bps
        const binArrays = await dLMMPool.getBinArrays(); // масив BinArrayAccount з пулу

        // let totalLiquidity = new BN(0);
        // for (const bin of binArrays[0].account.bins) { // для простоти беремо перший binArray
        //     const available = swapForY ? bin.amountX : bin.amountY;
        //     totalLiquidity = totalLiquidity.add(available);
        // }

        // if (totalLiquidity.lt(inAmount)) {
        //     console.log("⚠️ Not enough liquidity in bins for requested amount.");
        //     return null;
        // }

        const quote = dLMMPool.swapQuote(
            inAmount,
            swapForY,
            allowedSlippage,
            binArrays,
            true, // isPartialFill
            3      // maxExtraBinArrays
        );
        // отримуємо кількість Lamports після свапу
        console.log(`quote:`, quote);
        return quote.outAmount ?? null;
    } catch (err: unknown) {
        console.error('❌ Unexpected error in getMeteoraQuote:', err instanceof Error ? err.message : err);
        return null;
    }
}

checkSwapAmount(pairAddress, mintA, mintB){

}