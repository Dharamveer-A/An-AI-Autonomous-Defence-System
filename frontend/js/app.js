// TerraVision — App Controller

const App = {
  state: { bbox: null, dateFrom: null, dateTo: null },

  screens: {
    landing:  document.getElementById('landing'),
    map:      document.getElementById('mapScreen'),
    analysis: document.getElementById('analysisScreen')
  },

  goTo(name) {
    Object.values(this.screens).forEach(s => s.classList.remove('active'));
    this.screens[name].classList.add('active');
    window.dispatchEvent(new CustomEvent('screenChange', { detail: name }));
  },

  toast(msg, type = '', ms = 3500) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${type}`;
    t.classList.remove('hidden');
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.classList.add('hidden'), ms);
  }
};

// Default dates: 5 years ago → today
(function setDates() {
  const today = new Date();
  const past  = new Date();
  past.setFullYear(today.getFullYear() - 5);
  const fmt = d => d.toISOString().split('T')[0];
  document.getElementById('dateFrom').value = fmt(past);
  document.getElementById('dateTo').value   = fmt(today);
  document.getElementById('dateTo').max     = fmt(today);
  document.getElementById('dateFrom').max   = fmt(today);
})();

// Navigation
document.getElementById('openMapBtn').addEventListener('click', () => {
  App.goTo('map');
  setTimeout(() => window.dispatchEvent(new Event('mapInit')), 80);
});
document.getElementById('backBtn').addEventListener('click', () => App.goTo('landing'));
document.getElementById('backFromAnalysis').addEventListener('click', () => App.goTo('map'));
