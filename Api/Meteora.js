import { BASE_TOKEN_LAMPORTS, TOKENS_FILE } from '../Config/config.js';
import fs from 'fs';

export async function getMeteoraPairs(baseMint) {
  try {
    const allTokens = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"));
    const knownMints = new Set(allTokens.map(t => t.mint));

    const listUrl = `https://dlmm-api.meteora.ag/pair/all?include_unknown=false`;
    const res = await fetch(listUrl);
    const data = await res.json();

    if (!data || data.length === 0) {
      console.log(`⚠️ No Meteora pairs found`);
      return [];
    }

    const tokenToPair = {}; // ключ — mint токена, значення — адреса пари

    for (const pair of data) {
      // ✅ Беремо тільки ті пари, де baseMint є другим (mint_y)
      // і перший токен (mint_x) є у нашому файлі tokens.json
      if (pair.mint_y === baseMint && knownMints.has(pair.mint_x)) {
        tokenToPair[pair.mint_x] = pair.address;
      }
    }
    // Вивід у консоль
    console.log("Available Tokens and their Meteora Pairs:");
    Object.entries(tokenToPair).forEach(([mint, address], index) => {
      console.log(`${index + 1}. Token: ${mint}, Pair Address: ${address}`);
    });

    console.log(`✅ Found ${Object.keys(tokenToPair).length} tokens with pairs on Meteora.`);

    return tokenToPair; // повертаємо об’єкт для зв’язку токен → пара

  } catch (err) {
    console.error("Error fetching Meteora pairs:", err.message);
    return [];
  }
}


export async function getMeteoraPriceByAddress(pairAddress) {
  try {
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

export async function getMeteoraQuote(pairAddress, amountLamports, tokenDecimals) {
  const pricePerToken = await getMeteoraPriceByAddress(pairAddress);
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

