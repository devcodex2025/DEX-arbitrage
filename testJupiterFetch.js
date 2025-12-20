// Тест з node-fetch
import fetch from "node-fetch";

const url = "https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=100000000&slippageBps=50";

console.log("Testing Jupiter API with node-fetch...");
console.log("URL:", url);

fetch(url)
  .then(res => {
    console.log("Status:", res.status);
    console.log("OK:", res.ok);
    return res.json();
  })
  .then(data => {
    console.log("✅ Success! Output amount:", data.outAmount);
    console.log("Routes found:", data.routePlan?.length || 0);
  })
  .catch(err => {
    console.error("❌ Error:", err.message);
    console.error("Full error:", err);
  });
