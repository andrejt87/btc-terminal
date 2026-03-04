# Pflichtenheft: BTC Bloomberg Terminal (Web)

**Projekt:** BTC Bloomberg Terminal  
**Version:** 1.0.0  
**Datum:** 01.03.2026  
**Autor:** Computer  
**Auftraggeber:** Andrej Tupikin  
**Vorgehensmodell:** V-Modell  

---

## 1. Zielbestimmung

### 1.1 Produktvision
Eine webbasierte, Bloomberg-Terminal-ähnliche Oberfläche für Bitcoin-Marktdaten. Das System aggregiert Echtzeit-Preis-, Volumen-, Orderbuch- und Nachrichtendaten und stellt diese in einem professionellen, datenreichen Dashboard dar — inspiriert vom Bloomberg Terminal.

### 1.2 Zielgruppe
- Krypto-Trader und -Analysten
- Finanz-Enthusiasten mit Interesse an professionellen Marktdaten-Interfaces
- Entwickler/Designer als Referenz für datenintensive Dashboard-Architektur

### 1.3 Nutzungskontext
- Desktop-Browser (primär)
- Tablet (sekundär)
- Permanente Internetverbindung erforderlich (Live-Daten)
- Keine Authentifizierung erforderlich

### 1.4 Abgrenzung (Out of Scope)
- Kein echtes Trading / Order-Execution
- Keine Portfolio-Verwaltung
- Keine Benutzerverwaltung oder Login
- Keine Backend-Infrastruktur (rein clientseitig)
- Keine historische Datenbank-Persistenz

---

## 2. Produktfunktionen (Funktionale Anforderungen)

### F01: Dashboard-Layout
| Feld | Beschreibung |
|------|-------------|
| **ID** | F01 |
| **Name** | Bloomberg-Grid-Layout |
| **Nutzen** | Professionelles, Bloomberg-typisches Multi-Panel-Layout |
| **Beschreibung** | Full-Viewport Dashboard mit Sidebar-Navigation, Header mit Ticker, und einem flexiblen Grid-Hauptbereich mit resizebaren Panels |
| **Eingaben** | Keine (statisches Layout) |
| **Ausgaben** | Gerenderte Multi-Panel-Ansicht |
| **Akzeptanzkriterium** | Layout füllt 100dvh, kein Body-Scroll, Sidebar + Header sticky |

### F02: Live-Preisdaten (BTC/USD)
| Feld | Beschreibung |
|------|-------------|
| **ID** | F02 |
| **Name** | Echtzeit-Preis-Feed |
| **Nutzen** | Aktuelle BTC-Kurse ohne manuelles Refresh |
| **Beschreibung** | WebSocket-Verbindung zu Binance oder CoinGecko für Live-Tick-Daten. Anzeige: Last Price, 24h Change (%), 24h High/Low, Volume |
| **Eingaben** | WebSocket-Stream |
| **Ausgaben** | Animierte Preisanzeige mit Farbkodierung (grün/rot) |
| **Akzeptanzkriterium** | Preisupdate < 2s Latenz, Farbwechsel bei Preisänderung, Reconnect bei Verbindungsabbruch |

### F03: Interaktiver Candlestick-Chart
| Feld | Beschreibung |
|------|-------------|
| **ID** | F03 |
| **Name** | Candlestick-Preischart |
| **Nutzen** | Visuelle Kursanalyse mit professionellen Charting-Tools |
| **Beschreibung** | Candlestick-Chart mit Zeitintervall-Auswahl (1m, 5m, 15m, 1h, 4h, 1D, 1W). Zoom, Pan, Crosshair mit Preis/Zeit-Labels. Volumen-Overlay am unteren Rand |
| **Eingaben** | Historische OHLCV-Daten via REST API (Binance) |
| **Ausgaben** | Interaktiver Chart mit Candlesticks + Volumen |
| **Akzeptanzkriterium** | Mindestens 200 Candles sichtbar, flüssiges Zoom/Pan, Crosshair zeigt exakte Werte |

### F04: Orderbuch-Visualisierung
| Feld | Beschreibung |
|------|-------------|
| **ID** | F04 |
| **Name** | Depth-of-Market / Orderbuch |
| **Nutzen** | Einsicht in Liquidität und Markttiefe |
| **Beschreibung** | Live-Orderbuch mit Bid/Ask-Seiten, Depth-Bars, kumulative Volumen-Anzeige. Farbkodiert (grün = Bids, rot = Asks) |
| **Eingaben** | Orderbuch-Snapshot + WebSocket-Updates |
| **Ausgaben** | Tabellarische + grafische Orderbuch-Darstellung |
| **Akzeptanzkriterium** | Top 15 Levels je Seite, Spread-Anzeige, Updates in Echtzeit |

### F05: Marktstatistiken & KPIs
| Feld | Beschreibung |
|------|-------------|
| **ID** | F05 |
| **Name** | Market Overview KPI-Cards |
| **Nutzen** | Schneller Überblick über zentrale Marktmetriken |
| **Beschreibung** | KPI-Karten: Market Cap, 24h Volume, Dominance, Fear & Greed Index, Funding Rate, Open Interest. Animierte Zahlenübergänge |
| **Eingaben** | REST API (CoinGecko / Alternative.me) |
| **Ausgaben** | 6 KPI-Karten mit Delta-Indikatoren |
| **Akzeptanzkriterium** | Alle 6 KPIs sichtbar, animierte Count-Up/Down, Delta-Pfeile |

### F06: Ticker-Newsband
| Feld | Beschreibung |
|------|-------------|
| **ID** | F06 |
| **Name** | Bloomberg-Style News-Ticker |
| **Nutzen** | Laufende Markt-Headlines im Terminal-Stil |
| **Beschreibung** | Horizontal scrollendes Nachrichtenband im Header. Quelle: CryptoCompare News API oder statische simulierte Headlines. Orange Text auf schwarzem Hintergrund (Bloomberg-typisch) |
| **Eingaben** | News-API oder simulierte Daten |
| **Ausgaben** | Animiertes Ticker-Band |
| **Akzeptanzkriterium** | Flüssige Endlos-Scroll-Animation, Lesbare Geschwindigkeit, Hover pausiert |

### F07: Watchlist
| Feld | Beschreibung |
|------|-------------|
| **ID** | F07 |
| **Name** | Krypto-Watchlist |
| **Nutzen** | Überwachung mehrerer Krypto-Assets gleichzeitig |
| **Beschreibung** | Tabellarische Watchlist mit BTC, ETH, SOL, BNB, XRP, ADA, DOGE, DOT. Spalten: Symbol, Preis, 24h%, Sparkline, Volume |
| **Eingaben** | REST API (CoinGecko) |
| **Ausgaben** | Sortierbare Tabelle mit Sparklines |
| **Akzeptanzkriterium** | 8+ Assets, sortierbar nach jeder Spalte, Sparklines rendern korrekt |

### F08: Terminal-Kommandozeile
| Feld | Beschreibung |
|------|-------------|
| **ID** | F08 |
| **Name** | Bloomberg-Style Command Input |
| **Nutzen** | Schnelle Navigation und Datenabfrage per Tastatur |
| **Beschreibung** | Eingabefeld im Header oder Footer im Stil des Bloomberg-Terminals. Unterstützte Befehle: `BTC <GO>` (zeigt Bitcoin), `ETH <GO>` (wechselt zu ETH-Daten), `NEWS <GO>`, `HELP <GO>`. Autocomplete-Dropdown |
| **Eingaben** | Tastatureingabe |
| **Ausgaben** | Kontextabhängige Aktion |
| **Akzeptanzkriterium** | Mindestens 5 Befehle, Autocomplete funktioniert, Enter/GO löst Aktion aus |

### F09: Technische Indikatoren
| Feld | Beschreibung |
|------|-------------|
| **ID** | F09 |
| **Name** | Chart-Indikatoren (SMA, EMA, RSI, MACD) |
| **Nutzen** | Technische Analyse direkt im Chart |
| **Beschreibung** | Toggle-Buttons für Overlay-Indikatoren: SMA(20), SMA(50), EMA(12), EMA(26). Separate Sub-Charts: RSI(14), MACD(12,26,9) |
| **Eingaben** | OHLCV-Daten (bereits geladen) |
| **Ausgaben** | Indikator-Linien/-Flächen im Chart |
| **Akzeptanzkriterium** | SMA/EMA als Overlay, RSI/MACD als Sub-Chart, korrekte Berechnung verifizierbar |

### F10: Responsive Design & Dark Mode
| Feld | Beschreibung |
|------|-------------|
| **ID** | F10 |
| **Name** | Responsive Terminal mit Dark Mode |
| **Nutzen** | Nutzbar auf verschiedenen Bildschirmgrößen, augenschonend |
| **Beschreibung** | Standard: Dark Mode (Bloomberg-typisch schwarz/dunkelblau mit oranger Akzentfarbe). Light Mode als Option. Responsive Breakpoints: ≥1200px (volles Grid), 768-1199px (2-Spalten), <768px (Single Column, gestapelt) |
| **Eingaben** | Viewport-Größe, User-Preference |
| **Ausgaben** | Adaptiertes Layout |
| **Akzeptanzkriterium** | Lesbar ab 768px, alle Panels zugänglich, Farbkontrast WCAG AA |

---

## 3. Nichtfunktionale Anforderungen

### NF01: Performance
- Initiales Laden < 3 Sekunden
- Chart-Rendering < 500ms
- WebSocket-Reconnect < 5 Sekunden
- Flüssige 60fps Animationen

### NF02: Zuverlässigkeit
- Graceful Degradation bei API-Ausfall (Fehlermeldung, kein Crash)
- WebSocket Auto-Reconnect mit Exponential Backoff
- Skeleton-Loader während Datenladung

### NF03: Usability
- Bloomberg-typische Farbsprache (Orange/Amber Akzente auf Schwarz)
- Tabular Nums für alle Zahlen
- Monospace-Font für Terminal-Elemente
- Keyboard-Navigation unterstützt

### NF04: Technische Rahmenbedingungen
- Rein clientseitig (HTML/CSS/JS)
- Keine Build-Tools erforderlich
- CDN für alle Libraries
- Kein localStorage (Sandbox-Beschränkung)
- APIs: Binance (WebSocket + REST), CoinGecko (REST)

---

## 4. V-Modell Zuordnung

### Linke Seite (Entwurf & Implementierung)
| Phase | Artefakt |
|-------|---------|
| Systemanforderungen | Dieses Pflichtenheft (F01-F10, NF01-NF04) |
| Architekturkonzept | Single-Page Dashboard, modularer JS-Aufbau |
| Modulkonzept | Separate Module: DataService, ChartEngine, OrderBook, Watchlist, Terminal, NewsService |
| UI-Flow | Statische SPA mit Panel-basiertem Layout |
| Implementierung | Schrittweise Umsetzung F01→F10 |

### Rechte Seite (Verifikation & Validierung)
| Phase | Test |
|-------|------|
| Unit-Test | Indikator-Berechnungen (SMA, EMA, RSI, MACD) |
| Integrationstest | WebSocket-Verbindung + UI-Update-Pipeline |
| Systemtest | Alle Panels laden, reagieren auf Daten, responsive |
| Abnahmetest | Visueller Vergleich mit Bloomberg Terminal |
| UX-Test | Lesbarkeit, Kontrast, Interaktionsqualität |

---

## 5. Traceability-Matrix

| Req | Beschreibung | Testfall |
|-----|-------------|---------|
| F01 | Dashboard-Layout | T01: Layout füllt Viewport, kein Body-Scroll |
| F02 | Live-Preisdaten | T02: WebSocket verbindet, Preis aktualisiert |
| F03 | Candlestick-Chart | T03: Chart rendert, Zoom/Pan funktioniert |
| F04 | Orderbuch | T04: Bids/Asks angezeigt, Live-Updates |
| F05 | KPI-Cards | T05: 6 KPIs sichtbar, animiert |
| F06 | News-Ticker | T06: Ticker scrollt, pausiert bei Hover |
| F07 | Watchlist | T07: 8+ Assets, sortierbar |
| F08 | Terminal-CMD | T08: Befehle ausführbar, Autocomplete |
| F09 | Indikatoren | T09: SMA/EMA Overlay, RSI/MACD Sub-Chart |
| F10 | Responsive/Dark | T10: Layout passt sich an, Farbwechsel |
| NF01 | Performance | T11: Ladezeit < 3s |
| NF02 | Zuverlässigkeit | T12: Reconnect nach Disconnect |
| NF03 | Usability | T13: Kontrast WCAG AA |
| NF04 | Tech. Rahmen | T14: Nur CDN, kein Build |

---

## 6. Risikoanalyse

| # | Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|---|--------|-------------------|--------|------------|
| R1 | Binance API Rate-Limit | Mittel | Hoch | Fallback auf CoinGecko, Caching |
| R2 | WebSocket-Instabilität | Mittel | Mittel | Auto-Reconnect, Heartbeat |
| R3 | CORS-Blockade | Hoch | Hoch | Proxy-freie APIs verwenden (Binance erlaubt CORS) |
| R4 | Chart-Performance bei vielen Candles | Niedrig | Mittel | Canvas-basiertes Rendering, Datenpunkte limitieren |
| R5 | API-Verfügbarkeit | Niedrig | Hoch | Simulierte Fallback-Daten |

---

**Pflichtenheft genehmigt und bereit zur Umsetzung.**
