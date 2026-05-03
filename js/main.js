const BTC = {
  API_BASE:'https://api.coingecko.com/api/v3',
  chart:null,
  currentPrice:0,
  cache:{},
  RANGES:{
    1:   {days:1,    label:'24H',   interval:'hourly'},
    7:   {days:7,    label:'7D',    interval:'daily'},
    30:  {days:30,   label:'30D',   interval:'daily'},
    365: {days:365,  label:'1Y',    interval:'daily'},
    1825:{days:'1825',label:'5Y',    interval:'daily'},
    3650:{days:'3650',label:'10Y',   interval:'monthly'},
    max: {days:'max',  label:'ALL',   interval:'monthly'}
  },
  CACHE_MAX_AGE: 5*60*1000,
  init(){
    this.bindTabs();
    this.fetchPrice();
    setInterval(()=>this.fetchPrice(),60000);
    this.loadRange('1');
  },
  bindTabs(){
    document.querySelectorAll('.range-tabs button').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('.range-tabs button').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        this.loadRange(btn.dataset.range);
      });
    });
  },
  async fetchPrice(){
    try{
      const r = await fetch(`${this.API_BASE}/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`);
      const d = await r.json();
      const btc = d.bitcoin;
      this.currentPrice = btc.usd;
      const pct = btc.usd_24h_change;
      const up = pct>=0;
      document.getElementById('price').textContent = this.fmtUSD(btc.usd);
      document.getElementById('price-change').className = `price-change ${up?'up':'down'}`;
      document.getElementById('price-change').innerHTML=`
        <span class="pct">${up?'+':''}${pct.toFixed(2)}%</span>
        <span class="arrow">${up?'▲':'▼'}</span>`;
      document.getElementById('last-update').textContent = `Updated ${new Date().toLocaleTimeString()}`;
      document.getElementById('market-cap').textContent = `Market Cap: ${this.fmtCompact(btc.usd_market_cap)}`;
      document.getElementById('volume').textContent = `24h Vol: ${this.fmtCompact(btc.usd_24h_vol)}`;
      this.updateMilestones();
    }catch(e){
      console.error('Price fetch failed:',e);
      document.getElementById('price').textContent = '...error';
    }
  },
  async loadRange(rangeKey){
    const cfg = this.RANGES[rangeKey];
    const cacheKey = `prices_${rangeKey}`;
    const cached = this.cache[cacheKey];
    if(cached && Date.now()-cached.ts < this.CACHE_MAX_AGE){
      this.renderChart(cached.data, cfg);
      return;
    }
    const loader = document.getElementById('chart-loader');
    loader.classList.remove('hidden');
    try{
      const url = `${this.API_BASE}/coins/bitcoin/market_chart?vs_currency=usd&days=${cfg.days}&interval=${cfg.interval}`;
      const r = await fetch(url);
      const d = await r.json();
      if(!d.prices || !d.prices.length) throw new Error('Empty response');
      this.cache[cacheKey] = {data:d, ts:Date.now()};
      this.renderChart(d, cfg);
    }catch(e){
      console.error('Chart fetch failed:', e);
      if(this.cache[cacheKey]){
        this.renderChart(this.cache[cacheKey].data, cfg);
      }else{
        loader.querySelector('p').textContent = 'API rate limit — try again in a minute ⏳';
      }
      return;
    }finally{
      if(!this.cache[cacheKey]) loader.classList.add('hidden');
    }
  },
  renderChart(data, cfg){
    document.getElementById('chart-loader').classList.add('hidden');
    const prices = data.prices;       // [[timestamp, price], ...]
    const volumes = data.total_volumes; // [[timestamp, vol], ...]
    const labels = prices.map(p => new Date(p[0]));
    const values = prices.map(p => p[1]);
    const vols   = volumes ? volumes.map(v => v[1]) : [];
    const ctx = document.getElementById('btcChart').getContext('2d');
    const up = values[values.length-1] >= values[0];
    const color = up ? '#10b981' : '#ef4444';
    const bgGrad = ctx.createLinearGradient(0,0,0,400);
    bgGrad.addColorStop(0, up ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)');
    bgGrad.addColorStop(1, 'rgba(0,0,0,0)');
    if(this.chart) this.chart.destroy();
    this.chart = new Chart(ctx, {
      type:'line',
      data:{
        labels,
        datasets:[
          {
            label:'BTC Price',
            data:values,
            borderColor:color,
            backgroundColor:bgGrad,
            borderWidth:2,
            tension:0.3,
            pointRadius: values.length>100?0:2,
            pointHoverRadius:6,
            pointBackgroundColor:color,
            fill:true,
            yAxisID:'y'
          },
          ...(vols.length? [{
            label:'Volume',
            data:vols,
            type:'bar',
            backgroundColor:'rgba(255,255,255,0.05)',
            borderWidth:0,
            barPercentage:0.4,
            yAxisID:'y1',
            order:2
          }] : [])
        ]
      },
      options:{
        responsive:true,
        maintainAspectRatio:true,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{display:false},
          tooltip:{
            backgroundColor:'rgba(8,12,20,0.92)',
            titleFont:{family:"Inter",size:12,weight:'600'},
            bodyFont:{family:"JetBrains Mono",size:12},
            padding:12,
            cornerRadius:8,
            displayColors:false,
            callbacks:{
              title:(ctx)=>ctx[0].label.toLocaleDateString(
                undefined,{weekday:'short',year:'numeric',month:'short',day:'numeric'}),
              label:(ctx)=>`$${ctx.raw.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2})}`
            }
          }
        },
        scales:{
          x:{
            grid:{color:'rgba(255,255,255,0.03)'},
            ticks:{
              color:'#7d8a96',
              font:{family:'Inter',size:10},
              maxTicksLimit:8,
              maxRotation:0
            }
          },
          y:{
            position:'left',
            grid:{color:'rgba(255,255,255,0.03)'},
            ticks:{
              color:'#7d8a96',
              font:{family:'JetBrains Mono',size:10},
              callback:(val)=>this.fmtCompact(val)
            }
          },
          y1:{
            position:'right',
            display:false,
            grid:{display:false}
          }
        },
        animation:{duration:900,easing:'easeOutQuart'}
      }
    });
  },
  updateMilestones(){
    document.querySelectorAll('.pct-cell[data-base]').forEach(cell=>{
      const base = parseFloat(cell.dataset.base);
      if(!base || !this.currentPrice) return;
      const change = ((this.currentPrice - base)/base)*100;
      const up = change>=0;
      cell.className = `pct-cell ${up?'up':'down'}`;
      cell.textContent = `${up?'+':''}${change.toLocaleString(undefined,{maximumFractionDigits:1})}%`;
    });
  },
  fmtUSD(n){
    return `$${n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  },
  fmtCompact(n){
    if(n>=1e12) return `$${(n/1e12).toFixed(2)}T`;
    if(n>=1e9) return `$${(n/1e9).toFixed(2)}B`;
    if(n>=1e6) return `$${(n/1e6).toFixed(2)}M`;
    return `$${n.toLocaleString(undefined,{maximumFractionDigits:0})}`;
  }
};
document.addEventListener('DOMContentLoaded',()=>BTC.init());
