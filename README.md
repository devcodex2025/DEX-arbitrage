# DEX Arbitrage Scanner

This scanner compare prices on 2 DEXes - Jupiter and Meteora. Automatically created tokens list, using Jupiter API. 
Supports forward and reverse swap, Jupiter → Meteora and Meteora → Jupiter. Table with results saving in excel file format.
You can easily read results after scanning.

To start using application you need to fill .env configuration file with constants, what present in .env.example

Install depencies with ```npm i``` command and if you not have tsx, you also need to install tsx to run typescript file

To launch scanner you need to have tokens list. I prepare for it command. To make it automatically.
To run token creation you need to use command - ```npx tsx ./utils/generateTokens.ts top``` to get top 100 most tradable tokens or ```npx tsx ./utils/generateTokens.ts all``` to get all tokens

Once you create, you can start scanning.
Command to start scanning - ```npx tsx ./arbScanner.ts```

All results of price comparing will be store after scanning completion in folder - data/results. You can open results with Microsoft Excel application.