import fs from "fs";
import fetch from "node-fetch";

const TOKENS = JSON.parse(fs.readFileSync("./tokens.json", "utf8"));
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OUTPUT_FILE = "meteora_pair_addresses.json";

async function fetchPairs() {
    try {
        const url = `https://dlmm-api.meteora.ag/pair/all_by_groups?include_token_mints=${USDC_MINT}`;
        const res = await fetch(url);
        const data = await res.json();
        console.log(`Fetched ${data.groups.length} groups`);
        return data.groups || [];
    } catch (err) {
        console.error("Error fetching Meteora pairs:", err.message);
        return [];
    }
}

function filterPairAddresses(groups) {
    const tokenMints = TOKENS.map(t => t.mint);
    const addresses = {};

    groups.forEach(group => {
        group.pairs.forEach(pair => {
            // перевіряємо чи є пара з токеном з tokens.json і USDC
            if ((tokenMints.includes(pair.mint_x) && pair.mint_y === USDC_MINT) ||
                (tokenMints.includes(pair.mint_y) && pair.mint_x === USDC_MINT)) {
                
                // формуємо ключ у форматі TOKEN/USDC
                const tokenName = pair.mint_x === USDC_MINT ? `${pair.name.split('-')[1]}/USDC` : pair.name;
                addresses[tokenName] = pair.address;
            }
        });
    });

    return addresses;
}

async function main() {
    console.log("Fetching Meteora pairs with USDC...");
    const groups = await fetchPairs();

    const addresses = filterPairAddresses(groups);
    console.log(`Pairs matched with tokens.json: ${Object.keys(addresses).length}`);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(addresses, null, 2));
    console.log(`Saved addresses to ${OUTPUT_FILE}`);
}

main();
