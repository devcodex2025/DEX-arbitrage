// Отримуємо актуальну ціну токена на Meteora
export async function getMeteoraPrice(tokenMint, baseMint) {
    try {
        // 1. Отримуємо всі групи пар, щоб знайти адресу потрібної пари
        const listUrl = `https://dlmm-api.meteora.ag/pair/all_by_groups?include_token_mints=${baseMint}`;
        const listRes = await fetch(listUrl);
        const listData = await listRes.json();

        if (!listData.groups || listData.groups.length === 0) {
            console.log(`No Meteora groups found for base mint ${baseMint}`);
            return null;
        }

        let pairAddress = null;

        for (const group of listData.groups) {
            if (!group.pairs) continue;
            for (const pair of group.pairs) {
                if (
                    (pair.mint_x === tokenMint && pair.mint_y === baseMint) ||
                    (pair.mint_y === tokenMint && pair.mint_x === baseMint)
                ) {
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

        // 2. Отримуємо поточну ціну пари з endpoint /pair/{pair_address}
        const pairUrl = `https://dlmm-api.meteora.ag/pair/${pairAddress}`;
        const pairRes = await fetch(pairUrl);
        const pairData = await pairRes.json();

        if (!pairData || !pairData.current_price) {
            console.log(`Meteora price not available for pair ${pairAddress}`);
            return null;
        }

        return pairData.current_price;
    } catch (err) {
        console.error("Error fetching Meteora price:", err.message);
        return null;
    }
}

// ======= ФУНКЦІЯ: Зворотний свап через Meteora у Lamports =======
export async function getMeteoraQuote(tokenMint, amountLamports) {
    const priceLamports = await getMeteoraPrice(tokenMint, BASE_TOKEN_MINT);
    if (!priceLamports) return null;
    return amountLamports * priceLamports;
}