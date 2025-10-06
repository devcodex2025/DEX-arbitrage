import fs from "fs";
import fetch from "node-fetch";

async function fetchTopTokens() {
  try {
    const tag = "verified";
    const url = `https://lite-api.jup.ag/tokens/v2/tag?query=${tag}`;
    const res = await fetch(url);
    const tokensArray = await res.json(); // тут сам масив

    const tokens = tokensArray.map(t => ({
      symbol: t.symbol,
      mint: t.id,       // у відповіді "id" – це mint
      decimals: t.decimals || 0
    }));

    fs.writeFileSync("./data/tokens.json", JSON.stringify(tokens, null, 2));
    console.log(`Saved ${tokens.length} top tokens to tokens.json`);
  } catch (err) {
    console.error("Error fetching top tokens:", err.message);
  }
}

fetchTopTokens();
