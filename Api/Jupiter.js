import { JUP_API_KEY } from "../Config/config.js";

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
        const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inMint}&outputMint=${outMint}&amount=${amount}&slippageBps=${SLIPPAGE_BPS}`;
        const res = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
                "x-api-key": JUP_API_KEY
            },
        });
        const data = await res.json();
        return { raw: data, outAmount: data.outAmount ? new Decimal(data.outAmount) : null };
    } catch (err) {
        return { raw: { error: err.message }, outAmount: null };
    }
}