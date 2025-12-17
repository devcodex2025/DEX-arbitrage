import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";

console.log("🔐 Генерація нового Solana гаманця для бота\n");
console.log("=".repeat(70) + "\n");

// Створюємо новий гаманець
const keypair = Keypair.generate();
const publicKey = keypair.publicKey.toString();
const privateKeyBase58 = bs58.encode(keypair.secretKey);

console.log("✅ Гаманець успішно створено!\n");
console.log("=".repeat(70));
console.log(`📍 Публічна адреса (для поповнення):`);
console.log(`   ${publicKey}\n`);
console.log(`🔑 Приватний ключ (Base58 формат):`);
console.log(`   ${privateKeyBase58}`);
console.log("=".repeat(70) + "\n");

// Зберігаємо backup
const backup = {
  timestamp: new Date().toISOString(),
  publicKey,
  privateKeyBase58,
  secretKeyArray: Array.from(keypair.secretKey),
  warning: "⚠️ НЕ ДІЛІТЬСЯ ЦИМ ФАЙЛОМ! Видаліть після копіювання ключа в .env"
};

fs.writeFileSync("wallet-backup.json", JSON.stringify(backup, null, 2));

console.log("💾 Резервна копія збережена у: wallet-backup.json");
console.log("⚠️  Видаліть цей файл після копіювання ключа!\n");

console.log("📋 НАСТУПНІ КРОКИ:\n");
console.log("1️⃣  Додайте у Config/.env файл:");
console.log(`    PRIVATE_KEY=${privateKeyBase58}\n`);

console.log("2️⃣  Поповніть гаманець SOL:");
console.log(`    Адреса: ${publicKey}`);
console.log("    Мінімум: 0.1 SOL для тестів\n");

console.log("3️⃣  Налаштуйте параметри бота у arbBotOptimized.ts:");
console.log("    const DRY_RUN = true;  // Почніть з симуляції!");
console.log("    const MIN_PROFIT_PERCENT = 5;  // Високий поріг\n");

console.log("4️⃣  Запустіть тест:");
console.log("    npx tsx ./arbBotOptimized.ts\n");

console.log("=".repeat(70));
console.log("⚠️  БЕЗПЕКА:");
console.log("   • НЕ комітьте .env файл у git");
console.log("   • НЕ діліться приватним ключем");
console.log("   • Використовуйте окремий гаманець для бота");
console.log("   • Починайте з малих сум (0.1-0.5 SOL)");
console.log("=".repeat(70) + "\n");

console.log("✅ Готово! Дотримуйтесь інструкцій вище для налаштування.\n");
