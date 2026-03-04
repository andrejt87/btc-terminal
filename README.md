# BTC Bloomberg Terminal

Ein professionelles Bitcoin-Terminal im Bloomberg-Style — gebaut als reine Client-Side-Webanwendung mit CGI-Proxy-Backend.

![Terminal](https://img.shields.io/badge/BTC-Terminal-f59e0b?style=for-the-badge&logo=bitcoin&logoColor=white)

## Features

- **Live-Kurschart** mit TradingView Lightweight Charts (EMA, Bollinger, VWAP)
- **Orderbuch** (Binance L2 Depth)
- **Watchlist** mit Altcoin-Vergleich
- **Polymarket Wetten** — Live-Quoten zu Bitcoin-Prediction-Markets
- **BTC Up/Down 5min** — Sekündliches Update mit Referenzpreis-Lock
- **Derivate-Panel** — Funding Rate, Open Interest, Liquidationen, Options-Skew
- **On-Chain-Daten** — Mempool, Fees, Hashrate, UTXO-Set
- **Makro-Indikatoren** — Fear & Greed, DXY, Gold, Stablecoin-Marktanteile
- **Volatilitäts-Panel** — IV Rank, HV vs. IV, Terme-Struktur
- **Event-Kalender** — Makro- & Krypto-Events mit Impact-Rating
- **Address Inspector** — BTC-Adress-Lookup mit TX-Historie
- **Notebook/Blotter** — Trade-Notizen mit Tags & CSV-Export
- **News-Feed** — Aggregierte Krypto-News via RSS-Proxy
- **KPI-Leiste** — Market Cap, Volume, Dominance, Supply

## Tech-Stack

| Komponente | Technologie |
|---|---|
| Frontend | Vanilla HTML/CSS/JS |
| Charts | TradingView Lightweight Charts v4.1.1 |
| Fonts | JetBrains Mono, Inter |
| APIs | Binance, CoinGecko, Deribit, OKX, mempool.space, Polymarket, alternative.me |
| Backend | Python CGI-Proxy-Skripte |
| Design | OLED-optimiertes Dark Theme (#0A0E17) |

## Projekt-Struktur

```
btc-terminal/
├── index.html          # Haupt-Terminal
├── info.html           # Glossar & Erklärungen
├── base.css            # CSS-Variablen & Reset
├── style.css           # Vollständiges Styling
├── app.js              # Gesamte Terminal-Logik
├── cgi-bin/
│   ├── news.py         # RSS-News-Aggregator
│   ├── polymarket.py   # Polymarket CLOB/Gamma Proxy
│   ├── updown.py       # BTC Up/Down 5min mit Ref-Lock
│   ├── derivatives.py  # Derivate-Daten (Binance, Deribit, OKX)
│   ├── onchain.py      # On-Chain-Metriken (mempool.space)
│   ├── macro.py        # Makro-Indikatoren
│   ├── volatility.py   # Volatilitäts-Daten
│   ├── btc_calendar.py # Event-Kalender
│   └── address.py      # Address Inspector
├── docs/
│   ├── pflichtenheft.md        # V-Modell Pflichtenheft
│   └── v-modell-dokumentation.md  # Implementierungsdoku
└── README.md
```

## Entwicklung nach V-Modell

Das Projekt wurde nach dem V-Modell entwickelt:
1. **Pflichtenheft** mit 20+ funktionalen Anforderungen
2. **Schrittweise Umsetzung** jeder Anforderung
3. **Dokumentation** jedes Implementierungsschritts

Details in `docs/pflichtenheft.md` und `docs/v-modell-dokumentation.md`.

## Lizenz

Private Nutzung.
