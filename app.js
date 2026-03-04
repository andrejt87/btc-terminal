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
    return n >= 0 ? 'positive' : 'negative';
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
      html += '<a class="news-item" href="' + escapeHtml(item.link) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="news-item-time">' + formatNewsTime(item.timestamp) + '</span>' +
        '<div class="news-item-content">' +
          '<div class="news-item-title">' + escapeHtml(item.title) + '</div>' +
          (item.summary ? '<div class="news-item-summary">' + escapeHtml(item.summary) + '</div>' : '') +
        '</div>' +
        '<span class="news-item-source">' + escapeHtml(item.source) + '</span>' +
      '</a>';
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

    // Resize main chart
    setTimeout(function() {
      if (chartObj && mainWrap.clientWidth > 0) {
        chartObj.applyOptions({ width: mainWrap.clientWidth, height: mainWrap.clientHeight });
      }
    }, 100);
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
  // ORDERBOOK (F04)
  // ============================================
  var obData = { asks: [], bids: [] };

  async function loadOrderbook() {
    try {
      var resp = await fetch('https://data-api.binance.vision/api/v3/depth?symbol=' + state.symbol + '&limit=20');
      if (!resp.ok) throw new Error('Orderbook fetch failed');
      var data = await resp.json();
      obData.asks = data.asks.slice(0, 15).reverse();
      obData.bids = data.bids.slice(0, 15);
      renderOrderbook();
    } catch (e) {
      console.error('Orderbook load error:', e);
    }
  }

  function connectDepthWS() {
    if (state.wsDepth) { try { state.wsDepth.close(); } catch(e) {} }
    var pair = state.symbol.toLowerCase();
    var url = 'wss://stream.binance.com:9443/ws/' + pair + '@depth20@100ms';

    try { state.wsDepth = new WebSocket(url); } catch(e) { return; }

    state.wsDepth.onopen = function() { state.reconnectAttemptsDepth = 0; };

    state.wsDepth.onmessage = function(evt) {
      try {
        var d = JSON.parse(evt.data);
        if (d.asks && d.bids) {
          obData.asks = d.asks.slice(0, 15).reverse();
          obData.bids = d.bids.slice(0, 15);
          renderOrderbook();
        }
      } catch(e) {}
    };

    state.wsDepth.onclose = function() {
      scheduleReconnect('depth');
    };
  }

  function renderOrderbook() {
    var asksBody = $('#asksBody');
    var bidsBody = $('#bidsBody');
    var asksContainer = $('#orderbookAsks');
    var bidsContainer = $('#orderbookBids');

    if (!obData.asks.length && !obData.bids.length) return;

    var maxAskTotal = obData.asks.reduce(function(a, b) { return a + parseFloat(b[1]); }, 0);
    var maxBidTotal = obData.bids.reduce(function(a, b) { return a + parseFloat(b[1]); }, 0);
    var maxTotal = Math.max(maxAskTotal, maxBidTotal) || 1;

    // Preserve scroll positions before DOM update
    var asksScrollTop = asksContainer ? asksContainer.scrollTop : 0;
    var bidsScrollTop = bidsContainer ? bidsContainer.scrollTop : 0;
    var asksIsAtBottom = asksContainer ? (asksContainer.scrollHeight - asksContainer.scrollTop - asksContainer.clientHeight < 2) : true;

    var askHtml = '';
    var askCum = 0;
    for (var i = 0; i < obData.asks.length; i++) {
      var price = obData.asks[i][0];
      var qty = obData.asks[i][1];
      askCum += parseFloat(qty);
      var pct = (askCum / maxTotal * 100).toFixed(1);
      askHtml += '<tr class="ob-row ask"><td class="ob-price">' + formatPrice(parseFloat(price), 2) +
        '</td><td>' + parseFloat(qty).toFixed(5) +
        '</td><td style="position:relative;">' + askCum.toFixed(5) +
        '<span class="ob-bar" style="width:' + pct + '%;position:absolute;top:0;bottom:0;right:0;"></span></td></tr>';
    }
    asksBody.innerHTML = askHtml;

    var bidHtml = '';
    var bidCum = 0;
    for (var i = 0; i < obData.bids.length; i++) {
      var price = obData.bids[i][0];
      var qty = obData.bids[i][1];
      bidCum += parseFloat(qty);
      var pct = (bidCum / maxTotal * 100).toFixed(1);
      bidHtml += '<tr class="ob-row bid"><td class="ob-price">' + formatPrice(parseFloat(price), 2) +
        '</td><td>' + parseFloat(qty).toFixed(5) +
        '</td><td style="position:relative;">' + bidCum.toFixed(5) +
        '<span class="ob-bar" style="width:' + pct + '%;position:absolute;top:0;bottom:0;right:0;"></span></td></tr>';
    }
    bidsBody.innerHTML = bidHtml;

    // Restore scroll positions — no auto-scroll
    if (asksContainer) asksContainer.scrollTop = asksScrollTop;
    if (bidsContainer) bidsContainer.scrollTop = bidsScrollTop;

    // Spread
    if (obData.asks.length && obData.bids.length) {
      var bestAsk = parseFloat(obData.asks[obData.asks.length - 1][0]);
      var bestBid = parseFloat(obData.bids[0][0]);
      var spread = bestAsk - bestBid;
      var spreadPct = ((spread / bestAsk) * 100).toFixed(4);
      $('#obSpread').textContent = 'Spread: $' + formatPrice(spread, 2) + ' (' + spreadPct + '%)';
    }
  }

  // ============================================
  // KPI CARDS (F05)
  // ============================================
  async function loadKPIs() {
    try {
      var responses = await Promise.allSettled([
        fetch('https://api.coingecko.com/api/v3/coins/' + state.cgId + '?localization=false&tickers=false&community_data=false&developer_data=false'),
        fetch('https://api.coingecko.com/api/v3/global'),
      ]);

      if (responses[0].status === 'fulfilled' && responses[0].value.ok) {
        var coin = await responses[0].value.json();
        var md = coin.market_data;

        animateValue('#kpiMcap', '$' + formatCompactRaw(md.market_cap.usd));
        animateValue('#kpiVol', '$' + formatCompactRaw(md.total_volume.usd));
        animateValue('#kpiAth', '$' + formatPrice(md.ath.usd, 2));
        animateValue('#kpiSupply', formatSupply(md.circulating_supply));

        var change24 = md.price_change_percentage_24h;
        animateValue('#kpiChange', formatPct(change24));
        var kpiChangeEl = $('#kpiChange');
        kpiChangeEl.className = 'kpi-value';
        if (change24 >= 0) kpiChangeEl.style.color = 'var(--color-success)';
        else kpiChangeEl.style.color = 'var(--color-error)';

        var athChange = md.ath_change_percentage.usd;
        var athDeltaEl = $('#kpiAthDelta');
        athDeltaEl.textContent = deltaArrow(athChange) + ' ' + formatPct(athChange);
        athDeltaEl.className = 'kpi-delta ' + deltaClass(athChange);
      }

      if (responses[1].status === 'fulfilled' && responses[1].value.ok) {
        var g = await responses[1].value.json();
        var dom = g.data.market_cap_percentage.btc;
        animateValue('#kpiDom', dom.toFixed(1) + '%');
      }
    } catch (e) {
      console.error('KPI load error:', e);
    }
  }

  function animateValue(selector, newValue) {
    var el = $(selector);
    if (!el) return;
    el.textContent = newValue;
    el.classList.add('number-pop');
    setTimeout(function() { el.classList.remove('number-pop'); }, 300);
  }

  // ============================================
  // WATCHLIST (F07)
  // ============================================
  async function loadWatchlist() {
    try {
      var resp = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana,binancecoin,ripple,cardano,dogecoin,polkadot&order=market_cap_desc&sparkline=true&price_change_percentage=7d');
      if (!resp.ok) throw new Error('Watchlist fetch failed');
      state.watchlistData = await resp.json();
      renderWatchlist();
    } catch (e) {
      console.error('Watchlist load error:', e);
    }
  }

  function renderWatchlist() {
    var data = state.watchlistData.slice();
    var key = state.watchlistSort.key;
    var asc = state.watchlistSort.asc;

    data.sort(function(a, b) {
      var va = a[key], vb = b[key];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va == null) va = 0;
      if (vb == null) vb = 0;
      return asc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

    var body = $('#watchlistBody');
    body.innerHTML = data.map(function(c) {
      var change24 = c.price_change_percentage_24h;
      var change7d = c.price_change_percentage_7d_in_currency;
      var sparkData = c.sparkline_in_7d ? c.sparkline_in_7d.price : [];
      var sparkColor = (change7d != null && change7d >= 0) ? '#22c55e' : '#ef4444';
      var sparkSvg = renderSparkline(sparkData, sparkColor);

      return '<tr>' +
        '<td>' + (c.market_cap_rank || '') + '</td>' +
        '<td><div class="wl-symbol"><div class="wl-icon">' + (c.symbol || '').toUpperCase().slice(0, 2) + '</div><div><div class="wl-name">' + c.name + '</div><div class="wl-ticker">' + (c.symbol || '').toUpperCase() + '</div></div></div></td>' +
        '<td>$' + formatPrice(c.current_price) + '</td>' +
        '<td class="' + deltaClass(change24) + '-text">' + formatPct(change24) + '</td>' +
        '<td class="' + deltaClass(change7d) + '-text">' + formatPct(change7d) + '</td>' +
        '<td>' + formatCompact(c.market_cap) + '</td>' +
        '<td>' + formatCompact(c.total_volume) + '</td>' +
        '<td class="sparkline-cell">' + sparkSvg + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderSparkline(data, color) {
    if (!data || data.length < 2) return '';
    var w = 80, h = 28, pad = 2;
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    var range = max - min || 1;
    var step = (w - pad * 2) / (data.length - 1);

    var path = '';
    for (var i = 0; i < data.length; i++) {
      var x = pad + i * step;
      var y = pad + (1 - (data[i] - min) / range) * (h - pad * 2);
      path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }

    return '<svg viewBox="0 0 ' + w + ' ' + h + '" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="' + path + '" stroke="' + color + '" stroke-width="1.5" fill="none" vector-effect="non-scaling-stroke"/></svg>';
  }

  // Sort
  $$('.watchlist-table th[data-sort]').forEach(function(th) {
    th.addEventListener('click', function() {
      var key = th.dataset.sort;
      if (state.watchlistSort.key === key) {
        state.watchlistSort.asc = !state.watchlistSort.asc;
      } else {
        state.watchlistSort.key = key;
        state.watchlistSort.asc = true;
      }
      $$('.watchlist-table th').forEach(function(t) { t.classList.remove('sorted'); });
      th.classList.add('sorted');
      renderWatchlist();
    });
  });

  // ============================================
  // COMMAND LINE (F08)
  // ============================================
  var commands = [
    { cmd: 'BTC', aliases: ['BTC <GO>', 'BITCOIN'], desc: 'Bitcoin dashboard', action: function() { switchAsset('BTCUSDT', 'bitcoin', 'BTC/USD'); } },
    { cmd: 'ETH', aliases: ['ETH <GO>', 'ETHEREUM'], desc: 'Switch to Ethereum', action: function() { switchAsset('ETHUSDT', 'ethereum', 'ETH/USD'); } },
    { cmd: 'SOL', aliases: ['SOL <GO>', 'SOLANA'], desc: 'Switch to Solana', action: function() { switchAsset('SOLUSDT', 'solana', 'SOL/USD'); } },
    { cmd: 'NEWS', aliases: ['NEWS <GO>'], desc: 'Open news panel', action: function() {
      var panel = $('#newsPanel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth' });
    } },
    { cmd: 'ODDS', aliases: ['ODDS <GO>', 'POLYMARKET', 'BETS'], desc: 'Polymarket BTC odds', action: function() {
      var panel = $('#polymarketPanel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth' });
    } },
    { cmd: 'CHART 1M', aliases: [], desc: 'Chart 1-minute', action: function() { setChartInterval('1m'); } },
    { cmd: 'CHART 5M', aliases: [], desc: 'Chart 5-minute', action: function() { setChartInterval('5m'); } },
    { cmd: 'CHART 15M', aliases: [], desc: 'Chart 15-minute', action: function() { setChartInterval('15m'); } },
    { cmd: 'CHART 1H', aliases: [], desc: 'Chart 1-hour', action: function() { setChartInterval('1h'); } },
    { cmd: 'CHART 4H', aliases: [], desc: 'Chart 4-hour', action: function() { setChartInterval('4h'); } },
    { cmd: 'CHART 1D', aliases: [], desc: 'Chart daily', action: function() { setChartInterval('1d'); } },
    { cmd: 'CHART 1W', aliases: [], desc: 'Chart weekly', action: function() { setChartInterval('1w'); } },
    { cmd: 'HELP', aliases: ['HELP <GO>'], desc: 'Show commands', action: function() { showHelp(); } },
    { cmd: 'DERIV', aliases: ['DERIV <GO>', 'DERIVATIVES', 'FUNDING'], desc: 'Derivatives panel', action: function() { scrollToPanel('#derivativesPanel'); } },
    { cmd: 'CHAIN', aliases: ['CHAIN <GO>', 'ONCHAIN', 'ON-CHAIN', 'MEMPOOL'], desc: 'On-chain data', action: function() { scrollToPanel('#onchainPanel'); } },
    { cmd: 'MACRO', aliases: ['MACRO <GO>', 'DXY', 'GOLD', 'FLOWS'], desc: 'Macro & flows', action: function() { scrollToPanel('#macroPanel'); } },
    { cmd: 'VOL', aliases: ['VOL <GO>', 'VOLATILITY', 'IV'], desc: 'Volatility panel', action: function() { scrollToPanel('#volPanel'); } },
    { cmd: 'CAL', aliases: ['CAL <GO>', 'CALENDAR', 'EVENTS', 'FOMC', 'CPI'], desc: 'Event calendar', action: function() { scrollToPanel('#calendarPanel'); } },
    { cmd: 'ADDR', aliases: ['ADDR <GO>', 'ADDRESS', 'TX', 'INSPECT'], desc: 'Address inspector', action: function() { showPanel('#addressPanel'); } },
    { cmd: 'NOTE', aliases: ['NOTE <GO>', 'NOTEBOOK', 'BLOTTER'], desc: 'Trade notebook', action: function() { showPanel('#notebookPanel'); } },
    { cmd: 'EXPORT', aliases: ['EXPORT <GO>'], desc: 'Export data as CSV', action: function() { exportCSV(); } },
    { cmd: 'INFO', aliases: ['INFO <GO>', 'GLOSSAR', 'HELP INFO'], desc: 'Glossar & Erklärungen', action: function() { window.open('./info.html', '_blank'); } },
  ];

  function setChartInterval(val) {
    state.interval = val;
    $$('.chart-interval-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.interval === val);
    });
    loadChartData();
  }

  function switchAsset(symbol, cgId, label) {
    state.symbol = symbol;
    state.cgId = cgId;
    $('#priceSymbol').textContent = label;
    $('#obSymbol').textContent = symbol;
    // Update chart panel title
    var chartTitle = $('#chartPanel .panel-title');
    if (chartTitle) chartTitle.textContent = label + ' Chart';

    // Reconnect everything
    state.reconnectAttempts = 0;
    state.reconnectAttemptsDepth = 0;
    connectTickerWS();
    connectDepthWS();
    loadChartData();
    loadOrderbook();
    loadPriceREST();
    loadKPIs();
  }

  function showHelp() {
    $('#helpOverlay').classList.add('active');
  }

  $('#helpClose').addEventListener('click', function() {
    $('#helpOverlay').classList.remove('active');
  });

  $('#helpOverlay').addEventListener('click', function(e) {
    if (e.target === e.currentTarget) {
      $('#helpOverlay').classList.remove('active');
    }
  });

  var cmdInput = $('#commandInput');
  var cmdAutocomplete = $('#commandAutocomplete');

  cmdInput.addEventListener('input', function() {
    var val = cmdInput.value.toUpperCase().trim();
    if (!val) {
      cmdAutocomplete.classList.remove('active');
      return;
    }

    var matches = commands.filter(function(c) {
      return c.cmd.includes(val) || c.aliases.some(function(a) { return a.includes(val); });
    }).slice(0, 6);

    if (matches.length) {
      cmdAutocomplete.innerHTML = matches.map(function(m, i) {
        return '<div class="autocomplete-item" data-index="' + i + '"><span class="cmd">' + m.cmd + '</span><span class="desc">' + m.desc + '</span></div>';
      }).join('');
      cmdAutocomplete.classList.add('active');

      cmdAutocomplete.querySelectorAll('.autocomplete-item').forEach(function(item, i) {
        item.addEventListener('click', function() {
          matches[i].action();
          cmdInput.value = '';
          cmdAutocomplete.classList.remove('active');
        });
      });
    } else {
      cmdAutocomplete.classList.remove('active');
    }
  });

  function executeCommand() {
    var val = cmdInput.value.toUpperCase().trim().replace(/<GO>/g, '').trim();
    if (!val) return;

    var match = commands.find(function(c) {
      return c.cmd === val || c.aliases.some(function(a) { return a.replace(/<GO>/g, '').trim() === val; });
    });

    if (match) match.action();

    cmdInput.value = '';
    cmdAutocomplete.classList.remove('active');
  }

  cmdInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      executeCommand();
    } else if (e.key === 'Escape') {
      cmdAutocomplete.classList.remove('active');
      cmdInput.blur();
    }
  });

  $('#commandGoBtn').addEventListener('click', executeCommand);

  // Keyboard shortcut: / to focus command line
  document.addEventListener('keydown', function(e) {
    if (e.key === '/' && document.activeElement !== cmdInput) {
      e.preventDefault();
      cmdInput.focus();
    }
    if (e.key === 'Escape') {
      $('#helpOverlay').classList.remove('active');
    }
    // Panel hotkeys — only when command input is not focused
    if (document.activeElement !== cmdInput &&
        document.activeElement.tagName !== 'INPUT' &&
        document.activeElement.tagName !== 'TEXTAREA') {
      switch(e.key) {
        case 'd': scrollToPanel('#derivativesPanel'); break;
        case 'c': scrollToPanel('#onchainPanel'); break;
        case 'm': scrollToPanel('#macroPanel'); break;
        case 'v': scrollToPanel('#volPanel'); break;
        case 'e': scrollToPanel('#calendarPanel'); break;
        case 'n': scrollToPanel('#newsPanel'); break;
        case 'a': showPanel('#addressPanel'); break;
      }
    }
  });

  // Close autocomplete on outside click
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.command-line')) {
      cmdAutocomplete.classList.remove('active');
    }
  });

  // ============================================
  // SIDEBAR NAV
  // ============================================
  $$('.nav-btn[data-nav]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      $$('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');

      var target = btn.dataset.nav;
      var el = null;
      if (target === 'chart') el = $('#chartPanel');
      else if (target === 'orderbook') el = $('#orderbookPanel');
      else if (target === 'watchlist') el = $('#watchlistPanel');
      else if (target === 'news') el = $('#newsPanel');
      else if (target === 'odds') el = $('#polymarketPanel');
      else if (target === 'derivatives') el = $('#derivativesPanel');
      else if (target === 'onchain') el = $('#onchainPanel');
      else if (target === 'macro') el = $('#macroPanel');
      else if (target === 'calendar') el = $('#calendarPanel');
      else if (target === 'address') {
        el = $('#addressPanel');
        if (el) el.style.display = '';
      } else if (target === 'notebook') {
        el = $('#notebookPanel');
        if (el) el.style.display = '';
      }
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // ============================================
  // BTC UP OR DOWN 5-MIN WIDGET (F12)
  // ============================================
  var updownState = {
    data: null,
    windowEnd: 0,
    countdownInterval: null,
    lastUp: null,
    lastDown: null,
  };

  function renderUpdown() {
    var d = updownState.data;
    var widget = $('#updownWidget');
    if (!widget) return;

    if (!d || !d.active) {
      widget.classList.add('updown-inactive');
      $('#updownUpPct').textContent = '--';
      $('#updownDownPct').textContent = '--';
      $('#updownTimer').textContent = '--:--';
      $('#updownTimer').classList.remove('updown-urgent');
      $('#updownRefPrice').textContent = '--';
      $('#updownProfitUp').textContent = '';
      $('#updownProfitDown').textContent = '';
      $('#updownWindow').textContent = 'No active 5-min market';
      return;
    }

    widget.classList.remove('updown-inactive');

    // Animate percentage changes
    var upEl = $('#updownUpPct');
    var downEl = $('#updownDownPct');

    if (updownState.lastUp !== null && updownState.lastUp !== d.up_pct) {
      upEl.classList.add('pm-flash');
      setTimeout(function() { upEl.classList.remove('pm-flash'); }, 400);
    }
    if (updownState.lastDown !== null && updownState.lastDown !== d.down_pct) {
      downEl.classList.add('pm-flash');
      setTimeout(function() { downEl.classList.remove('pm-flash'); }, 400);
    }

    updownState.lastUp = d.up_pct;
    updownState.lastDown = d.down_pct;

    upEl.textContent = d.up_pct.toFixed(1) + '%';
    downEl.textContent = d.down_pct.toFixed(1) + '%';

    // Progress bars
    var total = d.up_pct + d.down_pct;
    if (total > 0) {
      $('#updownBarUp').style.width = (d.up_pct / total * 100) + '%';
      $('#updownBarDown').style.width = (d.down_pct / total * 100) + '%';
    }

    // Reference price
    var refEl = $('#updownRefPrice');
    if (refEl) {
      refEl.textContent = d.ref_price ? '$' + formatPrice(d.ref_price, 2) : '--';
    }

    // Profit per $1
    var profitUpEl = $('#updownProfitUp');
    var profitDownEl = $('#updownProfitDown');
    if (profitUpEl) {
      profitUpEl.textContent = d.profit_up != null ? '+$' + d.profit_up.toFixed(2) + ' / $1' : '';
    }
    if (profitDownEl) {
      profitDownEl.textContent = d.profit_down != null ? '+$' + d.profit_down.toFixed(2) + ' / $1' : '';
    }

    // Footer
    $('#updownWindow').textContent = d.time_label + ' \u00B7 Vol: ' + formatVolume(d.volume) + ' \u00B7 ' + d.price_source.toUpperCase();
    var link = $('#updownLink');
    if (link && d.url) link.href = d.url;

    // Store window end for countdown
    updownState.windowEnd = d.window_end;
  }

  function updateUpdownCountdown() {
    var timerEl = $('#updownTimer');
    if (!timerEl) return;

    if (!updownState.windowEnd) {
      timerEl.textContent = '--:--';
      timerEl.classList.remove('updown-urgent');
      return;
    }

    var now = Math.floor(Date.now() / 1000);
    var remaining = Math.max(0, updownState.windowEnd - now);
    var min = Math.floor(remaining / 60);
    var sec = remaining % 60;
    timerEl.textContent = min + ':' + String(sec).padStart(2, '0');

    // Urgent mode under 30s
    if (remaining <= 30 && remaining > 0) {
      timerEl.classList.add('updown-urgent');
    } else {
      timerEl.classList.remove('updown-urgent');
    }

    // Window expired — trigger immediate refresh
    if (remaining === 0 && updownState.data && updownState.data.active) {
      updownState.windowEnd = 0;
      // Wait 2s for new market to open, then fetch
      setTimeout(loadUpdown, 2000);
    }
  }

  async function loadUpdown() {
    try {
      var resp = await fetch(CGI_BIN + '/updown.py');
      if (!resp.ok) throw new Error('UpDown fetch failed: ' + resp.status);
      var data = await resp.json();
      updownState.data = data;
      renderUpdown();
    } catch (e) {
      console.error('UpDown load error:', e);
    }
  }

  // Start countdown ticker (every second, client-side)
  updownState.countdownInterval = setInterval(updateUpdownCountdown, 1000);

  // ============================================
  // POLYMARKET ODDS (F11)
  // ============================================
  function formatVolume(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function oddsColorClass(pct) {
    if (pct >= 60) return 'pm-high';
    if (pct >= 25) return 'pm-medium';
    return 'pm-low';
  }

  function renderDuelMarket(market, eventTitle) {
    var o = market.outcomes;
    if (!o || o.length < 2) return '';
    var leftColor = o[0].probability >= o[1].probability ? 'var(--color-success)' : 'var(--color-error)';
    var rightColor = o[1].probability >= o[0].probability ? 'var(--color-success)' : 'var(--color-error)';
    var chartIcon = '<svg class="pm-chart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';

    return '<div class="pm-duel pm-clickable" data-pm-slug="' + escapeHtml(market.slug) + '" data-pm-question="' + escapeHtml(market.question || '') + '" data-pm-event="' + escapeHtml(eventTitle || '') + '">' +
      '<div class="pm-duel-side">' +
        '<span class="pm-duel-label">' + escapeHtml(o[0].outcome) + '</span>' +
        '<span class="pm-duel-value" style="color:' + leftColor + '">' + o[0].probability.toFixed(1) + '%' + chartIcon + '</span>' +
        '<div class="pm-duel-bar"><div class="pm-duel-bar-fill" style="width:' + o[0].probability + '%;background:' + leftColor + '"></div></div>' +
      '</div>' +
      '<span class="pm-duel-vs">VS</span>' +
      '<div class="pm-duel-side">' +
        '<span class="pm-duel-label">' + escapeHtml(o[1].outcome) + '</span>' +
        '<span class="pm-duel-value" style="color:' + rightColor + '">' + o[1].probability.toFixed(1) + '%</span>' +
        '<div class="pm-duel-bar"><div class="pm-duel-bar-fill" style="width:' + o[1].probability + '%;background:' + rightColor + '"></div></div>' +
      '</div>' +
    '</div>';
  }

  function renderOddsGrid(markets, eventTitle) {
    // Filter to key price levels (show most interesting ones)
    var sorted = markets.slice().sort(function(a, b) {
      // Sort by groupTitle price level
      var aNum = parseFloat((a.groupTitle || '').replace(/[^0-9.]/g, '')) || 0;
      var bNum = parseFloat((b.groupTitle || '').replace(/[^0-9.]/g, '')) || 0;
      return aNum - bNum;
    });

    // Limit to top 10 most interesting ones (by volume or probability spread)
    if (sorted.length > 12) {
      sorted = sorted.filter(function(m) {
        var yesProb = m.outcomes[0] ? m.outcomes[0].probability : 0;
        return yesProb >= 2 && yesProb <= 98;
      });
      if (sorted.length > 12) sorted = sorted.slice(0, 12);
    }

    var chartIcon = '<svg class="pm-chart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';
    var html = '<div class="pm-odds-grid">';
    for (var i = 0; i < sorted.length; i++) {
      var m = sorted[i];
      var label = m.groupTitle || m.question;
      var yesProb = m.outcomes[0] ? m.outcomes[0].probability : 0;
      var valueKey = m.slug + '_yes';
      var flashClass = '';

      // Detect change for flash
      if (state.polymarketLastValues[valueKey] !== undefined &&
          state.polymarketLastValues[valueKey] !== yesProb) {
        flashClass = ' pm-flash';
      }
      state.polymarketLastValues[valueKey] = yesProb;

      html += '<div class="pm-odds-item pm-clickable' + flashClass + '" data-pm-slug="' + escapeHtml(m.slug) + '" data-pm-question="' + escapeHtml(m.question || label) + '" data-pm-event="' + escapeHtml(eventTitle || '') + '">' +
        '<span class="pm-odds-label">' + escapeHtml(label) + chartIcon + '</span>' +
        '<span class="pm-odds-value ' + oddsColorClass(yesProb) + '">' + yesProb.toFixed(1) + '%</span>' +
      '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderPolymarket() {
    var container = $('#pmMarkets');
    if (!container || !state.polymarketData) return;

    var data = state.polymarketData;
    var horizons = data.horizons;
    var filter = state.polymarketFilter;
    var html = '';

    var horizonOrder = ['short', 'mid', 'long'];
    var horizonLabels = { short: 'KURZFRISTIG', mid: 'MITTELFRISTIG', long: 'LANGFRISTIG' };
    var badgeClasses = { short: 'pm-badge-short', mid: 'pm-badge-mid', long: 'pm-badge-long' };

    for (var h = 0; h < horizonOrder.length; h++) {
      var horizon = horizonOrder[h];
      if (filter !== 'all' && filter !== horizon) continue;

      var events = horizons[horizon] || [];

      for (var e = 0; e < events.length; e++) {
        var ev = events[e];
        var isDuel = ev.markets.length === 1 && ev.markets[0].outcomes.length === 2 &&
          ev.markets[0].outcomes[0].outcome !== 'Yes';

        html += '<div class="pm-event">';

        // Header
        html += '<div class="pm-event-header">' +
          '<span class="pm-event-title">' + escapeHtml(ev.title) + '</span>' +
          '<div class="pm-event-meta">' +
            '<span class="pm-event-badge ' + badgeClasses[horizon] + '">' + horizonLabels[horizon] + '</span>' +
            '<span>Vol: ' + formatVolume(ev.totalVolume) + '</span>' +
            '<span>24h: ' + formatVolume(ev.volume24h) + '</span>' +
          '</div>' +
        '</div>';

        // Body
        if (isDuel) {
          html += renderDuelMarket(ev.markets[0], ev.title);
        } else {
          html += renderOddsGrid(ev.markets, ev.title);
        }

        // Footer
        html += '<div class="pm-event-footer">' +
          '<span>' + ev.marketCount + ' markets</span>' +
          '<a href="' + escapeHtml(ev.url) + '" target="_blank" rel="noopener noreferrer">View on Polymarket \u2192</a>' +
        '</div>';

        html += '</div>';
      }
    }

    if (!html) {
      html = '<div class="news-loading">No markets available for this filter.</div>';
    }

    container.innerHTML = html;

    // Click handler for PM history charts
    container.querySelectorAll('[data-pm-slug]').forEach(function(el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function(e) {
        // Don't trigger if clicking a link
        if (e.target.tagName === 'A' || e.target.closest('a')) return;
        var slug = el.dataset.pmSlug;
        var question = el.dataset.pmQuestion || slug;
        var eventTitle = el.dataset.pmEvent || '';
        openPmChart(slug, question, eventTitle);
      });
    });
  }

  async function loadPolymarket() {
    try {
      var resp = await fetch(CGI_BIN + '/polymarket.py');
      if (!resp.ok) throw new Error('Polymarket fetch failed: ' + resp.status);
      var data = await resp.json();
      state.polymarketData = data;
      renderPolymarket();
    } catch (e) {
      console.error('Polymarket load error:', e);
      var container = $('#pmMarkets');
      if (container && !state.polymarketData) {
        container.innerHTML = '<div class="news-error">Polymarket data unavailable \u2014 retrying in 10s</div>';
      }
    }
  }

  // Horizon tabs
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
  // POLYMARKET HISTORY CHART (click-to-chart)
  // ============================================
  var pmHistoryChart = null;
  var pmHistoryLineSeries = [];
  var pmChartCurrentSlug = null;
  var pmChartCurrentHours = 24;

  var PM_SERIES_COLORS = [
    '#22c55e', '#ef4444', '#3b82f6', '#f59e0b', '#a855f7',
    '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'
  ];

  function openPmChart(slug, question, eventTitle) {
    pmChartCurrentSlug = slug;
    pmChartCurrentHours = 24;

    var overlay = $('#pmChartOverlay');
    var titleEl = $('#pmChartTitle');
    var subtitleEl = $('#pmChartSubtitle');
    if (titleEl) titleEl.textContent = question || slug;
    if (subtitleEl) subtitleEl.textContent = eventTitle || '';

    // Reset range tab
    $$('#pmChartRangeTabs .pm-range-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.hours === '24');
    });

    if (overlay) overlay.classList.add('open');
    loadPmHistory(slug, 24);
  }

  function closePmChart() {
    var overlay = $('#pmChartOverlay');
    if (overlay) overlay.classList.remove('open');
    if (pmHistoryChart) {
      pmHistoryChart.remove();
      pmHistoryChart = null;
    }
    pmHistoryLineSeries = [];
    pmChartCurrentSlug = null;
  }

  async function loadPmHistory(slug, hours) {
    var container = $('#pmChartContainer');
    var legend = $('#pmChartLegend');
    var statPoints = $('#pmChartStatPoints');
    var statRange = $('#pmChartStatRange');
    if (!container) return;

    container.innerHTML = '<div class="news-loading"><span class="spinner"></span>Loading history...</div>';
    if (legend) legend.innerHTML = '';

    try {
      var resp = await fetch(CGI_BIN + '/pm_history.py?action=history&slug=' + encodeURIComponent(slug) + '&hours=' + hours);
      if (!resp.ok) throw new Error('History fetch failed: ' + resp.status);
      var data = await resp.json();

      if (data.error) {
        container.innerHTML = '<div class="news-error">' + escapeHtml(data.error) + '</div>';
        return;
      }

      if (data.data_points === 0) {
        container.innerHTML = '<div class="news-error">Noch keine historischen Daten vorhanden. Der Logger muss zuerst gestartet werden:<br><code>python3 cgi-bin/pm_logger.py --daemon</code></div>';
        return;
      }

      // Clear container for chart
      container.innerHTML = '';

      // Destroy old chart
      if (pmHistoryChart) {
        pmHistoryChart.remove();
        pmHistoryChart = null;
      }
      pmHistoryLineSeries = [];

      // Create chart
      var isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      pmHistoryChart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: Math.max(320, container.clientHeight),
        layout: {
          background: { type: 'solid', color: 'transparent' },
          textColor: isDark ? '#94a3b8' : '#475569',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
        },
        grid: {
          vertLines: { color: isDark ? 'rgba(30,41,59,0.5)' : 'rgba(203,213,225,0.5)' },
          horzLines: { color: isDark ? 'rgba(30,41,59,0.5)' : 'rgba(203,213,225,0.5)' },
        },
        rightPriceScale: {
          borderColor: isDark ? '#1e293b' : '#cbd5e1',
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          borderColor: isDark ? '#1e293b' : '#cbd5e1',
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
        },
      });

      // ResizeObserver
      new ResizeObserver(function() {
        if (pmHistoryChart) {
          pmHistoryChart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        }
      }).observe(container);

      // Add one line series per outcome
      var outcomes = Object.keys(data.series);
      var legendHtml = '';

      for (var i = 0; i < outcomes.length; i++) {
        var oc = outcomes[i];
        var color = PM_SERIES_COLORS[i % PM_SERIES_COLORS.length];
        var points = data.series[oc];

        var series = pmHistoryChart.addLineSeries({
          color: color,
          lineWidth: 2,
          title: oc,
          priceFormat: { type: 'custom', formatter: function(p) { return p.toFixed(1) + '%'; } },
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
        });

        // Convert to chart data
        var chartData = [];
        for (var j = 0; j < points.length; j++) {
          chartData.push({
            time: points[j].ts,
            value: points[j].value,
          });
        }

        if (chartData.length > 0) {
          series.setData(chartData);
        }
        pmHistoryLineSeries.push(series);

        // Last value
        var lastVal = points.length > 0 ? points[points.length - 1].value : 0;

        legendHtml += '<div class="pm-chart-legend-item">' +
          '<span class="pm-chart-legend-dot" style="background:' + color + '"></span>' +
          '<span>' + escapeHtml(oc) + '</span>' +
          '<span class="pm-chart-legend-value">' + lastVal.toFixed(1) + '%</span>' +
        '</div>';
      }

      if (legend) legend.innerHTML = legendHtml;

      // Fit content
      pmHistoryChart.timeScale().fitContent();

      // Stats
      if (statPoints) statPoints.textContent = 'Datenpunkte: ' + data.data_points;
      if (statRange) statRange.textContent = 'Zeitraum: ' + hours + 'h';

    } catch (e) {
      container.innerHTML = '<div class="news-error">History nicht verf\u00fcgbar: ' + escapeHtml(e.message) + '</div>';
    }
  }

  // Init chart modal
  (function initPmChartModal() {
    var overlay = $('#pmChartOverlay');
    var closeBtn = $('#pmChartClose');

    if (closeBtn) closeBtn.addEventListener('click', closePmChart);
    if (overlay) {
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closePmChart();
      });
    }

    // Range tabs
    $$('#pmChartRangeTabs .pm-range-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        $$('#pmChartRangeTabs .pm-range-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        pmChartCurrentHours = parseInt(btn.dataset.hours) || 24;
        if (pmChartCurrentSlug) {
          loadPmHistory(pmChartCurrentSlug, pmChartCurrentHours);
        }
      });
    });

    // ESC to close
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) {
        closePmChart();
      }
    });
  })();

  // ============================================
  // DERIVATIVES (F13)
  // ============================================
  async function loadDerivatives() {
    try {
      var resp = await fetch(CGI_BIN + '/derivatives.py');
      if (!resp.ok) throw new Error('Derivatives fetch failed');
      var d = await resp.json();
      renderDerivatives(d);
    } catch(e) {
      console.error('Derivatives error:', e);
      var grid = $('#derivGrid');
      if (grid) grid.innerHTML = '<div class="news-error">Derivatives data unavailable</div>';
    }
  }

  function renderDerivatives(d) {
    var grid = $('#derivGrid');
    if (!grid) return;

    var html = '';

    // Funding Rates card
    var funding = d.funding || {};
    var avgRate = funding.avg;
    var avgAnn = avgRate != null ? (avgRate * 3 * 365 * 100).toFixed(2) : '--';
    var fundingClass = avgRate != null && avgRate >= 0 ? 'funding-positive' : 'funding-negative';

    html += '<div class="deriv-card">' +
      '<span class="deriv-card-label">FUNDING RATE</span>' +
      '<span class="deriv-card-value ' + fundingClass + '">' + (avgRate != null ? (avgRate * 100).toFixed(4) + '%' : '--') + '</span>' +
      '<span class="deriv-card-sub">Ann: ' + avgAnn + '%</span>' +
      '<div class="deriv-exchanges">';

    var exchanges = ['binance', 'bybit', 'okx', 'deribit'];
    for (var i = 0; i < exchanges.length; i++) {
      var ex = exchanges[i];
      var exData = funding[ex];
      if (exData && exData.rate != null) {
        var cls = exData.rate >= 0 ? 'funding-positive' : 'funding-negative';
        html += '<span class="deriv-badge ' + cls + '">' + ex.toUpperCase() + ' ' + (exData.rate * 100).toFixed(4) + '%</span>';
      }
    }
    html += '</div></div>';

    // Open Interest card
    var oi = d.open_interest || {};
    html += '<div class="deriv-card">' +
      '<span class="deriv-card-label">OPEN INTEREST</span>' +
      '<span class="deriv-card-value">' + (oi.total_usd ? formatCompact(oi.total_usd) : '--') + '</span>' +
      '<div class="deriv-exchanges">';
    var oiExchanges = ['binance', 'bybit', 'okx', 'deribit'];
    for (var i = 0; i < oiExchanges.length; i++) {
      var ex = oiExchanges[i];
      var exOi = oi[ex];
      if (exOi && exOi.usd) {
        html += '<span class="deriv-badge">' + ex.toUpperCase() + ' ' + formatCompact(exOi.usd) + '</span>';
      }
    }
    html += '</div></div>';

    // Basis card
    var basis = d.basis || {};
    html += '<div class="deriv-card">' +
      '<span class="deriv-card-label">BASIS (SPOT vs PERP)</span>' +
      '<span class="deriv-card-value">' + (basis.basis_pct != null ? basis.basis_pct.toFixed(4) + '%' : '--') + '</span>' +
      '<span class="deriv-card-sub">Ann: ' + (basis.annualized_basis != null ? basis.annualized_basis.toFixed(2) + '%' : '--') + '</span>' +
      '<span class="deriv-card-sub">Spot: $' + (basis.spot ? formatPrice(basis.spot, 2) : '--') + ' / Mark: $' + (basis.mark ? formatPrice(basis.mark, 2) : '--') + '</span>' +
    '</div>';

    // Liquidations card
    var liqs = d.liquidations_24h || {};
    html += '<div class="deriv-card">' +
      '<span class="deriv-card-label">LIQUIDATIONS 24H</span>' +
      '<span class="deriv-card-value">' + (liqs.total_usd ? formatCompact(liqs.total_usd) : '--') + '</span>' +
      '<div class="deriv-exchanges">' +
        '<span class="deriv-badge funding-negative">LONG ' + (liqs.long_usd ? formatCompact(liqs.long_usd) : '--') + '</span>' +
        '<span class="deriv-badge funding-positive">SHORT ' + (liqs.short_usd ? formatCompact(liqs.short_usd) : '--') + '</span>' +
      '</div>' +
    '</div>';

    // Long/Short Ratio
    var ls = d.long_short_ratio || {};
    html += '<div class="deriv-card">' +
      '<span class="deriv-card-label">LONG / SHORT RATIO</span>' +
      '<span class="deriv-card-value">' + (ls.ratio != null ? ls.ratio.toFixed(2) : '--') + '</span>' +
      '<div class="deriv-exchanges">' +
        '<span class="deriv-badge funding-positive">LONG ' + (ls.long_pct != null ? ls.long_pct.toFixed(1) + '%' : '--') + '</span>' +
        '<span class="deriv-badge funding-negative">SHORT ' + (ls.short_pct != null ? ls.short_pct.toFixed(1) + '%' : '--') + '</span>' +
      '</div>' +
    '</div>';

    grid.innerHTML = html;
  }

  // ============================================
  // ON-CHAIN (F14)
  // ============================================
  async function loadOnchain() {
    try {
      var resp = await fetch(CGI_BIN + '/onchain.py');
      if (!resp.ok) throw new Error('Onchain fetch failed');
      var d = await resp.json();
      renderOnchain(d);
    } catch(e) {
      console.error('Onchain error:', e);
      var grid = $('#onchainGrid');
      if (grid) grid.innerHTML = '<div class="news-error">On-chain data unavailable</div>';
    }
  }

  function renderOnchain(d) {
    var grid = $('#onchainGrid');
    if (!grid) return;

    var html = '';

    // Mempool Fees card — proxy returns d.mempool.fee_fast / fee_medium / fee_slow
    var mp = d.mempool || {};
    var fastFee = mp.fee_fast || 0;
    var medFee = mp.fee_medium || 0;
    var slowFee = mp.fee_slow || 0;
    var maxFee = fastFee || 1;

    html += '<div class="onchain-card">' +
      '<span class="onchain-card-label">MEMPOOL FEES (sat/vB)</span>' +
      '<div class="fee-bar-container">' +
        '<div class="fee-bar-row">' +
          '<span class="fee-bar-label">FAST</span>' +
          '<div class="fee-bar-track"><div class="fee-bar-fill fee-fast" style="width:100%"></div></div>' +
          '<span class="fee-bar-value">' + fastFee + '</span>' +
        '</div>' +
        '<div class="fee-bar-row">' +
          '<span class="fee-bar-label">MED</span>' +
          '<div class="fee-bar-track"><div class="fee-bar-fill fee-medium" style="width:' + (maxFee ? Math.round(medFee / maxFee * 100) : 50) + '%"></div></div>' +
          '<span class="fee-bar-value">' + medFee + '</span>' +
        '</div>' +
        '<div class="fee-bar-row">' +
          '<span class="fee-bar-label">SLOW</span>' +
          '<div class="fee-bar-track"><div class="fee-bar-fill fee-slow" style="width:' + (maxFee ? Math.round(slowFee / maxFee * 100) : 20) + '%"></div></div>' +
          '<span class="fee-bar-value">' + slowFee + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Mempool Stats card — proxy returns d.mempool.tx_count, .congestion, .vsize_mb
    var congestionLevel = mp.congestion || 'low';
    var txCount = mp.tx_count || 0;

    html += '<div class="onchain-card">' +
      '<span class="onchain-card-label">MEMPOOL STATUS</span>' +
      '<span class="onchain-card-value congestion-' + congestionLevel + '">' + congestionLevel.toUpperCase() + '</span>' +
      '<span class="onchain-card-sub">' + (txCount ? txCount.toLocaleString() : '--') + ' pending TXs</span>' +
      (mp.vsize_mb ? '<span class="onchain-card-sub">Size: ' + mp.vsize_mb + ' MB</span>' : '') +
    '</div>';

    // Mining card
    var mining = d.mining || {};
    html += '<div class="onchain-card">' +
      '<span class="onchain-card-label">MINING</span>' +
      '<span class="onchain-card-value">' + (mining.hashrate_eh ? mining.hashrate_eh.toFixed(1) + ' EH/s' : '--') + '</span>' +
      (mining.difficulty ? '<span class="onchain-card-sub">Difficulty: ' + formatCompactRaw(mining.difficulty) + '</span>' : '') +
      (mining.next_adjustment_pct != null ? '<span class="onchain-card-sub ' + (mining.next_adjustment_pct >= 0 ? 'funding-positive' : 'funding-negative') + '">' +
        'Next adj: ' + (mining.next_adjustment_pct >= 0 ? '+' : '') + mining.next_adjustment_pct.toFixed(2) + '%</span>' : '') +
      (mining.blocks_to_halving != null ? '<span class="onchain-card-sub">Halving: ' + mining.blocks_to_halving.toLocaleString() + ' blocks</span>' : '') +
    '</div>';

    // Lightning Network card
    var ln = d.lightning || {};
    html += '<div class="onchain-card">' +
      '<span class="onchain-card-label">LIGHTNING NETWORK</span>' +
      '<span class="onchain-card-value">' + (ln.capacity_btc ? ln.capacity_btc.toFixed(0) + ' BTC' : '--') + '</span>' +
      (ln.channels ? '<span class="onchain-card-sub">' + ln.channels.toLocaleString() + ' channels</span>' : '') +
      (ln.nodes ? '<span class="onchain-card-sub">' + ln.nodes.toLocaleString() + ' nodes</span>' : '') +
    '</div>';

    grid.innerHTML = html;
  }

  // ============================================
  // MACRO & FLOWS (F15)
  // ============================================
  async function loadMacro() {
    try {
      var resp = await fetch(CGI_BIN + '/macro.py');
      if (!resp.ok) throw new Error('Macro fetch failed');
      var d = await resp.json();
      renderMacro(d);
    } catch(e) {
      console.error('Macro error:', e);
      var grid = $('#macroGrid');
      if (grid) grid.innerHTML = '<div class="news-error">Macro data unavailable</div>';
    }
  }

  function renderMacro(d) {
    var grid = $('#macroGrid');
    if (!grid) return;

    var html = '';

    // Fear & Greed card
    var fg = d.fear_greed || {};
    var fgVal = fg.value || 0;
    var fgClass = fgVal <= 25 ? 'fg-fear' : fgVal <= 45 ? 'fg-fear' : fgVal <= 55 ? 'fg-neutral' : 'fg-greed';
    var fgLabel = fg.label || fg.value_classification || (fgVal <= 25 ? 'Extreme Fear' : fgVal <= 45 ? 'Fear' : fgVal <= 55 ? 'Neutral' : fgVal <= 75 ? 'Greed' : 'Extreme Greed');

    html += '<div class="macro-card">' +
      '<span class="macro-card-label">FEAR &amp; GREED INDEX</span>' +
      '<span class="macro-card-value ' + fgClass + '">' + (fgVal || '--') + '</span>' +
      '<div class="fear-greed-gauge">' +
        '<div class="fear-greed-track" style="flex:1;">' +
          '<div class="fear-greed-needle" style="left:' + (fgVal || 50) + '%;"></div>' +
        '</div>' +
      '</div>' +
      '<span class="macro-card-sub ' + fgClass + '">' + escapeHtml(fgLabel) + '</span>' +
    '</div>';

    // DXY Proxy card
    var dxy = d.dxy_proxy || d.dxy || {};
    var dxyVal = dxy.dxy_est != null ? dxy.dxy_est : dxy.value;
    var dxyChange = dxy.dxy_change_est != null ? dxy.dxy_change_est : dxy.change_pct;
    html += '<div class="macro-card">' +
      '<span class="macro-card-label">DXY (USD INDEX)</span>' +
      '<span class="macro-card-value">' + (dxyVal != null ? Number(dxyVal).toFixed(2) : '--') + '</span>' +
      (dxyChange != null ? '<span class="macro-card-sub ' + (dxyChange >= 0 ? 'funding-positive' : 'funding-negative') + '">' +
        (dxyChange >= 0 ? '+' : '') + Number(dxyChange).toFixed(2) + '% 24h</span>' : '') +
      (dxy.eur_usd ? '<span class="macro-card-sub">EUR/USD: ' + Number(dxy.eur_usd).toFixed(4) + '</span>' : '') +
    '</div>';

    // Gold card
    var gold = d.gold || {};
    var goldChange = gold.change_24h != null ? gold.change_24h : gold.change_pct;
    html += '<div class="macro-card">' +
      '<span class="macro-card-label">GOLD (XAU/USD)</span>' +
      '<span class="macro-card-value">' + (gold.price != null ? '$' + formatPrice(gold.price, 2) : '--') + '</span>' +
      (goldChange != null ? '<span class="macro-card-sub ' + (goldChange >= 0 ? 'funding-positive' : 'funding-negative') + '">' +
        (goldChange >= 0 ? '+' : '') + Number(goldChange).toFixed(2) + '% 24h</span>' : '') +
    '</div>';

    // Stablecoin Supply card
    var sc = d.stablecoins || {};
    var total = sc.total_mcap || sc.total || 0;
    var usdt = (sc.tether && sc.tether.mcap) ? sc.tether.mcap : (sc.usdt || 0);
    var usdc = (sc.usdc && sc.usdc.mcap) ? sc.usdc.mcap : (typeof sc.usdc === 'number' ? sc.usdc : 0);
    var usdtPct = total > 0 ? (usdt / total * 100) : 60;
    var usdcPct = total > 0 ? (usdc / total * 100) : 30;

    html += '<div class="macro-card">' +
      '<span class="macro-card-label">STABLECOIN SUPPLY</span>' +
      '<span class="macro-card-value">' + (total ? formatCompact(total) : '--') + '</span>' +
      '<div class="stablecoin-bar-container">' +
        '<div class="stablecoin-bar-track">' +
          '<div class="stablecoin-bar-usdt" style="width:' + usdtPct.toFixed(1) + '%"></div>' +
          '<div class="stablecoin-bar-usdc" style="width:' + usdcPct.toFixed(1) + '%"></div>' +
        '</div>' +
        '<div class="stablecoin-legend">' +
          '<span class="stablecoin-legend-item"><span class="stablecoin-dot" style="background:#22c55e"></span>USDT ' + usdtPct.toFixed(0) + '%</span>' +
          '<span class="stablecoin-legend-item"><span class="stablecoin-dot" style="background:#3b82f6"></span>USDC ' + usdcPct.toFixed(0) + '%</span>' +
        '</div>' +
      '</div>' +
    '</div>';

    // BTC ETF Flows card (if available)
    var etf = d.etf_flows || {};
    if (etf.net_24h != null) {
      html += '<div class="macro-card">' +
        '<span class="macro-card-label">BTC ETF FLOWS (24H)</span>' +
        '<span class="macro-card-value ' + (etf.net_24h >= 0 ? 'funding-positive' : 'funding-negative') + '">' +
          (etf.net_24h >= 0 ? '+' : '') + formatCompact(etf.net_24h) +
        '</span>' +
        (etf.aum ? '<span class="macro-card-sub">Total AUM: ' + formatCompact(etf.aum) + '</span>' : '') +
      '</div>';
    }

    grid.innerHTML = html;
  }

  // ============================================
  // VOLATILITY (F16)
  // ============================================
  async function loadVolatility() {
    try {
      var resp = await fetch(CGI_BIN + '/volatility.py');
      if (!resp.ok) throw new Error('Volatility fetch failed');
      var d = await resp.json();
      renderVolatility(d);
    } catch(e) {
      console.error('Volatility error:', e);
      var grid = $('#volGrid');
      if (grid) grid.innerHTML = '<div class="news-error">Volatility data unavailable</div>';
    }
  }

  function renderVolatility(d) {
    var grid = $('#volGrid');
    if (!grid) return;

    var html = '';

    // Realized Vol card
    var hvRaw = d.realized || d.historical_volatility || d.realized_vol || {};
    var hv = { '7d': hvRaw.vol_7d || hvRaw['7d'], '30d': hvRaw.vol_30d || hvRaw['30d'], '90d': hvRaw.vol_90d || hvRaw['90d'] };
    html += '<div class="vol-card">' +
      '<span class="vol-card-label">REALIZED VOLATILITY</span>' +
      '<div class="vol-multi-row">' +
        (hv['7d'] != null ? '<div class="vol-multi-item"><span class="vol-multi-key">7D</span><span class="vol-multi-val">' + hv['7d'].toFixed(1) + '%</span></div>' : '') +
        (hv['30d'] != null ? '<div class="vol-multi-item"><span class="vol-multi-key">30D</span><span class="vol-multi-val">' + hv['30d'].toFixed(1) + '%</span></div>' : '') +
        (hv['90d'] != null ? '<div class="vol-multi-item"><span class="vol-multi-key">90D</span><span class="vol-multi-val">' + hv['90d'].toFixed(1) + '%</span></div>' : '') +
      '</div>' +
    '</div>';

    // Implied Vol card
    var ivRaw = d.implied || d.implied_volatility || d.atm_iv || {};
    var ivVal = typeof ivRaw === 'number' ? ivRaw : (ivRaw.atm_iv || ivRaw.atm || ivRaw.value);
    html += '<div class="vol-card">' +
      '<span class="vol-card-label">IMPLIED VOL (ATM)</span>' +
      '<span class="vol-card-value">' + (ivVal != null ? Number(ivVal).toFixed(1) + '%' : '--') + '</span>' +
      (ivRaw.option_count ? '<span class="vol-card-sub">' + ivRaw.option_count + ' options (Deribit)</span>' : '') +
    '</div>';

    // IV Rank card
    var impliedObj = d.implied || {};
    var ivr = d.iv_rank || impliedObj.iv_rank;
    var ivrVal = typeof ivr === 'number' ? ivr : (ivr != null ? (ivr.rank || ivr.value || ivr) : null);
    var ivrPct = (ivr != null && typeof ivr === 'object') ? (ivr.percentile || ivrVal) : ivrVal;
    html += '<div class="vol-card">' +
      '<span class="vol-card-label">IV RANK / PERCENTILE</span>' +
      '<span class="vol-card-value">' + (ivrVal != null ? ivrVal.toFixed(0) : '--') + '</span>' +
      '<div class="vol-bar-container">' +
        '<div class="vol-bar-track"><div class="vol-bar-fill" style="width:' + (ivrVal || 0) + '%"></div></div>' +
        '<span class="vol-bar-label">' + (ivrPct != null ? ivrPct.toFixed(0) + '%ile' : '') + '</span>' +
      '</div>' +
    '</div>';

    // HV/IV Ratio card
    var hvivRaw = d.hv_iv_ratio;
    var hvivVal = hvivRaw != null ? hvivRaw : (ivVal && hv['30d'] ? (hv['30d'] / ivVal) : null);
    html += '<div class="vol-card">' +
      '<span class="vol-card-label">HV/IV RATIO (30D)</span>' +
      '<div class="vol-hv-iv-ratio">' +
        '<span class="vol-ratio-value ' + (hvivVal != null ? (hvivVal > 1 ? 'funding-positive' : 'funding-negative') : '') + '">' +
          (hvivVal != null ? hvivVal.toFixed(2) : '--') +
        '</span>' +
        '<span class="vol-ratio-label">' + (hvivVal != null ? (hvivVal > 1 ? 'HV > IV (underpriced)' : 'IV > HV (overpriced)') : '') + '</span>' +
      '</div>' +
    '</div>';

    // Put/Call Ratio card
    var pcr = d.put_call_ratio != null ? d.put_call_ratio : (d.implied ? d.implied.put_call_ratio : null);
    html += '<div class="vol-card">' +
      '<span class="vol-card-label">PUT/CALL RATIO</span>' +
      '<span class="vol-card-value">' + (pcr != null ? pcr.toFixed(2) : '--') + '</span>' +
      '<span class="vol-card-sub">' + (pcr != null ? (pcr > 1 ? 'Bearish skew' : pcr < 0.7 ? 'Bullish skew' : 'Neutral') : '') + '</span>' +
    '</div>';

    grid.innerHTML = html;
  }

  // ============================================
  // CALENDAR (F17)
  // ============================================
  var calendarFilter = 'all';
  var calendarData = [];

  async function loadCalendar() {
    try {
      var resp = await fetch(CGI_BIN + '/btc_calendar.py?upcoming=1');
      if (!resp.ok) throw new Error('Calendar fetch failed');
      var d = await resp.json();
      calendarData = d.events || d.items || d || [];
      renderCalendar();
    } catch(e) {
      console.error('Calendar error:', e);
      var list = $('#calList');
      if (list) list.innerHTML = '<div class="news-error">Calendar data unavailable</div>';
    }
  }

  function renderCalendar() {
    var list = $('#calList');
    if (!list) return;

    var events = calendarData;
    var filter = calendarFilter;

    if (filter !== 'all') {
      events = events.filter(function(ev) {
        var cat = (ev.category || ev.type || '').toLowerCase();
        return cat === filter || cat.indexOf(filter) !== -1;
      });
    }

    if (!events.length) {
      list.innerHTML = '<div class="news-loading">No events found for this filter.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var cat = (ev.category || ev.type || 'other').toLowerCase();
      var catClass = cat.indexOf('macro') !== -1 || cat === 'fomc' || cat === 'cpi' ? 'cal-badge-macro' :
                     cat.indexOf('crypto') !== -1 || cat === 'bitcoin' || cat === 'btc' ? 'cal-badge-crypto' :
                     cat.indexOf('etf') !== -1 ? 'cal-badge-etf' : 'cal-badge-other';
      var catLabel = cat.indexOf('macro') !== -1 ? 'MACRO' :
                     cat.indexOf('crypto') !== -1 || cat === 'bitcoin' ? 'CRYPTO' :
                     cat.indexOf('etf') !== -1 ? 'ETF' : cat.toUpperCase().slice(0, 6);

      var impact = (ev.impact || ev.importance || 'low').toLowerCase();
      var impactClass = impact === 'high' || impact === '3' ? 'cal-impact-high' :
                        impact === 'medium' || impact === '2' ? 'cal-impact-medium' : 'cal-impact-low';

      var dateStr = ev.date || ev.datetime || ev.start || '';
      var dateDisplay = '--';
      if (dateStr) {
        try {
          var dt = new Date(dateStr);
          var mo = String(dt.getMonth() + 1).padStart(2, '0');
          var da = String(dt.getDate()).padStart(2, '0');
          var hr = String(dt.getHours()).padStart(2, '0');
          var mi = String(dt.getMinutes()).padStart(2, '0');
          dateDisplay = mo + '/' + da + ' ' + hr + ':' + mi;
        } catch(ex) { dateDisplay = dateStr.slice(0, 10); }
      }

      html += '<div class="cal-item">' +
        '<span class="cal-date">' + escapeHtml(dateDisplay) + '</span>' +
        '<span class="cal-title">' + escapeHtml(ev.title || ev.name || ev.event || '') + '</span>' +
        '<span class="cal-badge ' + catClass + '">' + escapeHtml(catLabel) + '</span>' +
        '<span class="cal-impact ' + impactClass + '"></span>' +
      '</div>';
    }

    list.innerHTML = html;
  }

  // Calendar tab filter
  (function initCalendarTabs() {
    var tabs = $$('#calTabs .news-tab');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        tabs.forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        calendarFilter = tab.dataset.cal || 'all';
        renderCalendar();
      });
    });
  })();

  // ============================================
  // ADDRESS INSPECTOR (F18)
  // ============================================
  (function initAddressInspector() {
    var panel = $('#addressPanel');
    var closeBtn = $('#addressCloseBtn');
    var goBtn = $('#addrGoBtn');
    var input = $('#addrInput');
    var result = $('#addrResult');

    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        if (panel) panel.style.display = 'none';
      });
    }

    function doInspect() {
      if (!input || !result) return;
      var q = input.value.trim();
      if (!q) return;
      result.innerHTML = '<div class="news-loading"><span class="spinner"></span>Inspecting...</div>';
      fetch(CGI_BIN + '/address.py?q=' + encodeURIComponent(q))
        .then(function(r) { return r.json(); })
        .then(function(d) { renderAddressResult(d, q); })
        .catch(function(e) {
          result.innerHTML = '<div class="addr-error">Lookup failed: ' + escapeHtml(e.message) + '</div>';
        });
    }

    if (goBtn) goBtn.addEventListener('click', doInspect);
    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') doInspect();
      });
    }
  })();

  function renderAddressResult(d, q) {
    var result = $('#addrResult');
    if (!result) return;

    if (d.error) {
      result.innerHTML = '<div class="addr-error">' + escapeHtml(d.error) + '</div>';
      return;
    }

    var html = '';

    // Balance
    var balanceBTC = d.balance != null ? (d.balance / 1e8).toFixed(8) : (d.final_balance != null ? (d.final_balance / 1e8).toFixed(8) : null);
    if (balanceBTC != null) {
      html += '<div class="addr-balance">' + balanceBTC + ' BTC</div>';
    }

    // Stats grid
    html += '<div class="addr-stats-grid">';
    if (d.total_received != null) {
      html += '<div class="addr-stat-card"><span class="addr-stat-label">Total Received</span><span class="addr-stat-value">' + (d.total_received / 1e8).toFixed(4) + ' BTC</span></div>';
    }
    if (d.total_sent != null) {
      html += '<div class="addr-stat-card"><span class="addr-stat-label">Total Sent</span><span class="addr-stat-value">' + (d.total_sent / 1e8).toFixed(4) + ' BTC</span></div>';
    }
    if (d.n_tx != null || d.tx_count != null) {
      html += '<div class="addr-stat-card"><span class="addr-stat-label">Transactions</span><span class="addr-stat-value">' + (d.n_tx || d.tx_count || 0).toLocaleString() + '</span></div>';
    }
    if (d.confirmations != null) {
      html += '<div class="addr-stat-card"><span class="addr-stat-label">Confirmations</span><span class="addr-stat-value">' + d.confirmations.toLocaleString() + '</span></div>';
    }
    html += '</div>';

    // TX list
    var txs = d.txs || d.transactions || [];
    if (txs.length) {
      html += '<div style="margin-top:8px;font-family:var(--font-body);font-size:var(--text-xs);color:var(--color-text-faint);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Recent Transactions</div>';
      html += '<div class="addr-tx-list">';
      var limit = Math.min(txs.length, 20);
      for (var i = 0; i < limit; i++) {
        var tx = txs[i];
        var hash = tx.hash || tx.txid || tx.tx_hash || '';
        var amount = tx.result != null ? (tx.result / 1e8) : (tx.value != null ? (tx.value / 1e8) : null);
        var confs = tx.confirmations != null ? tx.confirmations : (tx.block_height != null ? '✓' : 'pending');
        var timeStr = '';
        if (tx.time || tx.confirmed) {
          try {
            var ts = tx.time ? new Date(tx.time * 1000) : new Date(tx.confirmed);
            timeStr = String(ts.getMonth() + 1).padStart(2,'0') + '/' + String(ts.getDate()).padStart(2,'0');
          } catch(ex) {}
        }
        html += '<div class="addr-tx-item">' +
          '<span class="addr-tx-hash">' + escapeHtml(hash.slice(0, 16) + '…' + hash.slice(-8)) + '</span>' +
          (amount != null ? '<span class="addr-tx-amount ' + (amount >= 0 ? 'funding-positive' : 'funding-negative') + '">' + (amount >= 0 ? '+' : '') + amount.toFixed(6) + ' BTC</span>' : '<span></span>') +
          '<span class="addr-tx-conf">' + confs + '</span>' +
          '<span class="addr-tx-time">' + escapeHtml(timeStr) + '</span>' +
        '</div>';
      }
      html += '</div>';
    }

    result.innerHTML = html;
  }

  // ============================================
  // NOTEBOOK / BLOTTER (F19)
  // ============================================
  var notebookNotes = [];
  var NOTEBOOK_KEY = 'btc_terminal_notes';

  function loadNotebook() {
    try {
      notebookNotes = [];
    } catch(e) { notebookNotes = []; }
    renderNotebook();
  }

  function saveNotebook() {
    // Notes are in-memory only (persistence not available in sandbox)
  }

  function renderNotebook() {
    var container = $('#nbEntries');
    if (!container) return;

    if (!notebookNotes.length) {
      container.innerHTML = '<div class="nb-empty">No notes yet. Click &quot;+ NOTE&quot; to add your first trade thesis or observation.</div>';
      return;
    }

    var html = '';
    var sorted = notebookNotes.slice().reverse();
    for (var i = 0; i < sorted.length; i++) {
      var note = sorted[i];
      var idx = notebookNotes.indexOf(note);
      html += '<div class="nb-entry" data-idx="' + idx + '">' +
        '<div class="nb-entry-header">' +
          '<span class="nb-entry-time">' + escapeHtml(note.timestamp || '') + '</span>' +
          (note.price ? '<span class="nb-entry-price">BTC $' + escapeHtml(String(note.price)) + '</span>' : '') +
          '<div class="nb-entry-tags">' +
            (note.tags || []).map(function(t) { return '<span class="nb-tag">' + escapeHtml(t) + '</span>'; }).join('') +
          '</div>' +
          '<button class="nb-entry-delete" data-idx="' + idx + '" title="Delete note">&times;</button>' +
        '</div>' +
        '<div class="nb-entry-text">' + escapeHtml(note.text || '') + '</div>' +
      '</div>';
    }

    container.innerHTML = html;

    // Bind delete buttons
    container.querySelectorAll('.nb-entry-delete').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.idx);
        notebookNotes.splice(idx, 1);
        saveNotebook();
        renderNotebook();
      });
    });
  }

  (function initNotebook() {
    var panel = $('#notebookPanel');
    var closeBtn = $('#notebookCloseBtn');
    var addBtn = $('#nbAddBtn');
    var exportBtn = $('#nbExportBtn');
    var editor = $('#nbEditor');
    var textarea = $('#nbTextarea');
    var tagsInput = $('#nbTagsInput');
    var saveBtn = $('#nbSaveBtn');
    var cancelBtn = $('#nbCancelBtn');

    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        if (panel) panel.style.display = 'none';
      });
    }

    if (addBtn) {
      addBtn.addEventListener('click', function() {
        if (editor) editor.style.display = '';
        if (textarea) textarea.focus();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        if (editor) editor.style.display = 'none';
        if (textarea) textarea.value = '';
        if (tagsInput) tagsInput.value = '';
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', function() {
        if (!textarea) return;
        var text = textarea.value.trim();
        if (!text) return;
        var tags = tagsInput ? tagsInput.value.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];
        var now = new Date();
        var ts = now.getFullYear() + '-' +
          String(now.getMonth() + 1).padStart(2, '0') + '-' +
          String(now.getDate()).padStart(2, '0') + ' ' +
          String(now.getHours()).padStart(2, '0') + ':' +
          String(now.getMinutes()).padStart(2, '0');
        notebookNotes.push({
          timestamp: ts,
          text: text,
          tags: tags,
          price: state.lastPrice ? Math.round(state.lastPrice) : null,
        });
        saveNotebook();
        renderNotebook();
        textarea.value = '';
        if (tagsInput) tagsInput.value = '';
        if (editor) editor.style.display = 'none';
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', function() {
        exportNotebookCSV();
      });
    }
  })();

  function exportNotebookCSV() {
    var rows = [['Timestamp', 'BTC Price', 'Tags', 'Note']];
    for (var i = 0; i < notebookNotes.length; i++) {
      var n = notebookNotes[i];
      rows.push([
        '"' + (n.timestamp || '') + '"',
        n.price || '',
        '"' + (n.tags || []).join('; ') + '"',
        '"' + (n.text || '').replace(/"/g, '""') + '"',
      ]);
    }
    var csv = rows.map(function(r) { return r.join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'btc-notebook-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ============================================
  // EXPORT CSV (F20)
  // ============================================
  function exportCSV() {
    var rows = [['Metric', 'Value', 'Timestamp']];
    rows.push(['BTC/USD', state.lastPrice || '', new Date().toISOString()]);
    var kpis = document.querySelectorAll('.kpi-card');
    kpis.forEach(function(card) {
      var label = card.querySelector('.kpi-label');
      var value = card.querySelector('.kpi-value');
      if (label && value) rows.push([label.textContent.trim(), value.textContent.trim(), new Date().toISOString()]);
    });
    var csv = rows.map(function(r) { return r.join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'btc-terminal-export-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ============================================
  // PANEL NAVIGATION HELPERS
  // ============================================
  function scrollToPanel(sel) {
    var el = $(sel);
    if (el) {
      el.style.display = '';
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function showPanel(sel) {
    var el = $(sel);
    if (el) {
      el.style.display = '';
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  // ============================================
  // MOBILE NAVIGATION
  // ============================================
  function initMobileNav() {
    var mobileNav = $('#mobileNav');
    var moreBtn = $('#mobileMoreBtn');
    var moreMenu = $('#mobileMoreMenu');
    if (!mobileNav) return;

    // Track open state
    var moreOpen = false;

    function closeMobileMore() {
      if (!moreOpen) return;
      moreOpen = false;
      if (moreMenu) moreMenu.classList.remove('open');
      var backdrop = document.querySelector('.mobile-more-backdrop');
      if (backdrop) backdrop.remove();
    }

    function openMobileMore() {
      moreOpen = true;
      if (moreMenu) {
        moreMenu.style.display = 'block';
        // Force reflow for transition
        void moreMenu.offsetHeight;
        moreMenu.classList.add('open');
      }
      // Add backdrop
      var backdrop = document.createElement('div');
      backdrop.className = 'mobile-more-backdrop';
      backdrop.addEventListener('click', closeMobileMore);
      document.body.appendChild(backdrop);
    }

    if (moreBtn) {
      moreBtn.addEventListener('click', function() {
        if (moreOpen) { closeMobileMore(); } else { openMobileMore(); }
      });
    }

    // Handle nav button clicks (both bottom nav and more menu)
    function handleMobileNav(navTarget) {
      closeMobileMore();

      // Update active state on bottom nav
      mobileNav.querySelectorAll('.mobile-nav-btn[data-nav]').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.nav === navTarget);
      });

      // Map nav targets to panel selectors and scroll targets
      var panelMap = {
        'dashboard': '#priceHero',
        'chart': '#chartPanel',
        'orderbook': '#orderbookPanel',
        'watchlist': '#watchlistPanel',
        'news': '#newsPanel',
        'odds': '#polymarketPanel',
        'derivatives': '#derivativesPanel',
        'onchain': '#onchainPanel',
        'macro': '#macroPanel',
        'calendar': '#calendarPanel',
        'address': '#addressPanel',
        'notebook': '#notebookPanel'
      };

      var sel = panelMap[navTarget];
      if (!sel) return;

      var el = $(sel);
      if (!el) return;

      // Show hidden panels
      if (el.style.display === 'none') {
        el.style.display = '';
      }

      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Bottom nav buttons
    mobileNav.querySelectorAll('.mobile-nav-btn[data-nav]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        handleMobileNav(btn.dataset.nav);
      });
    });

    // More menu items
    if (moreMenu) {
      moreMenu.querySelectorAll('[data-nav]').forEach(function(item) {
        item.addEventListener('click', function() {
          handleMobileNav(item.dataset.nav);
        });
      });
    }
  }

  function init() {
    // Init chart with requestAnimationFrame for proper dimensions
    initChart();

    // Load data via REST (always works, even if WS is blocked)
    loadPriceREST();
    loadOrderbook();
    loadKPIs();
    loadWatchlist();

    // Load live news from CGI proxy
    loadNews();

    // Load Polymarket odds
    loadPolymarket();

    // Load BTC Up/Down 5-min widget
    loadUpdown();

    // Load new panels
    loadDerivatives();
    loadOnchain();
    loadMacro();
    loadVolatility();
    loadCalendar();
    loadNotebook();

    // Mobile navigation
    initMobileNav();

    // Try WebSockets (may be blocked in sandbox)
    setTimeout(function() {
      connectTickerWS();
      connectDepthWS();
    }, 500);

    // Periodic REST refreshes as fallback
    setInterval(loadPriceREST, 5000);
    setInterval(loadOrderbook, 5000);
    setInterval(loadKPIs, 60000);
    setInterval(loadWatchlist, 30000);
    setInterval(loadNews, 120000);

    // Polymarket: refresh every 10 seconds
    setInterval(loadPolymarket, 10000);

    // BTC Up/Down: refresh every 1 second for real-time odds
    setInterval(loadUpdown, 1000);

    // New panel periodic refreshes
    setInterval(loadDerivatives, 30000);
    setInterval(loadOnchain, 60000);
    setInterval(loadMacro, 300000);
    setInterval(loadVolatility, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
