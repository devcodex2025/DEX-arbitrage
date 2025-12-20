// Тест Jupiter Ultra API
import fetch from "node-fetch";

const JUPITER_ULTRA_API = "https://api.jup.ag/ultra/v1";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const amount = "100000000"; // 0.1 SOL
const taker = "CdbFf2sQtfop2bqhX62b9NqaoSa13UP7VKDKzW81sYr7"; // Ваш wallet

const url = `${JUPITER_ULTRA_API}/order?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${amount}&taker=${taker}`;

console.log("Testing Jupiter Ultra API...");
console.log("URL:", url);
console.log("");

fetch(url, {
  headers: {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "x-api-key": "efe1c0c0-5690-48d2-a7f3-c74d438b58d0"
  },
  timeout: 10000
})
  .then(res => {
    console.log("Status:", res.status);
    console.log("OK:", res.ok);
    return res.json();
  })
  .then(data => {
    console.log("");
    console.log("✅ Success!");
    console.log("Response:", JSON.stringify(data, null, 2));
    
    if (data.outAmount) {
      console.log("");
      console.log("Output amount:", data.outAmount);
      console.log("In USDC:", (data.outAmount / 1000000).toFixed(2));
    }
  })
  .catch(err => {
    console.error("");
    console.error("❌ Error:", err.message);
    console.error("Type:", err.type || err.code);
  });
