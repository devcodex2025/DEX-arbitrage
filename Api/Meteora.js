import { BASE_TOKEN_MINT, BASE_TOKEN_LAMPORTS } from '../Config/config.js';

/**
 * Отримуємо актуальну ціну токена на Meteora
 * @param {string} tokenMint - mint токена, який продаємо
 * @param {string} baseMint - mint базового токена (наприклад SOL)
 * @returns {number|null} - ціна 1 токена у базовому токені
 */

export async function getMeteoraPairs(baseMint) {
    try {
        const listUrl = `https://dlmm-api.meteora.ag/pair/all_by_groups?include_token_mints=${baseMint}`;
        const res = await fetch(listUrl);
        const data = await res.json();

        if (!data.groups || data.groups.length === 0) {
            console.log(`⚠️ No Meteora groups found for base mint ${baseMint}`);
            return [];
        }

        const availableMints = new Set();

        for (const group of data.groups) {
            if (!group.pairs) continue;
            for (const pair of group.pairs) {
                // додаємо всі токени, які торгуються з baseMint
                if (pair.mint_x === baseMint) availableMints.add(pair.mint_y);
                if (pair.mint_y === baseMint) availableMints.add(pair.mint_x);
            }
        }

        console.log(`✅ Found ${availableMints.size} tokens with pairs on Meteora.`);
        return Array.from(availableMints);
    } catch (err) {
        console.error("Error fetching Meteora pairs:", err.message);
        return [];
    }
}

export async function getMeteoraPrice(tokenMint, baseMint) {
    try {
        // 1️⃣ Отримуємо всі групи пар, щоб знайти адресу потрібної пари
        const listUrl = `https://dlmm-api.meteora.ag/pair/all_by_groups?include_token_mints=${baseMint}`;
        const listRes = await fetch(listUrl);
        const listData = await listRes.json();

        if (!listData.groups || listData.groups.length === 0) {
            console.log(`No Meteora groups found for base mint ${baseMint}`);
            return null;
        }

        // 2️⃣ Знаходимо потрібну пару (tokenMint ↔ baseMint)
        let pairAddress = null;
        // шукаємо строго token → base
        for (const group of listData.groups) {
            if (!group.pairs) continue;
            for (const pair of group.pairs) {
                if (pair.mint_x === tokenMint && pair.mint_y === baseMint) {
                    pairAddress = pair.address;
                    break;
                }
            }
            if (pairAddress) break;
        }


        if (!pairAddress) {
            console.log(`No Meteora pair found for ${tokenMint}`);
            return null;
        }

        // 3️⃣ Отримуємо поточну ціну пари
        const pairUrl = `https://dlmm-api.meteora.ag/pair/${pairAddress}`;
        const pairRes = await fetch(pairUrl);
        const pairData = await pairRes.json();

        if (!pairData || !pairData.current_price) {
            console.log(`Meteora price not available for pair ${pairAddress}`);
            return null;
        }

        console.log(`Meteora price for pair ${pairAddress}: ${pairData.current_price}`);
        // Ціна повертається у форматі: 1 токен → X базового токена
        return pairData.current_price;

    } catch (err) {
        console.error("Error fetching Meteora price:", err.message);
        return null;
    }
}

/**
 * Зворотний свап через Meteora: конвертує кількість Lamports токена у Lamports базового токена
 * @param {string} tokenMint - mint токена, який продаємо
 * @param {number} amountLamports - кількість Lamports токена, який продаємо
 * @param {number} tokenDecimals - decimals токена, який продаємо
 * @returns {number|null} - кількість Lamports базового токена
 */
export async function getMeteoraQuote(tokenMint, amountLamports, tokenDecimals) {
    const pricePerToken = await getMeteoraPrice(tokenMint, BASE_TOKEN_MINT);
    if (!pricePerToken) return null;

    // 1️⃣ Конвертуємо Lamports токена в токени
    const amountTokens = amountLamports / (10 ** tokenDecimals);

    // 2️⃣ Множимо на ціну → отримуємо кількість базового токена у токенах
    const baseTokenAmountTokens = amountTokens * pricePerToken;

    // 3️⃣ Конвертуємо у Lamports базового токена
    const baseTokenLamports = Math.floor(baseTokenAmountTokens * BASE_TOKEN_LAMPORTS);

    console.log(`Spent: ${amountLamports} Lamports, Received: ${baseTokenLamports} Lamports`);
    return baseTokenLamports;
}

