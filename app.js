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
        + '<div class="news-item-header">'
          + '<span class="news-source-badge">' + escapeHtml(item.source) + '</span>'
          + '<span class="news-time">' + formatNewsTime(item.timestamp) + '</span>'
        + '</div>'
        + '<div class="news-title">' + escapeHtml(item.title) + '</div>'
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

    var asksEl = $('#asksBody');
    var bidsEl = $('#bidsBody');
    if (!asksEl || !bidsEl) return;

    asksEl.innerHTML = asks.map(function(a) {
      var price = parseFloat(a[0]);
      var vol = parseFloat(a[1]);
      var total = price * vol;
      return '<tr class="ob-row ask"><td class="ob-price">' + formatPrice(price, 2) + '</td><td class="ob-vol">' + vol.toFixed(4) + '</td><td>' + formatCompact(total) + '</td></tr>';
    }).join('');

    bidsEl.innerHTML = bids.map(function(b) {
      var price = parseFloat(b[0]);
      var vol = parseFloat(b[1]);
      var total = price * vol;
      return '<tr class="ob-row bid"><td class="ob-price">' + formatPrice(price, 2) + '</td><td class="ob-vol">' + vol.toFixed(4) + '</td><td>' + formatCompact(total) + '</td></tr>';
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

    // Populate KPIs from BTC data
    var btc = state.watchlistData.find(function(c) { return c.id === 'bitcoin'; });
    if (btc) {
      var kpiAth = $('#kpiAth'); if (kpiAth) kpiAth.textContent = '$' + formatPrice(btc.ath, 0);
      var kpiAthD = $('#kpiAthDelta'); if (kpiAthD) { kpiAthD.textContent = formatPct(btc.ath_change_percentage); kpiAthD.className = 'kpi-delta ' + deltaClass(btc.ath_change_percentage); }
      var kpiSupply = $('#kpiSupply'); if (kpiSupply) kpiSupply.textContent = formatSupply(btc.circulating_supply);
      var kpiChange = $('#kpiChange'); if (kpiChange) { kpiChange.textContent = formatPct(btc.price_change_percentage_24h); kpiChange.className = 'kpi-value ' + deltaClass(btc.price_change_percentage_24h); }
    }
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
    var el = $('#pmMarkets');
    if (el) el.innerHTML = '<div class="pm-error">Polymarket data unavailable: ' + escapeHtml(msg) + '</div>';
  }

  function renderPolymarket() {
    var grid = $('#pmMarkets');
    if (!grid || !state.polymarketData) return;

    var horizons = state.polymarketData.horizons || {};
    var filter = state.polymarketFilter;

    // Flatten all horizon groups into a flat list of displayable items
    var allItems = [];
    ['short', 'mid', 'long'].forEach(function(h) {
      (horizons[h] || []).forEach(function(group) {
        // Each group has sub-markets with individual questions
        (group.markets || []).forEach(function(m) {
          allItems.push({
            id: group.id + '_' + (m.conditionId || m.question),
            question: m.question,
            label: group.label || group.title,
            horizon: h,
            yes_prob: m.lastTradePrice,
            volume: group.totalVolume,
            liquidity: group.liquidity,
            url: group.url,
            slug: group.slug
          });
        });
      });
    });

    var filtered = filter === 'all' ? allItems : allItems.filter(function(m) { return m.horizon === filter; });

    if (!filtered.length) {
      grid.innerHTML = '<div class="pm-empty">No markets match this filter.</div>';
      return;
    }

    grid.innerHTML = filtered.map(function(m) {
      var yesProb = m.yes_prob != null ? (m.yes_prob * 100).toFixed(1) : null;
      var noProb = yesProb != null ? (100 - parseFloat(yesProb)).toFixed(1) : null;
      var vol = m.volume != null ? formatCompact(m.volume) : '—';
      var liq = m.liquidity != null ? formatCompact(m.liquidity) : '—';

      var outcomesHtml = '';
      if (yesProb != null) {
        var pct = parseFloat(yesProb);
        outcomesHtml = '<div class="pm-outcomes">'
          + '<div class="pm-outcome-row yes"><span class="pm-outcome-label">YES</span>'
          + '<div class="pm-outcome-bar-wrap"><div class="pm-outcome-bar" style="width:' + pct + '%"></div></div>'
          + '<span class="pm-outcome-pct">' + yesProb + '%</span></div>'
          + '<div class="pm-outcome-row no"><span class="pm-outcome-label">NO</span>'
          + '<div class="pm-outcome-bar-wrap"><div class="pm-outcome-bar" style="width:' + noProb + '%"></div></div>'
          + '<span class="pm-outcome-pct">' + noProb + '%</span></div>'
          + '</div>';
      }

      return '<div class="pm-market-card">'
        + '<div class="pm-market-header">'
          + '<div class="pm-market-question">' + escapeHtml(m.question) + '</div>'
          + '<div class="pm-market-meta">'
            + '<span class="pm-market-volume">Vol ' + vol + '</span>'
            + '<span class="pm-market-expires">' + m.horizon.toUpperCase() + '</span>'
          + '</div>'
        + '</div>'
        + outcomesHtml
      + '</div>';
    }).join('');
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
    var tabs = $$('#pmHorizonTabs .pm-tab');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        tabs.forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        state.polymarketFilter = tab.dataset.horizon || 'all';
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
    var grid = $('#macroGrid');
    if (!grid || !data) return;

    var cards = [];
    // Fear & Greed
    if (data.fear_greed) {
      var fg = data.fear_greed;
      var fgColor = fg.value < 25 ? '#ef4444' : fg.value < 45 ? '#f97316' : fg.value < 55 ? '#eab308' : fg.value < 75 ? '#84cc16' : '#22c55e';
      cards.push({ label: 'FEAR & GREED', value: fg.value + ' — ' + fg.label, cls: '', color: fgColor });
    }
    // Global market data
    if (data.global) {
      var g = data.global;
      cards.push({ label: 'TOTAL CRYPTO MCAP', value: formatCompact(g.total_market_cap_usd), sub: deltaArrow(g.market_cap_change_24h) + ' ' + Math.abs(g.market_cap_change_24h || 0).toFixed(2) + '%', cls: deltaClass(g.market_cap_change_24h) });
      cards.push({ label: '24H VOLUME', value: formatCompact(g.total_volume_24h_usd), cls: '' });
      cards.push({ label: 'BTC DOMINANCE', value: (g.btc_dominance || 0).toFixed(1) + '%', cls: '' });
      cards.push({ label: 'ETH DOMINANCE', value: (g.eth_dominance || 0).toFixed(1) + '%', cls: '' });
      cards.push({ label: 'ACTIVE CRYPTOS', value: (g.active_cryptos || 0).toLocaleString(), cls: '' });

      // Populate KPIs from global data
      var kpiMcap = $('#kpiMcap'); if (kpiMcap) kpiMcap.textContent = formatCompact(g.total_market_cap_usd);
      var kpiVol = $('#kpiVol'); if (kpiVol) kpiVol.textContent = formatCompact(g.total_volume_24h_usd);
      var kpiDom = $('#kpiDom'); if (kpiDom) kpiDom.textContent = (g.btc_dominance || 0).toFixed(1) + '%';
      var kpiMcapD = $('#kpiMcapDelta'); if (kpiMcapD) { kpiMcapD.textContent = formatPct(g.market_cap_change_24h); kpiMcapD.className = 'kpi-delta ' + deltaClass(g.market_cap_change_24h); }
    }
    // Cross asset
    if (data.cross_asset) {
      var ca = data.cross_asset;
      if (ca.gold_proxy_price) cards.push({ label: 'GOLD (' + ca.gold_proxy_symbol + ')', value: '$' + ca.gold_proxy_price.toFixed(2), sub: deltaArrow(ca.gold_proxy_change_24h) + ' ' + Math.abs(ca.gold_proxy_change_24h || 0).toFixed(2) + '%', cls: deltaClass(ca.gold_proxy_change_24h) });
      if (ca.eth_btc_ratio) cards.push({ label: 'ETH/BTC', value: ca.eth_btc_ratio.toFixed(6), cls: '' });
    }

    grid.innerHTML = cards.map(function(c) {
      return '<div class="deriv-card">' +
        '<div class="deriv-label">' + c.label + '</div>' +
        '<div class="deriv-value' + (c.color ? '" style="color:' + c.color : '') + '">' + c.value + '</div>' +
        (c.sub ? '<div class="deriv-sub ' + (c.cls || '') + '">' + c.sub + '</div>' : '') +
        '</div>';
    }).join('');
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
    var grid = $('#volGrid');
    if (!grid || !data) return;

    var cards = [];
    // Realized vol
    if (data.realized) {
      cards.push({ label: 'REALIZED VOL 7D', value: data.realized.vol_7d.toFixed(1) + '%' });
      cards.push({ label: 'REALIZED VOL 30D', value: data.realized.vol_30d.toFixed(1) + '%' });
      cards.push({ label: 'REALIZED VOL 90D', value: data.realized.vol_90d.toFixed(1) + '%' });
    }
    // Implied vol
    if (data.implied) {
      cards.push({ label: 'ATM IMPLIED VOL', value: data.implied.atm_iv.toFixed(1) + '%' });
      cards.push({ label: 'IV RANK', value: data.implied.iv_rank.toFixed(1) + '%' });
      cards.push({ label: 'PUT/CALL RATIO', value: data.implied.put_call_ratio.toFixed(4) });
      cards.push({ label: 'OPTION COUNT', value: data.implied.option_count.toLocaleString() });
    }
    // HV/IV ratio
    if (data.hv_iv_ratio != null) {
      cards.push({ label: 'HV/IV RATIO', value: data.hv_iv_ratio.toFixed(2) });
    }
    // Deribit index
    if (data.deribit_index != null) {
      cards.push({ label: 'DERIBIT INDEX', value: '$' + formatPrice(data.deribit_index, 2) });
    }

    grid.innerHTML = cards.map(function(c) {
      return '<div class="deriv-card">' +
        '<div class="deriv-label">' + c.label + '</div>' +
        '<div class="deriv-value">' + c.value + '</div>' +
        '</div>';
    }).join('');
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
    var grid = $('#onchainGrid');
    if (!grid || !data) return;

    var cards = [];
    // Mempool
    if (data.mempool) {
      var mp = data.mempool;
      cards.push({ label: 'MEMPOOL TXS', value: mp.tx_count.toLocaleString() });
      cards.push({ label: 'MEMPOOL SIZE', value: mp.vsize_mb.toFixed(1) + ' MB' });
      cards.push({ label: 'FEE (FAST)', value: mp.fee_fast + ' sat/vB' });
      cards.push({ label: 'FEE (SLOW)', value: mp.fee_slow + ' sat/vB' });
      cards.push({ label: 'CONGESTION', value: mp.congestion.toUpperCase() });
    }
    // Mining
    if (data.mining) {
      var m = data.mining;
      cards.push({ label: 'HASHRATE', value: m.hashrate_eh.toFixed(1) + ' EH/s' });
      cards.push({ label: 'BLOCK HEIGHT', value: m.latest_block_height.toLocaleString() });
      cards.push({ label: 'DIFFICULTY', value: (m.difficulty / 1e12).toFixed(2) + 'T' });
      cards.push({ label: 'NEXT ADJUST', value: (m.next_adjustment_pct >= 0 ? '+' : '') + m.next_adjustment_pct.toFixed(2) + '%' });
      cards.push({ label: 'BLOCKS TO HALVING', value: m.blocks_until_halving.toLocaleString() });
    }
    // Lightning
    if (data.lightning) {
      var ln = data.lightning;
      cards.push({ label: 'LN CAPACITY', value: ln.capacity_btc.toFixed(0) + ' BTC' });
      cards.push({ label: 'LN CHANNELS', value: ln.channel_count.toLocaleString() });
      cards.push({ label: 'LN NODES', value: ln.node_count.toLocaleString() });
    }

    grid.innerHTML = cards.map(function(c) {
      return '<div class="deriv-card">' +
        '<div class="deriv-label">' + c.label + '</div>' +
        '<div class="deriv-value">' + c.value + '</div>' +
        '</div>';
    }).join('');
  }

  // ============================================
  // DERIVATIVES (F09)
  // ============================================
  async function loadDerivatives() {
    try {
      var resp = await fetch(CGI_BIN + '/derivatives.py');
      if (!resp.ok) throw new Error('Derivatives fetch failed: ' + resp.status);
      var data = await resp.json();
      renderDerivatives(data);
    } catch (e) {
      console.error('Derivatives load error:', e);
    }
  }

  function renderDerivatives(data) {
    var grid = $('#derivGrid');
    if (!grid || !data) return;

    var cards = [];

    // Funding Rate (avg across exchanges)
    if (data.funding) {
      var avg = data.funding.avg;
      var annualized = avg != null ? (avg * 365 * 3 * 100).toFixed(2) : null;
      cards.push({ label: 'FUNDING RATE', value: avg != null ? (avg * 100).toFixed(4) + '%' : '--', sub: annualized ? 'Ann. ' + annualized + '%' : '', cls: avg >= 0 ? 'pos' : 'neg' });

      // Per-exchange
      ['binance', 'okx', 'deribit', 'bybit'].forEach(function(ex) {
        var d = data.funding[ex];
        if (d) {
          var r = d.rate;
          cards.push({ label: ex.toUpperCase() + ' FUNDING', value: (r * 100).toFixed(4) + '%', sub: d.annualized ? 'Ann. ' + d.annualized.toFixed(2) + '%' : '', cls: r >= 0 ? 'pos' : 'neg' });
        }
      });
    }

    // Open Interest
    if (data.open_interest) {
      cards.push({ label: 'TOTAL OPEN INTEREST', value: formatCompact(data.open_interest.total_usd), sub: '', cls: '' });
      if (data.open_interest.binance) cards.push({ label: 'BINANCE OI', value: formatCompact(data.open_interest.binance.usd), sub: '', cls: '' });
      if (data.open_interest.bybit) cards.push({ label: 'BYBIT OI', value: formatCompact(data.open_interest.bybit.usd), sub: '', cls: '' });
    }

    // Basis
    if (data.basis) {
      cards.push({ label: 'BASIS', value: data.basis.basis_pct.toFixed(3) + '%', sub: 'Ann. ' + data.basis.annualized_basis.toFixed(1) + '%', cls: data.basis.basis_pct >= 0 ? 'pos' : 'neg' });
    }

    // Liquidations
    if (data.liquidations_24h) {
      var liq = data.liquidations_24h;
      cards.push({ label: 'LONGS LIQUIDATED 24H', value: formatCompact(liq.long_usd), sub: '', cls: 'neg' });
      cards.push({ label: 'SHORTS LIQUIDATED 24H', value: formatCompact(liq.short_usd), sub: '', cls: 'pos' });
    }

    // Long/Short Ratio
    if (data.long_short_ratio) {
      var ls = data.long_short_ratio;
      cards.push({ label: 'LONG/SHORT RATIO', value: ls.ratio.toFixed(3), sub: 'L ' + ls.long_pct.toFixed(1) + '% / S ' + ls.short_pct.toFixed(1) + '%', cls: ls.ratio >= 1 ? 'pos' : 'neg' });
    }

    grid.innerHTML = cards.map(function(c) {
      return '<div class="deriv-card">' +
        '<div class="deriv-label">' + c.label + '</div>' +
        '<div class="deriv-value ' + c.cls + '">' + c.value + '</div>' +
        (c.sub ? '<div class="deriv-sub">' + c.sub + '</div>' : '') +
        '</div>';
    }).join('');
  }

  // ============================================
  // BTC UP OR DOWN (F07)
  // ============================================
  var updownInterval = null;

  async function loadUpdown() {
    try {
      var resp = await fetch(CGI_BIN + '/updown.py');
      if (!resp.ok) throw new Error('Updown fetch failed: ' + resp.status);
      var data = await resp.json();
      renderUpdown(data);
    } catch (e) {
      console.error('Updown load error:', e);
    }
  }

  function renderUpdown(data) {
    if (!data || !data.active) return;

    var refEl = $('#updownRefPrice');
    var timerEl = $('#updownTimer');
    var upPctEl = $('#updownUpPct');
    var downPctEl = $('#updownDownPct');
    var barUp = $('#updownBarUp');
    var barDown = $('#updownBarDown');
    var profitUp = $('#updownProfitUp');
    var profitDown = $('#updownProfitDown');
    var windowEl = $('#updownWindow');
    var linkEl = $('#updownLink');

    if (refEl) refEl.textContent = '$' + formatPrice(data.ref_price, 2);
    if (upPctEl) upPctEl.textContent = data.up_pct.toFixed(1) + '%';
    if (downPctEl) downPctEl.textContent = data.down_pct.toFixed(1) + '%';
    if (barUp) barUp.style.width = data.up_pct + '%';
    if (barDown) barDown.style.width = data.down_pct + '%';
    if (profitUp) profitUp.textContent = data.payout_up.toFixed(2) + 'x';
    if (profitDown) profitDown.textContent = data.payout_down.toFixed(2) + 'x';
    if (windowEl) windowEl.textContent = data.time_label;
    if (linkEl && data.url) linkEl.href = data.url;

    // Countdown timer
    if (updownInterval) clearInterval(updownInterval);
    var remaining = data.remaining_seconds;
    function tick() {
      if (remaining <= 0) {
        if (timerEl) timerEl.textContent = 'SETTLED';
        clearInterval(updownInterval);
        setTimeout(loadUpdown, 5000);
        return;
      }
      var m = Math.floor(remaining / 60);
      var s = remaining % 60;
      if (timerEl) timerEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
      remaining--;
    }
    tick();
    updownInterval = setInterval(tick, 1000);
  }

  // ============================================
  // EVENT CALENDAR (F14)
  // ============================================
  var calendarData = [];
  var calendarFilter = 'all';

  async function loadCalendar() {
    try {
      var resp = await fetch(CGI_BIN + '/btc_calendar.py');
      if (!resp.ok) throw new Error('Calendar fetch failed: ' + resp.status);
      var data = await resp.json();
      calendarData = data.events || [];
      renderCalendar();
    } catch (e) {
      console.error('Calendar load error:', e);
    }
  }

  function renderCalendar() {
    var list = $('#calList');
    if (!list) return;

    var filtered = calendarFilter === 'all'
      ? calendarData
      : calendarData.filter(function(ev) { return ev.category === calendarFilter; });

    // Sort: upcoming first, then past (newest past first)
    var now = Date.now() / 1000;
    filtered.sort(function(a, b) {
      var aFuture = a.timestamp >= now ? 0 : 1;
      var bFuture = b.timestamp >= now ? 0 : 1;
      if (aFuture !== bFuture) return aFuture - bFuture;
      return aFuture === 0 ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div class="news-loading">No events</div>';
      return;
    }

    list.innerHTML = filtered.map(function(ev) {
      var impactCls = ev.impact || 'medium';
      var catCls = ev.category === 'crypto' ? 'crypto' : (ev.category === 'etf' ? 'crypto' : '');
      var pastCls = ev.is_past ? ' cal-past' : '';
      return '<div class="cal-item' + pastCls + '">' +
        '<div class="cal-date">' + ev.date + '</div>' +
        '<div class="cal-content">' +
          '<div class="cal-title">' + ev.title + '</div>' +
          '<div class="cal-meta">' +
            '<span class="cal-impact ' + impactCls + ' ' + catCls + '">' + ev.impact.toUpperCase() + '</span>' +
            '<span class="cal-category">' + ev.category + '</span>' +
            (ev.description ? '<span class="cal-desc">' + ev.description + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function initCalendarTabs() {
    var tabContainer = $('#calTabs');
    if (!tabContainer) return;
    tabContainer.addEventListener('click', function(e) {
      var btn = e.target.closest('.news-tab');
      if (!btn) return;
      calendarFilter = btn.dataset.cal || 'all';
      tabContainer.querySelectorAll('.news-tab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      renderCalendar();
    });
  }

  // ============================================
  // ADDRESS INSPECTOR (F15)
  // ============================================
  function initAddressInspector() {
    var panel = $('#addressPanel');
    var input = $('#addrInput');
    var btn = $('#addrGoBtn');
    var result = $('#addrResult');
    var closeBtn = $('#addressCloseBtn');

    // Show panel when Address nav is clicked
    var addrNav = document.querySelector('[data-nav="address"]');
    if (addrNav) {
      addrNav.addEventListener('click', function() {
        if (panel) panel.style.display = '';
        if (input) input.focus();
      });
    }
    if (closeBtn && panel) {
      closeBtn.addEventListener('click', function() { panel.style.display = 'none'; });
    }

    function doLookup() {
      var q = input ? input.value.trim() : '';
      if (!q || !result) return;
      result.innerHTML = '<div class="news-loading"><span class="spinner"></span>Inspecting...</div>';
      fetch(CGI_BIN + '/address.py?q=' + encodeURIComponent(q))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.error) {
            result.innerHTML = '<div class="addr-error">' + data.error + '</div>';
            return;
          }
          var html = '';
          if (data.type === 'address' && data.address) {
            var a = data.address;
            html = '<div class="deriv-grid">' +
              '<div class="deriv-card"><div class="deriv-label">ADDRESS</div><div class="deriv-value" style="font-size:0.65rem;word-break:break-all">' + a.address + '</div></div>' +
              '<div class="deriv-card"><div class="deriv-label">BALANCE</div><div class="deriv-value">' + (a.funded_txo_sum != null ? ((a.funded_txo_sum - (a.spent_txo_sum || 0)) / 1e8).toFixed(8) + ' BTC' : '--') + '</div></div>' +
              '<div class="deriv-card"><div class="deriv-label">TX COUNT</div><div class="deriv-value">' + (a.tx_count || 0) + '</div></div>' +
              '<div class="deriv-card"><div class="deriv-label">TOTAL RECEIVED</div><div class="deriv-value">' + (a.funded_txo_sum != null ? (a.funded_txo_sum / 1e8).toFixed(8) + ' BTC' : '--') + '</div></div>' +
              '</div>';
          } else if (data.type === 'tx' && data.tx) {
            var tx = data.tx;
            html = '<div class="deriv-grid">' +
              '<div class="deriv-card"><div class="deriv-label">TXID</div><div class="deriv-value" style="font-size:0.6rem;word-break:break-all">' + tx.txid + '</div></div>' +
              '<div class="deriv-card"><div class="deriv-label">STATUS</div><div class="deriv-value">' + (tx.status && tx.status.confirmed ? 'Confirmed' : 'Unconfirmed') + '</div></div>' +
              '<div class="deriv-card"><div class="deriv-label">SIZE</div><div class="deriv-value">' + (tx.size || '--') + ' bytes</div></div>' +
              '<div class="deriv-card"><div class="deriv-label">FEE</div><div class="deriv-value">' + (tx.fee != null ? tx.fee + ' sat' : '--') + '</div></div>' +
              '</div>';
          } else {
            html = '<pre style="color:var(--color-text-faint);font-size:0.7rem;white-space:pre-wrap">' + JSON.stringify(data, null, 2) + '</pre>';
          }
          result.innerHTML = html;
        })
        .catch(function(e) {
          result.innerHTML = '<div class="addr-error">Error: ' + e.message + '</div>';
        });
    }

    if (btn) btn.addEventListener('click', doLookup);
    if (input) input.addEventListener('keydown', function(e) { if (e.key === 'Enter') doLookup(); });
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
    loadDerivatives();
    loadUpdown();
    loadCalendar();
    initCalendarTabs();
    initAddressInspector();

    // Periodic refreshes
    setInterval(loadWatchlist, 30000);
    setInterval(loadNews, 300000);
    setInterval(loadPolymarket, 60000);
    setInterval(loadMacro, 300000);
    setInterval(loadVolatility, 60000);
    setInterval(loadDerivatives, 30000);
    setInterval(loadUpdown, 10000);
    setInterval(loadCalendar, 600000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
