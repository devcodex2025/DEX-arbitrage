# Проблема з DNS для Jupiter API

## Проблема
Ваша система не може розв'язати DNS для `quote-api.jup.ag`:
```
Error: getaddrinfo ENOTFOUND quote-api.jup.ag
```

## Причини:
1. **Локальний DNS провайдер** не може знайти домен
2. **Firewall/Антивірус** блокує запити
3. **ISP блокування** (деякі провайдери блокують crypto домени)

## ✅ РІШЕННЯ 1: Змінити DNS (РЕКОМЕНДОВАНО)

### Windows:
1. Відкрийте **Settings** → **Network & Internet** → **Change adapter options**
2. Right-click на вашому адаптері → **Properties**
3. Select **Internet Protocol Version 4 (TCP/IPv4)** → **Properties**
4. Select **Use the following DNS server addresses:**
   - **Preferred DNS:** `8.8.8.8` (Google)
   - **Alternate DNS:** `1.1.1.1` (Cloudflare)
5. Click **OK** і перезавантажте мережевий адаптер

Або через PowerShell (як адміністратор):
```powershell
# Дізнатися назву інтерфейсу
Get-NetAdapter

# Встановити DNS (замініть "Ethernet" на вашу назву)
Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ServerAddresses ("8.8.8.8","1.1.1.1")
```

## ✅ РІШЕННЯ 2: Використати VPN
Деякі ISP блокують crypto-related домени. Використайте VPN для обходу.

## ✅ РІШЕННЯ 3: Додати в hosts file (ТИМЧАСОВО)
```powershell
# Як адміністратор
Add-Content C:\Windows\System32\drivers\etc\hosts "`n104.26.13.173 quote-api.jup.ag"
```

## ✅ РІШЕННЯ 4: Використати проксі
Запускайте Node.js через проксі:
```powershell
$env:HTTP_PROXY="http://your-proxy:port"
$env:HTTPS_PROXY="http://your-proxy:port"
node test Jupiter.js
```

## 🔄 ОБХІДНИЙ ШЛЯХ: Використати тільки Meteora (БЕЗ Jupiter)
Можна сканувати тільки Meteora pools без Jupiter API.

