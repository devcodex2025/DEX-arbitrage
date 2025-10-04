import fs from "fs";
import dotenv from "dotenv";
import fetch from "node-fetch";
import XLSX from "xlsx";

dotenv.config();

// Налаштування
const JUP_API_KEY = process.env.JUP_API_KEY;
const TOKENS_FILE = "./tokens.json";

const BASE_TOKEN_MINT = process.env.BASE_TOKEN_MINT;
const BASE_TOKEN_SYMBOL = process.env.BASE_TOKEN_SYMBOL || "BASE";
const BASE_AMOUNT = Number(process.env.BASE_AMOUNT || 100);
const BASE_DECIMALS = BASE_TOKEN_SYMBOL === "SOL" ? 9 : 6;

const SLIPPAGE_BPS = 50;
const DELAY_MS = 1200; // Jupiter rate limit

// Читання токенів, крім базового
const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"))
  .filter(t => t.mint !== BASE_TOKEN_MINT);

// Отримання котирування з Jupiter
async function getJupiterQuote(inMint, outMint, amountAtomic) {
  try {
    const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inMint}&outputMint=${outMint}&amount=${amountAtomic}&slippageBps=${SLIPPAGE_BPS}`;
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': JUP_API_KEY }
    });
    const data = await res.json();
    return { raw: data, outAmount: data.outAmount ? Number(data.outAmount) : null };
  } catch (err) {
    return { raw: { error: err.message }, outAmount: null };
  }
}

// Отримання ціни з Meteora
async function getMeteoraPrice(tokenMint) {
  try {
    const url = `https://dlmm-api.meteora.ag/pair/all_by_groups?include_token_mints=${BASE_TOKEN_MINT}`;
    const res = await fetch(url);
    const data = await res.json();

    for (const group of data.groups) {
      for (const pair of group.pairs) {
        if ((pair.mint_x === tokenMint && pair.mint_y === BASE_TOKEN_MINT) ||
            (pair.mint_y === tokenMint && pair.mint_x === BASE_TOKEN_MINT)) {
          return pair.current_price;
        }
      }
    }
    return null;
  } catch (err) {
    console.error("Error fetching Meteora price:", err.message);
    return null;
  }
}

// Основна функція сканування
async function scanArb() {
  const results = [];

  for (const token of tokens) {
    console.log(`\n--- Scanning ${BASE_TOKEN_SYMBOL} / ${token.symbol} ---`);

    // 1️⃣ Купівля токена на Jupiter (BASE → TOKEN)
    const baseAmountAtomic = BASE_AMOUNT * 10 ** BASE_DECIMALS;
    const jupiterQuote = await getJupiterQuote(BASE_TOKEN_MINT, token.mint, baseAmountAtomic);

    if (!jupiterQuote.outAmount) {
      console.log(`Failed to buy ${token.symbol} on Jupiter:`, jupiterQuote.raw);
      continue;
    }

    const tokenAmount = jupiterQuote.outAmount / 10 ** token.decimals; // у нормальних одиницях
    console.log(`${BASE_TOKEN_SYMBOL} → ${token.symbol} (Jupiter): ${tokenAmount.toFixed(6)} ${token.symbol}`);

    await new Promise(r => setTimeout(r, DELAY_MS));

    // 2️⃣ Продаж токена на Meteora (TOKEN → BASE)
    const meteoraPrice = await getMeteoraPrice(token.mint);
    if (!meteoraPrice) {
      console.log(`Failed to get Meteora price for ${token.symbol}`);
      continue;
    }

    const sellBase = tokenAmount * meteoraPrice; // у нормальних одиницях BASE_TOKEN
    console.log(`${token.symbol} → ${BASE_TOKEN_SYMBOL} (Meteora): ${sellBase.toFixed(6)} ${BASE_TOKEN_SYMBOL}`);

    const spread = (sellBase - BASE_AMOUNT) / BASE_AMOUNT * 100;
    console.log(`Profit/Spread: ${spread.toFixed(4)} %`);

    results.push({
      pair: `${BASE_TOKEN_SYMBOL} / ${token.symbol}`,
      buyAmount: tokenAmount,
      meteoraPrice,
      sellBase,
      profitPercent: spread
    });
  }

  // === запис у Excel ===
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(results);
  XLSX.utils.book_append_sheet(wb, ws, "ArbScan");
  XLSX.writeFile(wb, "arb_scan_tokens.xlsx");
  console.log("\n✅ Results saved to arb_scan_tokens.xlsx");
}

scanArb();
