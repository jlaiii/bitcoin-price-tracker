/**
 * BTC Tracker — Professional-grade crypto charting engine
 * Multi-timeframe support, real-time updates, DCA calculator,
 * Fear & Greed integration, and graceful API fallbacks.
 *
 * Structure:   BTC = {} namespace, BTC.init() entry point
 * Dependencies: Chart.js 4.x + chartjs-adapter-date-fns
 */

/* ─────────────────────── Namespace ─────────────────────── */
const BTC = {
  API_BASE: 'https://api.coingecko.com/api/v3',
  FNG_API: 'https://api.alternative.me/fng/?limit=1',
  HASHRATE_API: 'https://mempool.space/api/v1/mining/hashrate/3d',
  CURRENT_DIFFICULTY_API: 'https://mempool.space/api/v1/mining/difficulty/3d',

  /* State */
  chart: null,
  currentPrice: 0,
  currentVolume: 0,
  currentMarketCap: 0,
  yearData: null,           // local year_data.json parsed once
  converterMode: 'btc2usd', // or 'usd2btc'
  retryDelays: [2000, 5000, 10000],

  /* Timeframe definitions
     key → {days, label, interval, localFile}  */
  RANGES: {
    1:    { days: 1,    label: '24H',   interval: 'hourly', localFile: 'data/prices_1d.json' },
    3:    { days: 3,    label: '3D',    interval: 'hourly', localFile: 'data/prices_1d.json' },
    7:    { days: 7,    label: '7D',    interval: 'daily',  localFile: 'data/prices_7d.json' },
    30:   { days: 30,   label: '30D',   interval: 'daily',  localFile: 'data/prices_30d.json' },
    90:   { days: 90,   label: '90D',   interval: 'daily',  localFile: 'data/prices_90d.json' },
    180:  { days: 180,  label: '180D',  interval: 'daily',  localFile: 'data/prices_180d.json' },
    365:  { days: 365,  label: '1Y',    interval: 'daily',  localFile: 'data/prices_2y.json' },
    730:  { days: '730', label: '2Y',    interval: 'daily', localFile: 'data/prices_2y.json' },
    1095: { days: '1095',label: '3Y',    interval: 'daily', localFile: 'data/prices_3y.json' },
    1825: { days: '1825',label: '5Y',    interval: 'daily', localFile: 'data/prices_5y.json' },
    max:  { days: 'max', label: 'ALL',   interval: 'daily', localFile: 'data/prices_all.json' }
  },

  CACHE_MAX_AGE: 5 * 60 * 1000, // 5 minutes

  /* ─────────────────────── Init ─────────────────────── */
  async init() {
    await this.loadYearData();
    this.bindTabs();
    this.bindConverter();
    this.bindDCA();
    this.initMobileTabs();
    this.bindSort();
    this.initMarketBars();

    // kick off parallel async data loads
    this.fetchPrice();
    this.fetchFearGreed();
    this.fetchMiningStats();
    this.loadRange('1'); // default to 24H

    // real-time price refresh every 60s
    setInterval(() => this.fetchPrice(), 60000);

    // refresh Fear & Greed hourly (it updates daily-ish)
    setInterval(() => this.fetchFearGreed(), 3600000);

    // resize listener for chart
    window.addEventListener('resize', () => {
      if (this.chart) this.chart.resize();
    });
  },

  /* ─────────────────────── Utility Helpers ─────────────────────── */
  fmtUSD(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '$---';
    return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  fmtCompact(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '---';
    const abs = Math.abs(n);
    if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  },

  fmtDate(d) {
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  },

  fmtPercent(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '---%';
    const s = `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`;
    return s;
  },

  /* Remove loading skeletons / placeholders once real data arrives */
  removeSkeletons() {
    document.querySelectorAll('.skeleton').forEach(el => el.classList.remove('skeleton'));
  },

  /* ─────────────────────── Caching ─────────────────────── */
  cacheGet(key) {
    try {
      const raw = localStorage.getItem(`btc_cache_${key}`);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > this.CACHE_MAX_AGE) {
        localStorage.removeItem(`btc_cache_${key}`);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  },

  cacheSet(key, data) {
    try {
      localStorage.setItem(`btc_cache_${key}`, JSON.stringify({ data, ts: Date.now() }));
    } catch {
      // silently fail if localStorage is full
    }
  },

  /* ─────────────────────── Year Data (local fallback) ─────────────────────── */
  async loadYearData() {
    // Try data/year_data.json first, then root fallback
    const urls = ['data/year_data.json', 'year_data.json'];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url} not found`);
        const json = await res.json();
        if (json.prices && Array.isArray(json.prices)) {
          this.yearData = json.prices;
          return;
        }
        throw new Error(`${url} missing prices array`);
      } catch (e) {
        console.warn(`Failed to load ${url}:`, e);
      }
    }
    this.yearData = [];
  },

  /* ─────────────────────── Price Fetching ─────────────────────── */
  async fetchPrice(attempt = 0) {
    try {
      const url = `${this.API_BASE}/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const btc = d.bitcoin;
      if (!btc) throw new Error('Malformed response');

      this.currentPrice = btc.usd ?? 0;
      this.currentMarketCap = btc.usd_market_cap ?? 0;
      this.currentVolume  = btc.usd_24h_vol  ?? 0;
      const pct = btc.usd_24h_change ?? 0;
      const up = pct >= 0;

      // DOM updates
      const priceEl = document.getElementById('price');
      if (priceEl) priceEl.textContent = this.fmtUSD(this.currentPrice);

      const currencyEl = document.getElementById('currency');
      if (currencyEl && currencyEl.textContent === '---') currencyEl.textContent = 'USD';

      const changeEl = document.getElementById('price-change');
      if (changeEl) {
        changeEl.className = `price-change ${up ? 'up' : 'down'}`;
        changeEl.innerHTML = `<span class="pct">${this.fmtPercent(pct)}</span><span class="arrow">${up ? '▲' : '▼'}</span>`;
      }

      const updateEl = document.getElementById('last-update');
      if (updateEl) updateEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;

      const mcapEl = document.getElementById('market-cap');
      if (mcapEl) mcapEl.textContent = `Market Cap: ${this.fmtCompact(this.currentMarketCap)}`;

      const volEl = document.getElementById('volume');
      if (volEl) volEl.textContent = `24h Vol: ${this.fmtCompact(this.currentVolume)}`;

      this.updateMilestones();
      this.updateConverter();
      this.removeSkeletons();
    } catch (e) {
      console.error('Price fetch failed:', e);
      if (attempt < this.retryDelays.length) {
        setTimeout(() => this.fetchPrice(attempt + 1), this.retryDelays[attempt]);
      }
      const priceEl = document.getElementById('price');
      if (priceEl && priceEl.textContent === '---') priceEl.textContent = '$---';
    }
  },

  /* ─────────────────────── Chart Engine ─────────────────────── */
  async loadRange(rangeKey) {
    const cfg = this.RANGES[rangeKey];
    if (!cfg) return;

    const cacheKey = `prices_${rangeKey}`;
    const cached = this.cacheGet(cacheKey);
    if (cached) {
      this.renderChart(cached, cfg, rangeKey);
      return;
    }

    const loader = document.getElementById('chart-loader');
    if (loader) loader.classList.remove('hidden');

    try {
      // 1) Try CoinGecko API first
      const requestDays = (typeof cfg.days === 'number' && cfg.days > 365) ? 365 : cfg.days;
      const url = `${this.API_BASE}/coins/bitcoin/market_chart?vs_currency=usd&days=${requestDays}&interval=${cfg.interval}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (!d.prices || !d.prices.length) throw new Error('Empty response');

      let prices = d.prices;
      let volumes = d.total_volumes || [];

      const showLimitNote =
        (typeof cfg.days === 'number' && cfg.days > 365) || cfg.days === 'max' || cfg.days === '730' || cfg.days === '1095' || cfg.days === '1825';

      if (showLimitNote && this.yearData && this.yearData.length) {
        const apiStart = prices[0][0];
        const extra = this.yearData.filter(pt => pt[0] < apiStart);
        if (extra.length) {
          prices = extra.concat(prices);
          if (volumes.length) {
            const zeroVols = extra.map(() => [0, 0]);
            volumes = zeroVols.concat(volumes);
          }
        }
      }

      const payload = { prices, total_volumes: volumes };
      this.cacheSet(cacheKey, payload);
      this.renderChart(payload, cfg, rangeKey);
    } catch (apiErr) {
      console.warn('CoinGecko API failed, trying local file:', apiErr.message || apiErr);
      // 2) Fallback to local static JSON
      const local = await this.loadLocalData(cfg, rangeKey);
      if (local && local.prices?.length) {
        this.cacheSet(cacheKey, local);
        this.renderChart(local, cfg, rangeKey);
      } else {
        // 3) No data at all — show error in loader
        if (loader) loader.querySelector('p').textContent = 'Chart data temporarily unavailable — retrying soon ⏳';
      }
    } finally {
      const loader2 = document.getElementById('chart-loader');
      if (loader2) loader2.classList.add('hidden');
    }
  },

  async loadLocalData(cfg, rangeKey) {
    // Map timeframes to local JSON files
    const fileMap = cfg.localFile ? [cfg.localFile] : [];
    // Additional fallbacks
    if (rangeKey === '1') fileMap.push('data/prices_1d.json');
    if (rangeKey === '3') fileMap.push('data/prices_1d.json');
    if (rangeKey === '7') fileMap.push('data/prices_7d.json');
    if (rangeKey === '30') fileMap.push('data/prices_30d.json');
    if (rangeKey === '90') fileMap.push('data/prices_90d.json');
    if (rangeKey === '180') fileMap.push('data/prices_180d.json');
    if (rangeKey === '365') fileMap.push('data/prices_2y.json');
    if (rangeKey === '730') fileMap.push('data/prices_2y.json');
    if (rangeKey === '1095') fileMap.push('data/prices_3y.json');
    if (rangeKey === '1825') fileMap.push('data/prices_5y.json');
    if (rangeKey === 'max') fileMap.push('data/prices_all.json');

    // prices_all.json is nested by key
    const isNested = (url) => url.includes('prices_all.json');

    for (const url of [...new Set(fileMap)]) { // dedupe
      try {
        const res = await fetch(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now());
        if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
        const json = await res.json();
        if (json.prices && Array.isArray(json.prices)) {
          return { prices: json.prices, total_volumes: json.total_volumes || [] };
        }
        // prices_all.json is nested: { "1d": {prices, total_volumes}, ... }
        if (isNested(url)) {
          const rangeAlias = String(rangeKey);
          const allKeyMap = {
            '1': '1d', '3': '1d', '7': '7d', '30': '30d', '90': '90d',
            '180': '180d', '365': '2y', '730': '2y', '1095': '3y', '1825': '5y', 'max': 'all'
          };
          const key = allKeyMap[rangeAlias];
          const section = json[key] || json.all;
          if (section && section.prices?.length) {
            return { prices: section.prices, total_volumes: section.total_volumes || [] };
          }
        }
      } catch (e) {
        console.warn(`Local fallback ${url} failed:`, e.message || e);
      }
    }
    return null;
  },

  renderChart(data, cfg, rangeKey) {
    const loader = document.getElementById('chart-loader');
    if (loader) loader.classList.add('hidden');

    const prices = data.prices;           // [[ts, price], ...]
    const volumes = data.total_volumes || [];  // [[ts, vol], ...]
    const labels = prices.map(p => new Date(p[0]));
    const values = prices.map(p => p[1]);
    const vols   = volumes.length ? volumes.map(v => v[1]) : [];

    const ctxEl = document.getElementById('btcChart');
    if (!ctxEl) return;
    const ctx = ctxEl.getContext('2d');

    const up = values[values.length - 1] >= values[0];
    const color = up ? '#10b981' : '#ef4444';
    const bgGrad = ctx.createLinearGradient(0, 0, 0, ctxEl.clientHeight || 400);
    bgGrad.addColorStop(0, up ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)');
    bgGrad.addColorStop(1, 'rgba(0,0,0,0)');

    if (this.chart) this.chart.destroy();

    // Show a subtle notice inside the chart area when range > 365 and public API limited
    // We do this via an annotation plugin-like custom draw after chart creation (simple text via plugin)
    const showLimitNote =
      rangeKey === 'max' || rangeKey === '730' || rangeKey === '1095' || rangeKey === '1825' || parseInt(rangeKey, 10) > 365;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'BTC Price',
            data: values,
            borderColor: color,
            backgroundColor: bgGrad,
            borderWidth: 2,
            tension: 0.3,
            pointRadius: values.length > 100 ? 0 : 2,
            pointHoverRadius: 6,
            pointBackgroundColor: color,
            fill: true,
            yAxisID: 'y'
          },
          ...(vols.length ? [{
            label: 'Volume',
            data: vols,
            type: 'bar',
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderWidth: 0,
            barPercentage: 0.4,
            yAxisID: 'y1',
            order: 2
          }] : [])
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          annotation: { annotations: {} }, // placeholder; we use custom plugin below
          tooltip: {
            backgroundColor: 'rgba(8,12,20,0.95)',
            titleFont: { family: "Inter", size: 12, weight: '600' },
            bodyFont: { family: "JetBrains Mono", size: 12 },
            padding: 12,
            cornerRadius: 8,
            displayColors: true,
            callbacks: {
              title: (items) => {
                const d = items?.[0]?.parsed?.x;
                if (!d) return '';
                const date = new Date(labels[items[0].dataIndex]);
                return this.fmtDate(date);
              },
              label: (item) => {
                if (item.dataset.type === 'bar') {
                  return `Vol ${this.fmtCompact(item.raw)}`;
                }
                return `Price ${this.fmtUSD(item.raw)}`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: {
              tooltipFormat: 'MMM d, yyyy',
              displayFormats: {
                hour: 'HH:mm',
                day: 'MMM d',
                week: 'MMM d',
                month: 'MMM yyyy',
                year: 'yyyy'
              }
            },
            grid: { color: 'rgba(255,255,255,0.03)' },
            ticks: {
              color: '#7d8a96',
              font: { family: 'Inter', size: 10 },
              maxTicksLimit: 8,
              maxRotation: 0
            }
          },
          y: {
            position: 'left',
            grid: { color: 'rgba(255,255,255,0.03)' },
            ticks: {
              color: '#7d8a96',
              font: { family: 'JetBrains Mono', size: 10 },
              callback: (val) => this.fmtCompact(val)
            }
          },
          y1: {
            position: 'right',
            display: false,
            grid: { display: false }
          }
        },
        animation: { duration: 700, easing: 'easeOutQuart' }
      },
      plugins: [
        {
          id: 'limitNotice',
          afterDraw: (chart) => {
            if (!showLimitNote) return;
            const { ctx, chartArea } = chart;
            ctx.save();
            ctx.fillStyle = 'rgba(255,193,7,0.8)';
            ctx.font = '11px Inter';
            ctx.textAlign = 'right';
            const msg = 'Historical data beyond 1 year requires CoinGecko demo/paid plan. Displaying estimated data.';
            ctx.fillText(msg, chartArea.right - 10, chartArea.top + 14);
            ctx.restore();
          }
        }
      ]
    });
  },

  /* ─────────────────────── Range Tabs ─────────────────────── */
  bindTabs() {
    const tabs = document.querySelectorAll('.range-tabs button[data-range]');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.loadRange(btn.dataset.range);
      });
    });
  },

  /* Collapse range tabs to a <select> on narrow viewports */
  initMobileTabs() {
    const tabsContainer = document.querySelector('.range-tabs');
    if (!tabsContainer) return;

    const buildSelect = () => {
      let sel = document.getElementById('range-select');
      if (sel) return;
      sel = document.createElement('select');
      sel.id = 'range-select';
      sel.className = 'range-select';
      tabsContainer.querySelectorAll('button[data-range]').forEach(btn => {
        const opt = document.createElement('option');
        opt.value = btn.dataset.range;
        opt.textContent = btn.textContent;
        if (btn.classList.contains('active')) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', (e) => {
        const val = e.target.value;
        tabsContainer.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.range === val));
        this.loadRange(val);
      });
      tabsContainer.insertAdjacentElement('afterend', sel);
    };

    const mq = window.matchMedia('(max-width: 640px)');
    const handle = (m) => {
      if (m.matches) {
        tabsContainer.style.display = 'none';
        buildSelect();
      } else {
        tabsContainer.style.display = '';
        const sel = document.getElementById('range-select');
        if (sel) sel.remove();
      }
    };
    mq.addEventListener('change', handle);
    handle(mq);
  },

  /* ─────────────────────── Price Converter ─────────────────────── */
  bindConverter() {
    const input = document.getElementById('btc-input');
    const output = document.getElementById('usd-output');
    const slider = document.getElementById('btc-slider');
    if (!input || !output) return;

    input.addEventListener('input', () => this.updateConverter());
    if (slider) {
      slider.addEventListener('input', () => {
        input.value = slider.value;
        this.updateConverter();
      });
    }

    const toggleBtn = document.getElementById('converter-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggleConverterMode());
    }
  },

  updateConverter() {
    const input = document.getElementById('btc-input');
    const output = document.getElementById('usd-output');
    if (!input || !output) return;
    if (!this.currentPrice) return;

    const raw = parseFloat(input.value);
    if (Number.isNaN(raw)) {
      output.value = this.converterMode === 'btc2usd' ? '$0.00' : '0 BTC';
      return;
    }

    if (this.converterMode === 'btc2usd') {
      output.value = this.fmtUSD(raw * this.currentPrice);
    } else {
      const btc = raw / this.currentPrice;
      output.value = `${btc.toFixed(8)} BTC`;
    }
  },

  toggleConverterMode() {
    const input = document.getElementById('btc-input');
    const output = document.getElementById('usd-output');
    const toggleBtn = document.getElementById('converter-toggle');
    const inputLabel = input?.closest('.converter-field')?.querySelector('label');
    const outputLabel = output?.closest('.converter-field')?.querySelector('label');

    this.converterMode = this.converterMode === 'btc2usd' ? 'usd2btc' : 'btc2usd';

    if (input) {
      input.placeholder = this.converterMode === 'btc2usd' ? 'BTC amount' : 'USD amount';
      input.value = '';
    }
    if (inputLabel) {
      inputLabel.textContent = this.converterMode === 'btc2usd' ? 'BTC' : 'USD';
    }
    if (outputLabel) {
      outputLabel.textContent = this.converterMode === 'btc2usd' ? 'USD' : 'BTC';
    }
    if (toggleBtn) {
      toggleBtn.title = this.converterMode === 'btc2usd' ? 'Swap direction (USD → BTC)' : 'Swap direction (BTC → USD)';
    }
    this.updateConverter();
  },

  /* ─────────────────────── Fear & Greed Index ─────────────────────── */
  async fetchFearGreed() {
    const valEl = document.getElementById('fear-greed-value');
    const lblEl = document.getElementById('fear-greed-label');
    if (!valEl || !lblEl) return;

    try {
      const res = await fetch(this.FNG_API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const item = json?.data?.[0];
      if (!item) throw new Error('No data');
      const val = parseInt(item.value, 10);

      valEl.textContent = val;
      const label = this.fearGreedLabel(val);
      lblEl.textContent = label;
      lblEl.style.color = this.fearGreedColor(val);
      // update needle rotation directly on the SVG element
      const needle = document.getElementById('gauge-needle');
      if (needle) {
        // map 0-100 to -90deg to +90deg
        const deg = -90 + (val / 100) * 180;
        needle.setAttribute('transform', `rotate(${deg}, 100, 100)`);
      }
      const gauge = document.querySelector('.fear-greed-gauge');
      if (gauge) gauge.style.setProperty('--gauge-pct', `${val}%`);
    } catch (e) {
      console.error('Fear & Greed fetch failed:', e);
      if (valEl.textContent === '---' || valEl.textContent === 'Loading...') {
        valEl.textContent = '---';
        lblEl.textContent = 'Loading...';
      }
    }
  },

  fearGreedLabel(val) {
    if (val <= 24) return 'Extreme Fear';
    if (val <= 49) return 'Fear';
    if (val === 50) return 'Neutral';
    if (val <= 74) return 'Greed';
    return 'Extreme Greed';
  },

  fearGreedColor(val) {
    // red → orange → yellow → green
    if (val <= 24) return '#ef4444';
    if (val <= 49) return '#f97316';
    if (val === 50) return '#eab308';
    if (val <= 74) return '#84cc16';
    return '#10b981';
  },

  /* ─────────────────────── DCA Calculator ─────────────────────── */
  bindDCA() {
    const btn = document.getElementById('dca-calculate');
    if (!btn) return;
    btn.addEventListener('click', () => this.calculateDCA());
  },

  calculateDCA() {
    const amountEl = document.getElementById('dca-amount');
    const freqEl   = document.getElementById('dca-frequency');
    const startEl  = document.getElementById('dca-start');
    const outEl    = document.getElementById('dca-results');

    if (!amountEl || !freqEl || !startEl || !outEl) return;

    const amount = parseFloat(amountEl.value);
    if (Number.isNaN(amount) || amount <= 0) {
      outEl.innerHTML = '<p class="dca-note">Please enter a positive investment amount.</p>';
      return;
    }

    const frequencyMap = { weekly: 7, monthly: 30 };
    const freqDays = frequencyMap[freqEl.value] || parseInt(freqEl.value, 10) || 7;
    const startStr = startEl.value; // yyyy-mm-dd
    if (!startStr) {
      outEl.innerHTML = '<p class="dca-note">Please select a start date.</p>';
      return;
    }

    const startDate = new Date(startStr);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    startDate.setHours(0, 0, 0, 0);

    if (startDate > today) {
      outEl.innerHTML = '<p class="dca-note">Start date cannot be in the future.</p>';
      return;
    }

    if (!this.yearData || !this.yearData.length) {
      outEl.innerHTML = '<p class="dca-note">Historical data not loaded. Please refresh the page.</p>';
      return;
    }

    // Build a price map from year_data timestamps (ms) to price
    const priceMap = new Map();
    let earliest = Infinity;
    let latest = -Infinity;
    this.yearData.forEach(([ts, price]) => {
      // normalize to day start ms
      const dayTs = new Date(ts).setHours(0, 0, 0, 0);
      priceMap.set(dayTs, price);
      if (dayTs < earliest) earliest = dayTs;
      if (dayTs > latest) latest = dayTs;
    });

    // Determine effective start (cannot go before earliest data)
    const userStartTs = startDate.getTime();
    const effectiveStartMs = Math.max(userStartTs, earliest);
    const effectiveStart = new Date(effectiveStartMs);
    effectiveStart.setHours(0, 0, 0, 0);

    let totalInvested = 0;
    let totalBtc = 0;
    let investmentCount = 0;

    // Walk from effective start to today in freqDays steps
    const cur = new Date(effectiveStart);
    while (cur <= today) {
      const dayTs = new Date(cur).setHours(0, 0, 0, 0);
      // get nearest available price
      let price = priceMap.get(dayTs);
      if (!price) {
        // fallback: linear search nearest by day in priceMap
        const keys = Array.from(priceMap.keys()).sort((a, b) => a - b);
        const nearest = keys.reduce((best, k) =>
          Math.abs(k - dayTs) < Math.abs(best - dayTs) ? k : best, keys[0]);
        price = priceMap.get(nearest);
      }
      if (price && price > 0) {
        totalInvested += amount;
        totalBtc += amount / price;
        investmentCount++;
      }
      cur.setDate(cur.getDate() + freqDays);
    }

    if (!totalBtc || !this.currentPrice) {
      outEl.innerHTML = '<p class="dca-note">Could not compute DCA — price data unavailable.</p>';
      return;
    }

    const currentValue = totalBtc * this.currentPrice;
    const roiPct = ((currentValue - totalInvested) / totalInvested) * 100;

    // Annualized return (CAGR-like) using years elapsed
    const years = (today.getTime() - effectiveStartMs) / (1000 * 60 * 60 * 24 * 365.25);
    const annualized = years > 0 ? (((currentValue / totalInvested) ** (1 / years)) - 1) * 100 : 0;

    const noteBefore = userStartTs < earliest
      ? `<p class="dca-note">Limited to available historical data (past year). Using earliest available date: ${new Date(earliest).toLocaleDateString()}.</p>`
      : '';

    outEl.innerHTML = `
      ${noteBefore}
      <div class="dca-grid">
        <div class="dca-item"><span class="dca-label">Investments</span><span class="dca-val">${investmentCount}</span></div>
        <div class="dca-item"><span class="dca-label">Total Invested</span><span class="dca-val">${this.fmtUSD(totalInvested)}</span></div>
        <div class="dca-item"><span class="dca-label">Total BTC</span><span class="dca-val">${totalBtc.toFixed(8)} BTC</span></div>
        <div class="dca-item"><span class="dca-label">Current Value</span><span class="dca-val ${currentValue >= totalInvested ? 'up' : 'down'}">${this.fmtUSD(currentValue)}</span></div>
        <div class="dca-item"><span class="dca-label">ROI</span><span class="dca-val ${roiPct >= 0 ? 'up' : 'down'}">${this.fmtPercent(roiPct)}</span></div>
        <div class="dca-item"><span class="dca-label">Annualized Return</span><span class="dca-val ${annualized >= 0 ? 'up' : 'down'}">${this.fmtPercent(annualized)}</span></div>
      </div>
    `;
  },

  /* ─────────────────────── Milestones Table ─────────────────────── */
  updateMilestones() {
    document.querySelectorAll('.pct-cell[data-base]').forEach(cell => {
      const base = parseFloat(cell.dataset.base);
      if (!base || !this.currentPrice) return;
      const change = ((this.currentPrice - base) / base) * 100;
      const up = change >= 0;
      cell.className = `pct-cell ${up ? 'up' : 'down'}`;
      cell.textContent = this.fmtPercent(change);
    });
  },

  /* ─────────────────────── Mining Stats (placeholder) ─────────────────────── */
  async fetchMiningStats() {
    const placeholders = {
      'mining-hashrate':     '~650',
      'mining-difficulty':   '~95',
      'mining-next-diff':    '---',
      'mining-reward':       '3.125 BTC',
      'mining-blocks-halving':'~145,000'
    };

    // Attempt mempool.space (may be blocked by CORS; gracefully degrade)
    let hashrateVal = null;
    let difficultyVal = null;
    try {
      const res = await fetch(this.HASHRATE_API, { mode: 'cors' });
      if (res.ok) {
        const json = await res.json();
        // API returns hashrate in H/s; convert to EH/s
        const current = json?.currentHashrate;
        if (current) {
          const ehs = current / 1e18;
          hashrateVal = `${ehs.toFixed(1)}`;
        }
      }
    } catch (e) {
      // ignore
    }

    try {
      const res2 = await fetch(this.CURRENT_DIFFICULTY_API, { mode: 'cors' });
      if (res2.ok) {
        const json2 = await res2.json();
        const diff = json2?.difficulty?.[0]?.difficulty;
        if (diff) {
          const t = diff / 1e12;
          difficultyVal = `${t.toFixed(1)}`;
        }
      }
    } catch (e) {
      // ignore
    }

    const updates = {
      'mining-hashrate':    hashrateVal || placeholders['mining-hashrate'],
      'mining-difficulty':  difficultyVal || placeholders['mining-difficulty'],
      'mining-next-diff':   placeholders['mining-next-diff'],
      'mining-reward':      placeholders['mining-reward'],
      'mining-blocks-halving': placeholders['mining-blocks-halving']
    };

    Object.entries(updates).forEach(([id, text]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    });
  },

  /* ─────────────────────── Sortable History Table ─────────────────────── */
  bindSort() {
    const table = document.querySelector('.history-table table');
    if (!table) return;
    const headers = table.querySelectorAll('thead th.sortable');
    headers.forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const sortKey = th.dataset.sort;
        if (!sortKey) return;

        // Determine current direction and reset others
        const currentDir = th.classList.contains('asc') ? 'asc' : th.classList.contains('desc') ? 'desc' : null;
        headers.forEach(h => h.classList.remove('asc', 'desc'));
        const dir = currentDir === 'asc' ? 'desc' : 'asc';
        th.classList.add(dir);

        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));

        rows.sort((a, b) => {
          let aVal, bVal;
          if (sortKey === 'date') {
            aVal = new Date(a.dataset.date || a.querySelector('td')?.textContent || 0).getTime();
            bVal = new Date(b.dataset.date || b.querySelector('td')?.textContent || 0).getTime();
          } else if (sortKey === 'event') {
            aVal = a.querySelector('td:nth-child(2)')?.textContent?.trim() || '';
            bVal = b.querySelector('td:nth-child(2)')?.textContent?.trim() || '';
            return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
          } else if (sortKey === 'price') {
            aVal = parseFloat(a.dataset.price || 0);
            bVal = parseFloat(b.dataset.price || 0);
          } else if (sortKey === 'change') {
            const aCell = a.querySelector('.pct-cell[data-base]');
            const bCell = b.querySelector('.pct-cell[data-base]');
            const aBase = parseFloat(aCell?.dataset.base || 0);
            const bBase = parseFloat(bCell?.dataset.base || 0);
            aVal = aBase && this.currentPrice ? ((this.currentPrice - aBase) / aBase) * 100 : -Infinity;
            bVal = bBase && this.currentPrice ? ((this.currentPrice - bBase) / bBase) * 100 : -Infinity;
          } else if (sortKey === 'cap') {
            aVal = parseFloat(a.dataset.cap || 0);
            bVal = parseFloat(b.dataset.cap || 0);
          } else {
            aVal = a.querySelector('td')?.textContent?.trim() || '';
            bVal = b.querySelector('td')?.textContent?.trim() || '';
            return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
          }
          return dir === 'asc' ? aVal - bVal : bVal - aVal;
        });

        rows.forEach(r => tbody.appendChild(r));
      });
    });
  },

  /* ─────────────────────── Market Comparison Bars ─────────────────────── */
  initMarketBars() {
    const container = document.getElementById('market-bars');
    if (!container) return;
    const rows = container.querySelectorAll('.market-bar-row');
    let maxCap = 0;
    rows.forEach(row => {
      const cap = parseFloat(row.dataset.cap);
      if (cap && cap > maxCap) maxCap = cap;
    });
    if (!maxCap) return;
    rows.forEach(row => {
      const cap = parseFloat(row.dataset.cap);
      const fill = row.querySelector('.market-fill');
      if (fill && cap) {
        const pct = (cap / maxCap) * 100;
        fill.style.width = `${pct}%`;
        // fallback if CSS doesn't use --fill
        fill.style.setProperty('--fill', `${pct}%`);
      }
    });
  }
};

/* ─────────────────────── Bootstrap ─────────────────────── */
document.addEventListener('DOMContentLoaded', () => BTC.init());
