import fs from "fs";
import fetch from "node-fetch";
import { TOKENS_FILE, RPC_ENDPOINT, SLIPPAGE_BPS, BASE_TOKEN_MINT, MAX_TOKEN_PAGES_SCAN } from "../Config/config.js"
import * as DLMMModule from '@meteora-ag/dlmm';
import { Connection, PublicKey } from '@solana/web3.js';
import BN from "bn.js";
import { getMint } from "@solana/spl-token";

// @ts-ignore
const DLMM = DLMMModule.default?.default || DLMMModule.default || DLMMModule;

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
        console.log("[Meteora DLMM] Loading tokens from file...");
        const allTokens: Token[] = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"));
        const knownMints = new Set(allTokens.map(t => t.mint));
        const tokenToPair: Record<string, MeteoraPairInfo> = {};

        const limit = 100;
        const MAX_PAGES = 10; // Обмежуємо для швидкості
        const concurrency = 5;
        let page = 0;
        let keepFetching = true;

        console.log(`[Meteora DLMM] Fetching up to ${MAX_PAGES} pages...`);

        while (keepFetching && page < MAX_PAGES) {
            const batchPages = Array.from({ length: concurrency }, (_, i) => page + i);
            
            console.log(`[Meteora DLMM] Batch ${Math.floor(page/concurrency) + 1}...`);

            const responses = await Promise.allSettled(
                batchPages.map(p =>
                    fetch(`https://dlmm-api.meteora.ag/pair/all_with_pagination?include_unknown=false&limit=${limit}&page=${p}`)
                )
            );

            let anyData = false;

            for (let i = 0; i < responses.length; i++) {
                const res = responses[i];
                const currentPage = batchPages[i];

                if (res.status !== "fulfilled") {
                    console.log(`[Meteora DLMM] Page ${currentPage} failed`);
                    continue;
                }

                try {
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
                } catch (parseErr) {
                    console.log(`[Meteora DLMM] Failed to parse page ${currentPage}`);
                }
            }

            if (!anyData) {
                keepFetching = false;
            }

            page += concurrency;
            await new Promise(r => setTimeout(r, 200));
        }

        console.log(`[Meteora DLMM] ✅ Found ${Object.keys(tokenToPair).length} tokens with DLMM pairs`);
        return tokenToPair;

    } catch (err) {
        console.error("[Meteora DLMM] ❌ Error:", (err as Error)?.message ?? err);
        return {};
    }
}



interface QuoteResult {
    outputAmount: number;
    minOutputAmount: number;
    priceImpact: number;
    fee: number;
}

// Global connection to reuse
let sharedConnection: Connection | null = null;

export async function getMeteoraQuoteDLMM(
    poolAddress: string,
    amount: number,
    swapForY: boolean
): Promise<BN | null> {

    try {
        // console.log(`   [Meteora DLMM] Fetching pool ${poolAddress.substring(0, 8)}...`);
        const poolAdressPubkey = new PublicKey(poolAddress);

        if (!sharedConnection) {
            sharedConnection = new Connection(RPC_ENDPOINT, 'confirmed');
        }
        
        const dLMMPool = await DLMM.create(sharedConnection, poolAdressPubkey);
        
        // console.log(`   [Meteora DLMM] Pool created, getting bin arrays...`);

        const inAmount = new BN(amount);
        // swapForY: true = Token(X) -> SOL(Y)
        // swapForY: false = SOL(Y) -> Token(X)
        const allowedSlippage = new BN(50); // 0.5% = 50 bps
        
        const binArrays = await dLMMPool.getBinArrays();
        // console.log(`   [Meteora DLMM] Got ${binArrays.length} bin arrays`);
        
        if (!binArrays || binArrays.length === 0) {
            // console.log(`   [Meteora DLMM] No bin arrays available`);
            return null;
        }

        // console.log(`   [Meteora DLMM] Calling swapQuote...`);
        const quote = dLMMPool.swapQuote(
            inAmount,
            swapForY,
            allowedSlippage,
            binArrays,
            true, // isPartialFill
            3      // maxExtraBinArrays
        );
        
        if (!quote.outAmount) {
            // console.log(`   [Meteora DLMM] No outAmount in quote`);
            return null;
        }
        
        // console.log(`   [Meteora DLMM] ✅ Quote success: ${quote.outAmount.toString()}`);
        return quote.outAmount;
        
    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        // console.log(`   [Meteora DLMM] ❌ Error: ${errorMsg}`);
        // if (err instanceof Error && err.stack) {
        //     console.log(`   [Meteora DLMM] Stack: ${err.stack.substring(0, 200)}`);
        // }
        return null;
    }
}