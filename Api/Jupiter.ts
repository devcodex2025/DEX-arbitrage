import { JUP_API_KEY } from "../Config/config.js";
import Decimal from "decimal.js";

const SLIPPAGE_BPS = process.env.SLIPPAGE_BPS || 50;


// Отримуємо токен інформацію з Jupiter
export async function getTokenInfoFromJupiter() {
    try {
        const res = await fetch("https://tokens.jup.ag/tokens");
        const data = await res.json();
        return data;
    } catch (err) {
        console.error("Failed to fetch token list from Jupiter:", err.message);
        return [];
    }
}

export async function getJupiterQuote(inMint, outMint, amount) {
    try {
        const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inMint}&outputMint=${outMint}&amount=${amount}&slippageBps=${SLIPPAGE_BPS}`;
        
        const headers = {
            "Content-Type": "application/json"
        };
        
        // Додаємо API ключ якщо він є
        if (JUP_API_KEY) {
            headers["x-api-key"] = JUP_API_KEY;
        }
        
        const res = await fetch(url, { headers });
        
        if (!res.ok) {
            const errorText = await res.text();
            console.error(`Jupiter API error ${res.status}: ${errorText.substring(0, 100)}`);
            throw new Error(`Jupiter API error: ${res.status} ${res.statusText}`);
        }
        
        const data = await res.json();
        return { raw: data, outAmount: data.outAmount ? new Decimal(data.outAmount) : null };
    } catch (err) {
        console.error("Jupiter quote error:", err.message);
        return { raw: { error: err.message }, outAmount: null };
    }
}