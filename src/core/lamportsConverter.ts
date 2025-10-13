import fs from 'fs';

interface TokenInfo {
  mint: string;
  symbol: string;
  decimals: number;
}

const TOKENS_FILE = './data/tokens.json';

function getDecimalsFromFile(mintAddress: string): number {
  const tokens: TokenInfo[] = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
  const token = tokens.find(t => t.mint === mintAddress);
  if (!token) throw new Error('Token not found in tokens.json: ' + mintAddress);
  return token.decimals;
}

export function toLamports(amount: number, mintAddress: string): number {
  const decimals = getDecimalsFromFile(mintAddress);
  return amount * Math.pow(10, decimals);
}
