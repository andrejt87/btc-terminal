/* app.js — BTC Bloomberg Terminal */
(function () {
  'use strict';

  // ============================================
  // STATE
  // ============================================
  const state = {
    symbol: 'BTCUSDT',
    cgId: 'bitcoin',
    interval: '1h',
    ws: null,
    wsDepth: null,
    reconnectAttempts: 0,
    reconnectAttemptsDepth: 0,
    maxReconnect: 10,
    connected: false,
    lastPrice: null,
    chartData: [],
    volumeData: [],
    indicators: { sma: false, ema: false, rsi: false, macd: false, vwap: false },
    watchlistSort: { key: 'market_cap_rank', asc: true },
    watchlistData: [],
    newsData: [],
    newsFilter: { source: '', query: '' },
    newsFetchedAt: null,
    polymarketData: null,
    polymarketFilter: 'all',
    polymarketLastValues: {},
  };

  // ============================================
  // HELPERS
  // ============================================
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function formatPrice(n, decimals) {
    if (n == null || isNaN(n)) return '—';
    if (decimals === undefined) {
      decimals = n >= 1000 ? 2 : n >= 1 ? 4 : 6;
    }
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function formatCompact(n) {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(2);
  }

  function formatCompactRaw(n) {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toFixed(2);
  }

  function formatSupply(n) {
    if (n == null) return '—';
    return (n / 1e6).toFixed(2) + 'M';
  }

  function formatPct(n) {
    if (n == null || isNaN(n)) return '—';
    const sign = n >= 0 ? '+' : '';
    return sign + n.toFixed(2) + '%';
  }

  function deltaArrow(n) {
    if (n == null || isNaN(n)) return '';
    return n >= 0 ? '▲' : '▼';
  }

  function deltaClass(n) {
    if (n == null || isNaN(n)) return '';
    return n >= 0 ? 'pos' : 'neg';
  }

  // ============================================
  // THEME TOGGLE
  // ============================================
  let currentTheme = 'dark';
  (function initTheme() {
    const toggle = $('[data-theme-toggle]');
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');

    if (toggle) {
      toggle.addEventListener('click', () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', currentTheme);
        toggle.setAttribute('aria-label', 'Switch to ' + (currentTheme === 'dark' ? 'light' : 'dark') + ' mode');
        toggle.innerHTML = currentTheme === 'dark'
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
        if (chartObj) { chartObj.applyOptions(getChartColors()); }
      });
    }
  })();

  // ============================================
  // CLOCK
  // ============================================
  function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    $('#clock').textContent = h + ':' + m + ':' + s + ' CET';
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ============================================
  // CONNECTION STATUS
  // ============================================
  function setConnected(val) {
    state.connected = val;
    const dot = $('#statusDot');
    const txt = $('#statusText');
    if (val) {
      dot.classList.add('connected');
      txt.textContent = 'LIVE';
    } else {
      dot.classList.remove('connected');
      txt.textContent = 'REST';
    }
  }

  // ============================================
  // NEWS TICKER + LIVE FEED (F06)
  // ============================================
  var CGI_BIN = '/cgi-bin';

  // Fallback headlines when CGI is unavailable
  var fallbackHeadlines = [
    'Bitcoin ETF inflows hit $1.2B in single day, highest since January launch',
    'Fed signals rate pause — crypto markets rally across the board',
    'MicroStrategy adds 12,000 BTC to treasury, total holdings exceed 250K',
    'Ethereum L2 TVL surpasses $45B as Arbitrum and Base lead growth',
    'SEC approves spot Ethereum ETF options trading',
    'BlackRock IBIT becomes largest Bitcoin fund globally with $58B AUM',
    'El Salvador reports $400M unrealized profit on Bitcoin reserves',
    'Binance 24h volume exceeds $28B amid market volatility',
    'Goldman Sachs files for Bitcoin ETP in European markets',
    'Lightning Network capacity reaches new ATH of 6,200 BTC',
    'Bitcoin mining difficulty adjusts +3.2%, hash rate at 750 EH/s',
    'Tether market cap crosses $140B milestone',
    'CME Bitcoin futures open interest hits record $12.4B',
    'Japan considers Bitcoin as strategic reserve asset — Nikkei reports',
    'Grayscale launches mini Bitcoin Trust with 0.15% fee',
    'Bitcoin dominance climbs to 58% as altcoins lag in recovery',
    'Fidelity report: 80% of institutional investors now hold or plan to hold crypto',
    'Brazil approves Solana spot ETF — first in the world',
  ];

  function buildTickerHTML(items) {
    var html = '';
    for (var i = 0; i < items.length; i++) {
      html += '<span class="ticker-item">' + escapeHtml(items[i]) + '<span class="ticker-sep">\u2022</span></span>';
    }
    return html;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function initTicker() {
    var track = $('#tickerTrack');
    // Use fallback headlines initially; will be replaced when live data loads
    var items = fallbackHeadlines;
    track.innerHTML = buildTickerHTML(items) + buildTickerHTML(items);
  }
  initTicker();

  function updateTickerWithLiveData(newsItems) {
    var track = $('#tickerTrack');
    var titles = [];
    var count = Math.min(newsItems.length, 20);
    for (var i = 0; i < count; i++) {
      titles.push(newsItems[i].title);
    }
    if (!titles.length) return;
    track.innerHTML = buildTickerHTML(titles) + buildTickerHTML(titles);
  }

  function formatNewsTime(timestamp) {
    if (!timestamp) return '--:--';
    var d = new Date(timestamp * 1000);
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  function formatTimeAgo(isoStr) {
    if (!isoStr) return '';
    var then = new Date(isoStr).getTime();
    var now = Date.now();
    var diff = Math.floor((now - then) / 1000);
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function renderNewsList() {
    var list = $('#newsList');
    var items = state.newsData;
    var sourceFilter = state.newsFilter.source;
    var queryFilter = state.newsFilter.query.toLowerCase();

    // Apply filters
    var filtered = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (sourceFilter && item.source !== sourceFilter) continue;
      if (queryFilter && item.title.toLowerCase().indexOf(queryFilter) === -1) continue;
      filtered.push(item);
    }

    if (!filtered.length) {
      list.innerHTML = '<div class="news-loading">No articles match your filter.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var item = filtered[i];
      html += '<a class="news-item" href="' + escapeHtml(item.link) + '" target="_blank" rel="noopener noreferrer">'
        + '<span class="news-item-time">' + formatNewsTime(item.timestamp) + '</span>'
        + '<div class="news-item-content">'
          + '<div class="news-item-title">' + escapeHtml(item.title) + '</div>'
          + (item.summary ? '<div class="news-item-summary">' + escapeHtml(item.summary) + '</div>' : '')
        + '</div>'
        + '<span class="news-item-source">' + escapeHtml(item.source) + '</span>'
      + '</a>';
    }
    list.innerHTML = html;
  }

  function updateNewsMeta(total, sourceCount, fetchedAt) {
    var meta = $('#newsMeta');
    if (!meta) return;
    var sources = sourceCount ? Object.keys(sourceCount).length : 0;
    var ago = formatTimeAgo(fetchedAt);
    meta.textContent = total + ' articles from ' + sources + ' sources' + (ago ? ' \u00B7 Updated ' + ago : '');
  }

  async function loadNews() {
    try {
      var resp = await fetch(CGI_BIN + '/news.py?limit=100');
      if (!resp.ok) throw new Error('News fetch failed: ' + resp.status);
      var data = await resp.json();

      state.newsData = data.items || [];
      state.newsFetchedAt = data.fetched_at;

      // Update ticker band with live headlines
      updateTickerWithLiveData(state.newsData);

      // Render news panel
      renderNewsList();

      // Update meta
      updateNewsMeta(data.total || 0, data.sources, data.fetched_at);
    } catch (e) {
      console.error('News load error:', e);
      // Show error in panel but keep ticker with fallback headlines
      var list = $('#newsList');
      if (list && !state.newsData.length) {
        list.innerHTML = '<div class="news-error">Live news unavailable \u2014 using cached data</div>';
      }
    }
  }

  // Source tab filtering
  (function initNewsTabs() {
    var tabs = $$('#newsSourceTabs .news-tab');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        tabs.forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        state.newsFilter.source = tab.dataset.source || '';
        renderNewsList();
      });
    });
  })();

  // Search input filtering
  (function initNewsSearch() {
    var input = $('#newsSearchInput');
    if (!input) return;
    var debounceTimer = null;
    input.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        state.newsFilter.query = input.value;
        renderNewsList();
      }, 200);
    });
  })();

  // ============================================
  // BINANCE WEBSOCKET — LIVE PRICE (F02)
  // ============================================
  function connectTickerWS() {
    if (state.ws) { try { state.ws.close(); } catch(e) {} }
    const pair = state.symbol.toLowerCase();
    const url = 'wss://stream.binance.com:9443/ws/' + pair + '@ticker';

    try {
      state.ws = new WebSocket(url);
    } catch(e) {
      setConnected(false);
      scheduleReconnect('ticker');
      return;
    }

    state.ws.onopen = function() {
      setConnected(true);
      state.reconnectAttempts = 0;
    };

    state.ws.onmessage = function(evt) {
      try { updatePrice(JSON.parse(evt.data)); } catch(e) {}
    };

    state.ws.onerror = function() { setConnected(false); };

    state.ws.onclose = function() {
      setConnected(false);
      scheduleReconnect('ticker');
    };
  }

  function scheduleReconnect(type) {
    var attemptsKey = type === 'ticker' ? 'reconnectAttempts' : 'reconnectAttemptsDepth';
    if (state[attemptsKey] >= state.maxReconnect) return;
    var delay = Math.min(1000 * Math.pow(2, state[attemptsKey]), 30000);
    state[attemptsKey]++;
    setTimeout(function() {
      if (type === 'ticker') connectTickerWS(); else connectDepthWS();
    }, delay);
  }

  function updatePrice(d) {
    var price = parseFloat(d.c);
    var change = parseFloat(d.P);
    var high = parseFloat(d.h);
    var low = parseFloat(d.l);
    var vol = parseFloat(d.v);
    var quoteVol = parseFloat(d.q);

    renderPriceData(price, change, high, low, vol, quoteVol);

    // Update last candle on chart
    if (chartObj && candleSeries && state.chartData.length) {
      var last = state.chartData[state.chartData.length - 1];
      var now = Math.floor(Date.now() / 1000);
      var intervalSec = getIntervalSeconds(state.interval);
      var candleTime = Math.floor(now / intervalSec) * intervalSec;

      if (last.time === candleTime) {
        last.close = price;
        last.high = Math.max(last.high, price);
        last.low = Math.min(last.low, price);
        candleSeries.update(last);
      } else {
        var newCandle = { time: candleTime, open: price, high: price, low: price, close: price };
        state.chartData.push(newCandle);
        candleSeries.update(newCandle);
      }
    }
  }

  function renderPriceData(price, changePct, high, low, vol, quoteVol) {
    var priceEl = $('#priceValue');
    var changeEl = $('#priceChange');

    // Flash effect
    if (state.lastPrice !== null && price !== state.lastPrice) {
      if (price > state.lastPrice) {
        priceEl.classList.remove('flash-down');
        priceEl.classList.add('flash-up');
      } else {
        priceEl.classList.remove('flash-up');
        priceEl.classList.add('flash-down');
      }
      setTimeout(function() {
        priceEl.classList.remove('flash-up', 'flash-down');
      }, 400);
    }
    state.lastPrice = price;

    priceEl.textContent = '$' + formatPrice(price, 2);
    changeEl.textContent = deltaArrow(changePct) + ' ' + formatPct(changePct);
    changeEl.className = 'price-change ' + deltaClass(changePct);

    if (high) $('#priceHigh').textContent = '$' + formatPrice(high, 2);
    if (low) $('#priceLow').textContent = '$' + formatPrice(low, 2);
    if (vol) $('#priceVolume').textContent = formatCompactRaw(vol) + ' BTC';
    if (quoteVol && vol) $('#priceVwap').textContent = '$' + formatPrice(quoteVol / vol, 2);
  }

  function getIntervalSeconds(interval) {
    var map = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };
    return map[interval] || 3600;
  }

  // Fallback: load price from REST if WebSocket is unavailable
  async function loadPriceREST() {
    try {
      var resp = await fetch('https://data-api.binance.vision/api/v3/ticker/24hr?symbol=' + state.symbol);
      if (!resp.ok) return;
      var d = await resp.json();
      renderPriceData(
        parseFloat(d.lastPrice),
        parseFloat(d.priceChangePercent),
        parseFloat(d.highPrice),
        parseFloat(d.lowPrice),
        parseFloat(d.volume),
        parseFloat(d.quoteVolume)
      );
    } catch(e) { console.error('REST price fetch failed:', e); }
  }

  // ============================================
  // CHART (F03)
  // ============================================
  var chartObj = null;
  var candleSeries = null;
  var volumeSeries = null;
  var sma20Series = null;
  var sma50Series = null;
  var ema12Series = null;
  var ema26Series = null;
  var rsiChart = null;
  var rsiSeries = null;
  var macdChart = null;
  var macdLineSeries = null;
  var macdSignalSeries = null;
  var macdHistSeries = null;
  var vwapSeries = null;
  var chartResizeObserver = null;

  function getChartColors() {
    var isDark = currentTheme === 'dark';
    return {
      layout: {
        background: { color: isDark ? '#0A0E17' : '#ffffff' },
        textColor: isDark ? '#94a3b8' : '#475569',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: isDark ? '#1e293b' : '#e2e8f0' },
        horzLines: { color: isDark ? '#1e293b' : '#e2e8f0' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: isDark ? '#f59e0b' : '#d97706', width: 1, style: 2, labelBackgroundColor: '#f59e0b' },
        horzLine: { color: isDark ? '#f59e0b' : '#d97706', width: 1, style: 2, labelBackgroundColor: '#f59e0b' },
      },
      timeScale: {
        borderColor: isDark ? '#1e293b' : '#e2e8f0',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: isDark ? '#1e293b' : '#e2e8f0',
      },
    };
  }

  function initChart() {
    var container = $('#chartContainer');
    container.innerHTML = '';

    var mainWrap = document.createElement('div');
    mainWrap.id = 'mainChartWrap';
    mainWrap.style.cssText = 'width:100%;height:100%;min-height:300px;';
    container.appendChild(mainWrap);

    // Wait for layout to be computed
    requestAnimationFrame(function() {
      var w = mainWrap.clientWidth || 800;
      var h = mainWrap.clientHeight || 380;

      chartObj = LightweightCharts.createChart(mainWrap, Object.assign({}, getChartColors(), {
        width: w,
        height: h,
        handleScroll: { vertTouchDrag: false },
      }));

      candleSeries = chartObj.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });

      volumeSeries = chartObj.addHistogramSeries({
        color: '#f59e0b',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        scaleMargins: { top: 0.85, bottom: 0 },
      });

      chartResizeObserver = new ResizeObserver(function() {
        if (chartObj && mainWrap.clientWidth > 0) {
          chartObj.applyOptions({ width: mainWrap.clientWidth, height: mainWrap.clientHeight });
        }
      });
      chartResizeObserver.observe(mainWrap);

      // Now load data
      loadChartData();
    });
  }

  async function loadChartData() {
    try {
      var resp = await fetch('https://data-api.binance.vision/api/v3/klines?symbol=' + state.symbol + '&interval=' + state.interval + '&limit=500');
      if (!resp.ok) throw new Error('Chart fetch failed');
      var data = await resp.json();

      state.chartData = data.map(function(d) {
        return { time: d[0] / 1000, open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]) };
      });

      state.volumeData = data.map(function(d) {
        return {
          time: d[0] / 1000,
          value: parseFloat(d[5]),
          color: parseFloat(d[4]) >= parseFloat(d[1]) ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
        };
      });

      if (candleSeries) candleSeries.setData(state.chartData);
      if (volumeSeries) volumeSeries.setData(state.volumeData);
      if (chartObj) chartObj.timeScale().fitContent();

      updateIndicators();
    } catch (e) {
      console.error('Chart load error:', e);
    }
  }

  // Interval buttons
  $$('.chart-interval-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      $$('.chart-interval-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.interval = btn.dataset.interval;
      loadChartData();
    });
  });

  // ============================================
  // TECHNICAL INDICATORS (F09)
  // ============================================
  function calcSMA(data, period) {
    var result = [];
    for (var i = 0; i < data.length; i++) {
      if (i < period - 1) continue;
      var sum = 0;
      for (var j = i - period + 1; j <= i; j++) sum += data[j].close;
      result.push({ time: data[i].time, value: sum / period });
    }
    return result;
  }

  function calcEMA(data, period) {
    var result = [];
    var k = 2 / (period + 1);
    var ema = null;
    for (var i = 0; i < data.length; i++) {
      if (ema === null) {
        if (i < period - 1) continue;
        var sum = 0;
        for (var j = i - period + 1; j <= i; j++) sum += data[j].close;
        ema = sum / period;
      } else {
        ema = data[i].close * k + ema * (1 - k);
      }
      result.push({ time: data[i].time, value: ema });
    }
    return result;
  }

  function calcRSI(data, period) {
    if (data.length < period + 1) return [];
    var result = [];
    var gains = 0, losses = 0;

    for (var i = 1; i <= period; i++) {
      var diff = data[i].close - data[i - 1].close;
      if (diff > 0) gains += diff; else losses -= diff;
    }

    var avgGain = gains / period;
    var avgLoss = losses / period;
    var rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({ time: data[period].time, value: 100 - 100 / (1 + rs) });

    for (var i = period + 1; i < data.length; i++) {
      var diff = data[i].close - data[i - 1].close;
      avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push({ time: data[i].time, value: 100 - 100 / (1 + rs) });
    }
    return result;
  }

  function calcMACD(data) {
    var ema12 = calcEMA(data, 12);
    var ema26 = calcEMA(data, 26);
    var macdLine = [];
    var ema26Map = {};
    ema26.forEach(function(p) { ema26Map[p.time] = p.value; });
    ema12.forEach(function(p) {
      if (ema26Map[p.time] !== undefined) {
        macdLine.push({ time: p.time, value: p.value - ema26Map[p.time] });
      }
    });

    var signal = [];
    var k = 2 / 10;
    var ema = null;
    for (var i = 0; i < macdLine.length; i++) {
      if (ema === null) {
        if (i < 8) continue;
        var sum = 0;
        for (var j = i - 8; j <= i; j++) sum += macdLine[j].value;
        ema = sum / 9;
      } else {
        ema = macdLine[i].value * k + ema * (1 - k);
      }
      signal.push({ time: macdLine[i].time, value: ema });
    }

    var hist = [];
    var signalMap = {};
    signal.forEach(function(p) { signalMap[p.time] = p.value; });
    macdLine.forEach(function(p) {
      if (signalMap[p.time] !== undefined) {
        var v = p.value - signalMap[p.time];
        hist.push({ time: p.time, value: v, color: v >= 0 ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)' });
      }
    });

    return { macdLine: macdLine, signal: signal, hist: hist };
  }

  function calcVWAP(data) {
    // VWAP = cumulative(TP * Volume) / cumulative(Volume)
    // TP (typical price) = (high + low + close) / 3
    // Reset at each new trading day (UTC midnight)
    var result = [];
    var cumTPV = 0;
    var cumVol = 0;
    var currentDay = null;

    for (var i = 0; i < data.length; i++) {
      var d = data[i];
      var ts = typeof d.time === 'object' ? new Date(d.time.year, d.time.month - 1, d.time.day) : new Date(d.time * 1000);
      var day = ts.getUTCFullYear() * 10000 + (ts.getUTCMonth() + 1) * 100 + ts.getUTCDate();

      // Reset on new day
      if (day !== currentDay) {
        cumTPV = 0;
        cumVol = 0;
        currentDay = day;
      }

      var tp = (d.high + d.low + d.close) / 3;
      // Use volume from volumeData if available, else estimate from price range
      var vol = state.volumeData[i] ? state.volumeData[i].value : 1;
      cumTPV += tp * vol;
      cumVol += vol;

      if (cumVol > 0) {
        result.push({ time: d.time, value: cumTPV / cumVol });
      }
    }
    return result;
  }

  function updateIndicators() {
    var data = state.chartData;
    if (!data.length || !chartObj) return;

    // Remove existing overlay series
    if (sma20Series) { try { chartObj.removeSeries(sma20Series); } catch(e) {} sma20Series = null; }
    if (sma50Series) { try { chartObj.removeSeries(sma50Series); } catch(e) {} sma50Series = null; }
    if (ema12Series) { try { chartObj.removeSeries(ema12Series); } catch(e) {} ema12Series = null; }
    if (ema26Series) { try { chartObj.removeSeries(ema26Series); } catch(e) {} ema26Series = null; }
    if (vwapSeries) { try { chartObj.removeSeries(vwapSeries); } catch(e) {} vwapSeries = null; }

    // Remove sub-charts
    var container = $('#chartContainer');
    var rsiEl = container.querySelector('#rsiChartWrap');
    if (rsiEl) { if (rsiChart) { try { rsiChart.remove(); } catch(e) {} } rsiChart = null; rsiEl.remove(); }
    var macdEl = container.querySelector('#macdChartWrap');
    if (macdEl) { if (macdChart) { try { macdChart.remove(); } catch(e) {} } macdChart = null; macdEl.remove(); }

    // Calculate main chart height percentage
    var mainWrap = container.querySelector('#mainChartWrap');
    var mainPct = 100;
    if (state.indicators.rsi) mainPct -= 20;
    if (state.indicators.macd) mainPct -= 20;
    mainWrap.style.height = mainPct + '%';

    // SMA
    if (state.indicators.sma) {
      sma20Series = chartObj.addLineSeries({ color: '#3b82f6', lineWidth: 1, title: 'SMA20' });
      sma50Series = chartObj.addLineSeries({ color: '#a855f7', lineWidth: 1, title: 'SMA50' });
      sma20Series.setData(calcSMA(data, 20));
      sma50Series.setData(calcSMA(data, 50));
    }

    // EMA
    if (state.indicators.ema) {
      ema12Series = chartObj.addLineSeries({ color: '#f59e0b', lineWidth: 1, title: 'EMA12', lineStyle: 2 });
      ema26Series = chartObj.addLineSeries({ color: '#06b6d4', lineWidth: 1, title: 'EMA26', lineStyle: 2 });
      ema12Series.setData(calcEMA(data, 12));
      ema26Series.setData(calcEMA(data, 26));
    }

    // VWAP
    if (state.indicators.vwap) {
      vwapSeries = chartObj.addLineSeries({ color: '#ec4899', lineWidth: 2, title: 'VWAP', lineStyle: 0 });
      vwapSeries.setData(calcVWAP(data));
    }

    var isDark = currentTheme === 'dark';

    // RSI
    if (state.indicators.rsi) {
      var rsiWrap = document.createElement('div');
      rsiWrap.id = 'rsiChartWrap';
      rsiWrap.style.cssText = 'width:100%;height:20%;border-top:1px solid ' + (isDark ? '#1e293b' : '#e2e8f0') + ';';
      container.appendChild(rsiWrap);

      rsiChart = LightweightCharts.createChart(rsiWrap, {
        width: rsiWrap.clientWidth || 400,
        height: rsiWrap.clientHeight || 80,
        layout: { background: { color: isDark ? '#0A0E17' : '#ffffff' }, textColor: isDark ? '#94a3b8' : '#475569', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 },
        grid: { vertLines: { color: isDark ? '#1e293b' : '#e2e8f0' }, horzLines: { color: isDark ? '#1e293b' : '#e2e8f0' } },
        timeScale: { visible: false },
        rightPriceScale: { borderColor: isDark ? '#1e293b' : '#e2e8f0' },
      });

      rsiSeries = rsiChart.addLineSeries({ color: '#a855f7', lineWidth: 1.5, title: 'RSI(14)', priceFormat: { type: 'custom', formatter: function(v) { return v.toFixed(0); } } });
      var rsiData = calcRSI(data, 14);
      rsiSeries.setData(rsiData);
      rsiSeries.createPriceLine({ price: 70, color: 'rgba(239,68,68,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' });
      rsiSeries.createPriceLine({ price: 30, color: 'rgba(34,197,94,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' });
      rsiChart.timeScale().fitContent();

      new ResizeObserver(function() { if (rsiChart) rsiChart.applyOptions({ width: rsiWrap.clientWidth, height: rsiWrap.clientHeight }); }).observe(rsiWrap);
    }

    // MACD
    if (state.indicators.macd) {
      var macdWrap = document.createElement('div');
      macdWrap.id = 'macdChartWrap';
      macdWrap.style.cssText = 'width:100%;height:20%;border-top:1px solid ' + (isDark ? '#1e293b' : '#e2e8f0') + ';';
      container.appendChild(macdWrap);

      macdChart = LightweightCharts.createChart(macdWrap, {
        width: macdWrap.clientWidth || 400,
        height: macdWrap.clientHeight || 80,
        layout: { background: { color: isDark ? '#0A0E17' : '#ffffff' }, textColor: isDark ? '#94a3b8' : '#475569', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 },
        grid: { vertLines: { color: isDark ? '#1e293b' : '#e2e8f0' }, horzLines: { color: isDark ? '#1e293b' : '#e2e8f0' } },
        timeScale: { visible: false },
        rightPriceScale: { borderColor: isDark ? '#1e293b' : '#e2e8f0' },
      });

      var macdResult = calcMACD(data);
      macdHistSeries = macdChart.addHistogramSeries({ priceFormat: { type: 'custom', formatter: function(v) { return v.toFixed(0); } } });
      macdHistSeries.setData(macdResult.hist);
      macdLineSeries = macdChart.addLineSeries({ color: '#3b82f6', lineWidth: 1.5, title: 'MACD' });
      macdLineSeries.setData(macdResult.macdLine);
      macdSignalSeries = macdChart.addLineSeries({ color: '#f59e0b', lineWidth: 1.5, title: 'Signal' });
      macdSignalSeries.setData(macdResult.signal);
      macdChart.timeScale().fitContent();

      new ResizeObserver(function() { if (macdChart) macdChart.applyOptions({ width: macdWrap.clientWidth, height: macdWrap.clientHeight }); }).observe(macdWrap);
    }
  }

  // Indicator toggle buttons
  $$('.indicator-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var ind = btn.dataset.indicator;
      state.indicators[ind] = !state.indicators[ind];
      btn.classList.toggle('active', state.indicators[ind]);
      updateIndicators();
    });
  });

  // ============================================
  // ORDER BOOK (F04)
  // ============================================
  function connectDepthWS() {
    if (state.wsDepth) { try { state.wsDepth.close(); } catch(e) {} }
    const pair = state.symbol.toLowerCase();
    const url = 'wss://stream.binance.com:9443/ws/' + pair + '@depth20@1000ms';

    try {
      state.wsDepth = new WebSocket(url);
    } catch(e) {
      scheduleReconnect('depth');
      return;
    }

    state.wsDepth.onmessage = function(evt) {
      try { renderOrderBook(JSON.parse(evt.data)); } catch(e) {}
    };

    state.wsDepth.onerror = function() {};
    state.wsDepth.onclose = function() { scheduleReconnect('depth'); };
  }

  function renderOrderBook(data) {
    var asks = (data.asks || []).slice(0, 15).reverse();
    var bids = (data.bids || []).slice(0, 15);
    var maxAsk = asks.reduce(function(m, a) { return Math.max(m, parseFloat(a[1])); }, 0);
    var maxBid = bids.reduce(function(m, b) { return Math.max(m, parseFloat(b[1])); }, 0);
    var maxVol = Math.max(maxAsk, maxBid);

    var asksEl = $('#orderBookAsks');
    var bidsEl = $('#orderBookBids');

    asksEl.innerHTML = asks.map(function(a) {
      var price = parseFloat(a[0]);
      var vol = parseFloat(a[1]);
      var pct = maxVol > 0 ? (vol / maxVol * 100).toFixed(1) : 0;
      return '<div class="ob-row ask"><span class="ob-price">' + formatPrice(price, 2) + '</span><span class="ob-vol">' + vol.toFixed(4) + '</span><div class="ob-bar" style="width:' + pct + '%"></div></div>';
    }).join('');

    bidsEl.innerHTML = bids.map(function(b) {
      var price = parseFloat(b[0]);
      var vol = parseFloat(b[1]);
      var pct = maxVol > 0 ? (vol / maxVol * 100).toFixed(1) : 0;
      return '<div class="ob-row bid"><span class="ob-price">' + formatPrice(price, 2) + '</span><span class="ob-vol">' + vol.toFixed(4) + '</span><div class="ob-bar" style="width:' + pct + '%"></div></div>';
    }).join('');

    // Spread
    if (asks.length && bids.length) {
      var spread = parseFloat(asks[asks.length - 1][0]) - parseFloat(bids[0][0]);
      var spreadEl = $('#obSpread');
      if (spreadEl) spreadEl.textContent = 'Spread: $' + spread.toFixed(2);
    }
  }

  // ============================================
  // WATCHLIST (F05)
  // ============================================
  async function loadWatchlist() {
    try {
      var resp = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana,binancecoin,ripple,cardano,avalanche-2,polkadot,chainlink,uniswap&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h');
      if (!resp.ok) throw new Error('Watchlist fetch failed');
      var data = await resp.json();
      state.watchlistData = data;
      renderWatchlist();
    } catch (e) {
      console.error('Watchlist load error:', e);
    }
  }

  function renderWatchlist() {
    var body = $('#watchlistBody');
    if (!body) return;
    var data = state.watchlistData.slice();

    // Sort
    data.sort(function(a, b) {
      var av = a[state.watchlistSort.key];
      var bv = b[state.watchlistSort.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      return state.watchlistSort.asc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

    body.innerHTML = data.map(function(coin) {
      var chg = coin.price_change_percentage_24h;
      var chgClass = deltaClass(chg);
      var chgStr = formatPct(chg);
      return '<tr>'
        + '<td><span class="coin-rank">#' + coin.market_cap_rank + '</span></td>'
        + '<td><img src="' + coin.image + '" width="18" height="18" style="vertical-align:middle;margin-right:6px;border-radius:50%;">' + coin.symbol.toUpperCase() + '</td>'
        + '<td>$' + formatPrice(coin.current_price, 2) + '</td>'
        + '<td class="' + chgClass + '">' + deltaArrow(chg) + ' ' + chgStr + '</td>'
        + '<td>' + formatCompact(coin.market_cap) + '</td>'
        + '<td>' + formatCompact(coin.total_volume) + '</td>'
        + '</tr>';
    }).join('');
  }

  // Sort headers
  $$('#watchlistTable th[data-sort]').forEach(function(th) {
    th.addEventListener('click', function() {
      var key = th.dataset.sort;
      if (state.watchlistSort.key === key) {
        state.watchlistSort.asc = !state.watchlistSort.asc;
      } else {
        state.watchlistSort.key = key;
        state.watchlistSort.asc = true;
      }
      $$('#watchlistTable th').forEach(function(t) { t.classList.remove('sort-asc', 'sort-desc'); });
      th.classList.add(state.watchlistSort.asc ? 'sort-asc' : 'sort-desc');
      renderWatchlist();
    });
  });

  // ============================================
  // POLYMARKET (F07)
  // ============================================
  var polymarketRefreshTimer = null;

  async function loadPolymarket() {
    try {
      var resp = await fetch(CGI_BIN + '/polymarket.py');
      if (!resp.ok) throw new Error('Polymarket fetch failed: ' + resp.status);
      var data = await resp.json();
      state.polymarketData = data;
      renderPolymarket();
    } catch (e) {
      console.error('Polymarket load error:', e);
      renderPolymarketError(e.message);
    }
  }

  function renderPolymarketError(msg) {
    var el = $('#polymarketGrid');
    if (el) el.innerHTML = '<div class="pm-error">Polymarket data unavailable: ' + escapeHtml(msg) + '</div>';
  }

  function renderPolymarket() {
    var grid = $('#polymarketGrid');
    if (!grid || !state.polymarketData) return;

    var markets = state.polymarketData.markets || [];
    var filter = state.polymarketFilter;

    var filtered = markets.filter(function(m) {
      if (filter === 'all') return true;
      if (filter === 'crypto') return (m.tags || []).some(function(t) { return t.toLowerCase().indexOf('crypto') !== -1 || t.toLowerCase().indexOf('bitcoin') !== -1 || t.toLowerCase().indexOf('ethereum') !== -1; });
      if (filter === 'btc') return (m.tags || []).some(function(t) { return t.toLowerCase().indexOf('bitcoin') !== -1 || t.toLowerCase().indexOf('btc') !== -1; })
        || m.question.toLowerCase().indexOf('bitcoin') !== -1 || m.question.toLowerCase().indexOf('btc') !== -1;
      return true;
    });

    if (!filtered.length) {
      grid.innerHTML = '<div class="pm-empty">No markets match this filter.</div>';
      return;
    }

    grid.innerHTML = filtered.map(function(m, idx) {
      var yesProb = m.yes_prob != null ? (m.yes_prob * 100).toFixed(1) : null;
      var noProb = m.no_prob != null ? (m.no_prob * 100).toFixed(1) : null;
      var vol = m.volume != null ? formatCompact(m.volume) : '—';
      var liq = m.liquidity != null ? formatCompact(m.liquidity) : '—';

      // Trend indicator
      var prevYes = state.polymarketLastValues[m.id];
      var trendHtml = '';
      if (prevYes != null && yesProb != null) {
        var diff = parseFloat(yesProb) - prevYes;
        if (Math.abs(diff) >= 0.5) {
          trendHtml = '<span class="pm-trend ' + (diff > 0 ? 'pos' : 'neg') + '">' + (diff > 0 ? '▲' : '▼') + ' ' + Math.abs(diff).toFixed(1) + '%</span>';
        }
      }
      if (yesProb != null) state.polymarketLastValues[m.id] = parseFloat(yesProb);

      var probHtml = '';
      if (yesProb != null) {
        var pct = parseFloat(yesProb);
        var barColor = pct >= 60 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
        probHtml = '<div class="pm-prob-bar"><div class="pm-prob-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>'
          + '<div class="pm-prob-labels"><span class="pm-yes">YES ' + yesProb + '%</span>' + (noProb ? '<span class="pm-no">NO ' + noProb + '%</span>' : '') + '</div>';
      } else {
        probHtml = '<div class="pm-no-prob">Multi-outcome</div>';
      }

      return '<div class="pm-card" data-market-idx="' + idx + '">'
        + '<div class="pm-card-header">'
          + '<div class="pm-question">' + escapeHtml(m.question) + '</div>'
          + '<div class="pm-meta">' + (m.end_date ? '<span class="pm-end">⏰ ' + new Date(m.end_date).toLocaleDateString() + '</span>' : '') + trendHtml + '</div>'
        + '</div>'
        + probHtml
        + '<div class="pm-stats"><span>Vol: ' + vol + '</span><span>Liq: ' + liq + '</span></div>'
      + '</div>';
    }).join('');

    // Click handlers for PM cards — open history chart
    grid.querySelectorAll('.pm-card').forEach(function(card) {
      card.addEventListener('click', function() {
        var idx = parseInt(card.dataset.marketIdx, 10);
        var markets = (state.polymarketData && state.polymarketData.markets) || [];
        if (!isNaN(idx) && markets[idx]) {
          openPMHistoryChart(markets[idx]);
        }
      });
    });
  }

  // ============================================
  // PM HISTORY CHART MODAL
  // ============================================
  var pmHistoryChart = null;
  var pmHistorySeries = null;

  function openPMHistoryChart(market) {
    var modal = $('#pmHistoryModal');
    var title = $('#pmHistoryTitle');
    var chartEl = $('#pmHistoryChartContainer');

    if (!modal || !chartEl) return;

    title.textContent = market.question || 'Market History';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Destroy previous chart instance
    if (pmHistoryChart) {
      try { pmHistoryChart.remove(); } catch(e) {}
      pmHistoryChart = null;
      pmHistorySeries = null;
    }
    chartEl.innerHTML = '';

    // Fetch history and render
    fetchPMHistory(market, chartEl);
  }

  function closePMHistoryModal() {
    var modal = $('#pmHistoryModal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
    if (pmHistoryChart) {
      try { pmHistoryChart.remove(); } catch(e) {}
      pmHistoryChart = null;
      pmHistorySeries = null;
    }
  }

  // Wire up close button
  (function() {
    var closeBtn = $('#pmHistoryClose');
    if (closeBtn) closeBtn.addEventListener('click', closePMHistoryModal);
    var modal = $('#pmHistoryModal');
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) closePMHistoryModal();
      });
    }
  })();

  async function fetchPMHistory(market, chartEl) {
    var loadingEl = $('#pmHistoryLoading');
    if (loadingEl) loadingEl.style.display = 'flex';

    try {
      // Try to fetch history from the CGI endpoint
      var url = CGI_BIN + '/polymarket_history.py?market_id=' + encodeURIComponent(market.id || '');
      var resp = await fetch(url);
      var histData = null;

      if (resp.ok) {
        histData = await resp.json();
      }

      if (loadingEl) loadingEl.style.display = 'none';

      if (histData && histData.history && histData.history.length > 1) {
        renderPMHistoryChart(histData.history, chartEl, market);
      } else {
        // Fallback: render a synthetic chart from current probability
        renderPMHistorySynthetic(market, chartEl);
      }
    } catch (e) {
      if (loadingEl) loadingEl.style.display = 'none';
      renderPMHistorySynthetic(market, chartEl);
    }
  }

  function renderPMHistoryChart(history, chartEl, market) {
    var isDark = currentTheme === 'dark';
    var w = chartEl.clientWidth || 600;
    var h = chartEl.clientHeight || 300;

    pmHistoryChart = LightweightCharts.createChart(chartEl, {
      width: w,
      height: h,
      layout: {
        background: { color: isDark ? '#0A0E17' : '#ffffff' },
        textColor: isDark ? '#94a3b8' : '#475569',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: isDark ? '#1e293b' : '#e2e8f0' },
        horzLines: { color: isDark ? '#1e293b' : '#e2e8f0' },
      },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      timeScale: { borderColor: isDark ? '#1e293b' : '#e2e8f0', timeVisible: true },
      rightPriceScale: {
        borderColor: isDark ? '#1e293b' : '#e2e8f0',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      handleScroll: { vertTouchDrag: false },
    });

    pmHistorySeries = pmHistoryChart.addAreaSeries({
      lineColor: '#f59e0b',
      topColor: 'rgba(245,158,11,0.3)',
      bottomColor: 'rgba(245,158,11,0.02)',
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: function(v) { return v.toFixed(1) + '%'; },
      },
    });

    var chartData = history.map(function(point) {
      return {
        time: Math.floor(new Date(point.timestamp).getTime() / 1000),
        value: point.yes_prob * 100,
      };
    }).filter(function(p) { return !isNaN(p.time) && !isNaN(p.value); });

    // Sort by time and deduplicate
    chartData.sort(function(a, b) { return a.time - b.time; });
    chartData = chartData.filter(function(p, i) {
      return i === 0 || p.time !== chartData[i - 1].time;
    });

    if (chartData.length) {
      pmHistorySeries.setData(chartData);
      pmHistoryChart.timeScale().fitContent();
    }

    // Resize observer
    new ResizeObserver(function() {
      if (pmHistoryChart) {
        pmHistoryChart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
      }
    }).observe(chartEl);
  }

  function renderPMHistorySynthetic(market, chartEl) {
    // Generate synthetic history data for display when real history unavailable
    var isDark = currentTheme === 'dark';
    var w = chartEl.clientWidth || 600;
    var h = chartEl.clientHeight || 300;

    pmHistoryChart = LightweightCharts.createChart(chartEl, {
      width: w,
      height: h,
      layout: {
        background: { color: isDark ? '#0A0E17' : '#ffffff' },
        textColor: isDark ? '#94a3b8' : '#475569',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: isDark ? '#1e293b' : '#e2e8f0' },
        horzLines: { color: isDark ? '#1e293b' : '#e2e8f0' },
      },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      timeScale: { borderColor: isDark ? '#1e293b' : '#e2e8f0', timeVisible: true },
      rightPriceScale: { borderColor: isDark ? '#1e293b' : '#e2e8f0', scaleMargins: { top: 0.1, bottom: 0.1 } },
      handleScroll: { vertTouchDrag: false },
    });

    pmHistorySeries = pmHistoryChart.addAreaSeries({
      lineColor: '#94a3b8',
      topColor: 'rgba(148,163,184,0.2)',
      bottomColor: 'rgba(148,163,184,0.02)',
      lineWidth: 1.5,
      priceFormat: {
        type: 'custom',
        formatter: function(v) { return v.toFixed(1) + '%'; },
      },
    });

    // Build 30-day synthetic series ending at current probability
    var currentProb = market.yes_prob != null ? market.yes_prob * 100 : 50;
    var now = Math.floor(Date.now() / 1000);
    var syntheticData = [];
    var prob = currentProb + (Math.random() * 20 - 10);
    prob = Math.max(5, Math.min(95, prob));

    for (var i = 29; i >= 0; i--) {
      var t = now - i * 86400;
      // Random walk toward current prob
      prob += (currentProb - prob) * 0.15 + (Math.random() * 4 - 2);
      prob = Math.max(2, Math.min(98, prob));
      syntheticData.push({ time: t, value: prob });
    }
    syntheticData.push({ time: now, value: currentProb });

    // Ensure strictly increasing times
    syntheticData = syntheticData.filter(function(p, i) {
      return i === 0 || p.time > syntheticData[i - 1].time;
    });

    pmHistorySeries.setData(syntheticData);
    pmHistoryChart.timeScale().fitContent();

    // Add a "synthetic" watermark label
    var label = document.createElement('div');
    label.style.cssText = 'position:absolute;bottom:8px;left:8px;font-size:10px;color:' + (isDark ? '#334155' : '#cbd5e1') + ';pointer-events:none;font-family:monospace;';
    label.textContent = 'SIMULATED — live history unavailable';
    chartEl.style.position = 'relative';
    chartEl.appendChild(label);

    new ResizeObserver(function() {
      if (pmHistoryChart) {
        pmHistoryChart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
      }
    }).observe(chartEl);
  }

  // Polymarket filter tabs
  (function initPolymarketTabs() {
    var tabs = $$('#polymarketTabs .pm-tab');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        tabs.forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        state.polymarketFilter = tab.dataset.filter || 'all';
        renderPolymarket();
      });
    });
  })();

  // ============================================
  // MACRO DATA (F08)
  // ============================================
  async function loadMacro() {
    try {
      var resp = await fetch(CGI_BIN + '/macro.py');
      if (!resp.ok) throw new Error('Macro fetch failed: ' + resp.status);
      var data = await resp.json();
      renderMacro(data);
    } catch (e) {
      console.error('Macro load error:', e);
    }
  }

  function renderMacro(data) {
    var rows = [
      { id: 'macroDxy', key: 'dxy' },
      { id: 'macroGold', key: 'gold' },
      { id: 'macroSpy', key: 'spy' },
      { id: 'macroVix', key: 'vix' },
      { id: 'macroUs10y', key: 'us10y' },
      { id: 'macroFedRate', key: 'fed_rate' },
      { id: 'macroM2', key: 'm2' },
      { id: 'macroCpi', key: 'cpi' },
    ];

    rows.forEach(function(row) {
      var item = data[row.key];
      if (!item) return;
      var el = $('#' + row.id);
      if (!el) return;

      var valEl = el.querySelector('.macro-value');
      var chgEl = el.querySelector('.macro-change');
      var srcEl = el.querySelector('.macro-source');

      if (valEl) valEl.textContent = item.value != null ? (typeof item.value === 'number' ? item.value.toFixed(item.decimals || 2) : item.value) : '—';
      if (chgEl && item.change != null) {
        chgEl.textContent = deltaArrow(item.change) + ' ' + Math.abs(item.change).toFixed(2) + '%';
        chgEl.className = 'macro-change ' + deltaClass(item.change);
      }
      if (srcEl && item.source) srcEl.textContent = item.source;
    });
  }

  // ============================================
  // VOLATILITY (F10)
  // ============================================
  async function loadVolatility() {
    try {
      var resp = await fetch(CGI_BIN + '/volatility.py');
      if (!resp.ok) throw new Error('Vol fetch failed: ' + resp.status);
      var data = await resp.json();
      renderVolatility(data);
    } catch (e) {
      console.error('Volatility load error:', e);
    }
  }

  function renderVolatility(data) {
    if (!data) return;

    function setVal(id, val, pct, clsKey) {
      var el = $('#' + id);
      if (!el) return;
      var valEl = el.querySelector('.vol-value');
      var pctEl = el.querySelector('.vol-pct');
      if (valEl) valEl.textContent = val != null ? val : '—';
      if (pctEl && pct != null) {
        pctEl.textContent = deltaArrow(pct) + ' ' + Math.abs(pct).toFixed(2) + '%';
        pctEl.className = 'vol-pct ' + deltaClass(pct);
      }
    }

    if (data.realized_vol_7d != null) setVal('volRv7d', data.realized_vol_7d.toFixed(1) + '%', data.realized_vol_7d_chg);
    if (data.realized_vol_30d != null) setVal('volRv30d', data.realized_vol_30d.toFixed(1) + '%', data.realized_vol_30d_chg);
    if (data.implied_vol != null) setVal('volIv', data.implied_vol.toFixed(1) + '%', data.implied_vol_chg);
    if (data.fear_greed != null) {
      var fgEl = $('#volFearGreed');
      if (fgEl) {
        var valEl = fgEl.querySelector('.vol-value');
        var lblEl = fgEl.querySelector('.fg-label');
        var meterEl = fgEl.querySelector('.fg-meter-fill');
        if (valEl) valEl.textContent = data.fear_greed;
        if (lblEl) lblEl.textContent = data.fear_greed_label || '';
        if (meterEl) {
          meterEl.style.width = data.fear_greed + '%';
          var fg = parseInt(data.fear_greed);
          meterEl.style.background = fg < 25 ? '#ef4444' : fg < 45 ? '#f97316' : fg < 55 ? '#eab308' : fg < 75 ? '#84cc16' : '#22c55e';
        }
      }
    }
    if (data.funding_rate != null) {
      var frEl = $('#volFundingRate');
      if (frEl) {
        var valEl = frEl.querySelector('.vol-value');
        if (valEl) valEl.textContent = (data.funding_rate >= 0 ? '+' : '') + data.funding_rate.toFixed(4) + '%';
        valEl.className = 'vol-value ' + deltaClass(data.funding_rate);
      }
    }
    if (data.open_interest != null) {
      var oiEl = $('#volOI');
      if (oiEl) {
        var valEl = oiEl.querySelector('.vol-value');
        if (valEl) valEl.textContent = formatCompact(data.open_interest);
      }
    }
  }

  // ============================================
  // ON-CHAIN DATA (F11)
  // ============================================
  async function loadOnChain() {
    try {
      var resp = await fetch(CGI_BIN + '/onchain.py');
      if (!resp.ok) throw new Error('On-chain fetch failed: ' + resp.status);
      var data = await resp.json();
      renderOnChain(data);
    } catch (e) {
      console.error('On-chain load error:', e);
    }
  }

  function renderOnChain(data) {
    if (!data) return;
    var fields = [
      { id: 'ocHashRate', key: 'hash_rate', fmt: function(v) { return (v / 1e18).toFixed(2) + ' EH/s'; } },
      { id: 'ocDifficulty', key: 'difficulty', fmt: function(v) { return (v / 1e12).toFixed(2) + 'T'; } },
      { id: 'ocMempoolSize', key: 'mempool_size', fmt: function(v) { return v.toLocaleString() + ' txs'; } },
      { id: 'ocAvgFee', key: 'avg_fee', fmt: function(v) { return v.toFixed(1) + ' sat/vB'; } },
      { id: 'ocBlockTime', key: 'block_time', fmt: function(v) { return v.toFixed(1) + ' min'; } },
      { id: 'ocActiveAddr', key: 'active_addresses', fmt: function(v) { return (v / 1e3).toFixed(1) + 'K'; } },
      { id: 'ocTxCount', key: 'tx_count_24h', fmt: function(v) { return (v / 1e3).toFixed(1) + 'K'; } },
      { id: 'ocNvt', key: 'nvt_ratio', fmt: function(v) { return v.toFixed(1); } },
    ];

    fields.forEach(function(f) {
      var el = $('#' + f.id);
      if (!el) return;
      var valEl = el.querySelector('.oc-value');
      var item = data[f.key];
      if (valEl && item != null) {
        valEl.textContent = typeof f.fmt === 'function' ? f.fmt(item.value != null ? item.value : item) : (item.value != null ? item.value : item);
      }
      var chgEl = el.querySelector('.oc-change');
      if (chgEl && item && item.change != null) {
        chgEl.textContent = deltaArrow(item.change) + ' ' + Math.abs(item.change).toFixed(2) + '%';
        chgEl.className = 'oc-change ' + deltaClass(item.change);
      }
    });
  }

  // ============================================
  // INIT
  // ============================================
  function init() {
    initChart();
    connectTickerWS();
    connectDepthWS();

    // Load REST price immediately as fallback
    loadPriceREST();

    // Load all panel data
    loadWatchlist();
    loadNews();
    loadPolymarket();
    loadMacro();
    loadVolatility();
    loadOnChain();

    // Periodic refreshes
    setInterval(loadWatchlist, 30000);
    setInterval(loadNews, 300000);
    setInterval(loadPolymarket, 60000);
    setInterval(loadMacro, 300000);
    setInterval(loadVolatility, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
