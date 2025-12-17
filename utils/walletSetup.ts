import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import * as readline from "readline";

// Утиліта для роботи з гаманцями Solana

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

console.log("🔐 Solana Wallet Utility\n");
console.log("ВАЖЛИВО: Ніколи не діліться приватним ключем!");
console.log("=".repeat(60) + "\n");

async function main() {
  console.log("Оберіть опцію:");
  console.log("1. Створити новий гаманець");
  console.log("2. Імпортувати існуючий гаманець (JSON keypair)");
  console.log("3. Конвертувати приватний ключ у Base58");
  console.log("4. Вийти\n");

  const choice = await question("Ваш вибір (1-4): ");

  switch (choice) {
    case "1":
      await createNewWallet();
      break;
    case "2":
      await importFromJSON();
      break;
    case "3":
      await convertToBase58();
      break;
    case "4":
      console.log("👋 До побачення!");
      rl.close();
      return;
    default:
      console.log("❌ Невірний вибір");
      rl.close();
      return;
  }

  rl.close();
}

// Створення нового гаманця
async function createNewWallet() {
  console.log("\n🆕 Створення нового гаманця...\n");
  
  const keypair = Keypair.generate();
  const publicKey = keypair.publicKey.toString();
  const privateKeyBase58 = bs58.encode(keypair.secretKey);
  
  console.log("✅ Гаманець створено!");
  console.log("=".repeat(60));
  console.log(`Публічний адрес: ${publicKey}`);
  console.log(`Приватний ключ (Base58): ${privateKeyBase58}`);
  console.log("=".repeat(60));
  
  console.log("\n⚠️  ВАЖЛИВО:");
  console.log("1. Збережіть приватний ключ у безпечному місці");
  console.log("2. НІКОЛИ не діліться ним з іншими");
  console.log("3. Додайте його в .env файл як PRIVATE_KEY=...");
  console.log("4. Поповніть адресу SOL перед використанням\n");
  
  const save = await question("Зберегти у файл wallet-backup.json? (yes/no): ");
  
  if (save.toLowerCase() === "yes" || save.toLowerCase() === "y") {
    const backup = {
      publicKey,
      privateKeyBase58,
      secretKey: Array.from(keypair.secretKey),
      warning: "⚠️ НЕ ДІЛІТЬСЯ ЦИМ ФАЙЛОМ! Видаліть після копіювання ключа в .env"
    };
    
    fs.writeFileSync("wallet-backup.json", JSON.stringify(backup, null, 2));
    console.log("✅ Збережено у wallet-backup.json");
    console.log("⚠️  Не забудьте видалити цей файл після копіювання ключа!");
  }
}

// Імпорт з JSON файлу
async function importFromJSON() {
  console.log("\n📥 Імпорт гаманця з JSON...\n");
  
  const filePath = await question("Шлях до JSON файлу (наприклад, ~/.config/solana/id.json): ");
  
  try {
    const data = fs.readFileSync(filePath.trim(), "utf-8");
    const secretKey = new Uint8Array(JSON.parse(data));
    const keypair = Keypair.fromSecretKey(secretKey);
    
    const publicKey = keypair.publicKey.toString();
    const privateKeyBase58 = bs58.encode(keypair.secretKey);
    
    console.log("\n✅ Гаманець імпортовано!");
    console.log("=".repeat(60));
    console.log(`Публічний адрес: ${publicKey}`);
    console.log(`Приватний ключ (Base58): ${privateKeyBase58}`);
    console.log("=".repeat(60));
    
    console.log("\n💡 Додайте цей рядок у ваш .env файл:");
    console.log(`PRIVATE_KEY=${privateKeyBase58}\n`);
    
  } catch (err: any) {
    console.error("❌ Помилка:", err.message);
  }
}

// Конвертація у Base58
async function convertToBase58() {
  console.log("\n🔄 Конвертація у Base58...\n");
  console.log("Введіть приватний ключ у форматі:");
  console.log("- JSON array: [1,2,3,...] ");
  console.log("- Hex string: 0x1234abcd...");
  console.log("- або натисніть Enter щоб завантажити з файлу\n");
  
  const input = await question("Приватний ключ: ");
  
  try {
    let secretKey: Uint8Array;
    
    if (!input.trim()) {
      // Завантаження з файлу
      const filePath = await question("Шлях до файлу: ");
      const data = fs.readFileSync(filePath.trim(), "utf-8");
      secretKey = new Uint8Array(JSON.parse(data));
    } else if (input.startsWith("[")) {
      // JSON array
      secretKey = new Uint8Array(JSON.parse(input));
    } else if (input.startsWith("0x")) {
      // Hex string
      const hex = input.slice(2);
      secretKey = new Uint8Array(Buffer.from(hex, "hex"));
    } else {
      console.log("❌ Невірний формат");
      return;
    }
    
    const keypair = Keypair.fromSecretKey(secretKey);
    const publicKey = keypair.publicKey.toString();
    const privateKeyBase58 = bs58.encode(keypair.secretKey);
    
    console.log("\n✅ Конвертовано!");
    console.log("=".repeat(60));
    console.log(`Публічний адрес: ${publicKey}`);
    console.log(`Приватний ключ (Base58): ${privateKeyBase58}`);
    console.log("=".repeat(60));
    
    console.log("\n💡 Додайте у .env:");
    console.log(`PRIVATE_KEY=${privateKeyBase58}\n`);
    
  } catch (err: any) {
    console.error("❌ Помилка:", err.message);
  }
}

main();
