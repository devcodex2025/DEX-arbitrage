import { JUP_API_KEY } from "../Config/config.js";
import Decimal from "decimal.js";
import fetch from "node-fetch";

const SLIPPAGE_BPS = process.env.SLIPPAGE_BPS || 50;

// Jupiter Ultra API endpoint
const JUPITER_ULTRA_API = "https://api.jup.ag/ultra/v1";

// Отримуємо токен інформацію з Jupiter token list (працює через CDN)
export async function getTokenInfoFromJupiter() {
    try {
        const res = await fetch("https://token.jup.ag/all");
        const data = await res.json();
        return data;
    } catch (err) {
        console.error("Failed to fetch token list:", err.message);
        return [];
    }
}

export async function getJupiterQuote(inMint, outMint, amount, takerAddress = "CdbFf2sQtfop2bqhX62b9NqaoSa13UP7VKDKzW81sYr7") {
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // Використовуємо Jupiter Ultra API v1
            const url = `${JUPITER_ULTRA_API}/order?inputMint=${inMint}&outputMint=${outMint}&amount=${amount}&taker=${takerAddress}`;
            
            const headers = {
                "Content-Type": "application/json",
                "Accept": "application/json"
            };
            
            // Додаємо API ключ якщо він є
            if (JUP_API_KEY) {
                headers["x-api-key"] = JUP_API_KEY;
            }
            
            const res = await fetch(url, { 
                headers,
                timeout: 10000
            });
            
            if (!res.ok) {
                const errorText = await res.text();
                if (res.status === 429) {
                    console.log(`   [!] Rate limit - attempt ${attempt + 1}/${maxRetries}`);
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                } else if (res.status === 404 || res.status === 400) {
                    // No route found
                    return { raw: { error: "No route" }, outAmount: null };
                } else {
                    console.log(`   [!] Jupiter Ultra API ${res.status}: ${errorText.substring(0, 100)}`);
                }
                return { raw: { error: `${res.status}` }, outAmount: null };
            }
            
            const data = await res.json();
            
            // Jupiter Ultra повертає outAmount
            const outAmount = data.outAmount;
            
            if (!outAmount) {
                return { raw: data, outAmount: null };
            }
            
            return { 
                raw: data, 
                outAmount: new Decimal(outAmount.toString()) 
            };
            
        } catch (err) {
            lastError = err;
            if (err.name === 'AbortError' || err.type === 'request-timeout') {
                console.log(`   [!] Jupiter timeout - attempt ${attempt + 1}/${maxRetries}`);
            } else {
                console.log(`   [!] Jupiter error: ${err.message} - attempt ${attempt + 1}/${maxRetries}`);
            }
            
            if (attempt < maxRetries - 1) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }
    
    console.log(`   [X] Jupiter failed after ${maxRetries} attempts`);
    return { raw: { error: lastError?.message || "Unknown error" }, outAmount: null };
}