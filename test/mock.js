// Fake viewer runtime for local testing: db/assets kept in localStorage (survives reload),
// canned Claude answers and calendar events. Behaviour is tuned through window.__mockOpts / localStorage.
(() => {
  const opts = JSON.parse(localStorage.getItem('__mockOpts') || '{}');
  if (opts.noClaude) return; // simulate the page opened outside a Claude viewer
  const load = () => new Map(JSON.parse(localStorage.getItem('__store') || '[]'));
  const store = load();
  const persist = () => localStorage.setItem('__store', JSON.stringify([...store]));
  const snap = (path) => ({ id: path.split('/').pop(), exists: store.has(path), data: () => store.get(path), metadata: {} });
  const db = {
    doc: (path) => ({
      get: async () => snap(path),
      set: async (d) => { store.set(path, JSON.parse(JSON.stringify(d))); persist(); },
      update: async (d) => { store.set(path, { ...(store.get(path) || {}), ...d }); persist(); },
      delete: async () => { store.delete(path); persist(); },
    }),
    collection: (path) => ({
      get: async () => { const docs = [...store.keys()].filter(k => k.startsWith(path + '/') && k.slice(path.length + 1).indexOf('/') < 0).map(snap); return { docs, size: docs.length, empty: !docs.length }; },
    }),
  };
  window.__store = store;
  window.__saved = [];
  window.__calls = [];
  const sample = async () => ({ text: '' });
  sample.json = async (prompt, o) => {
    window.__calls.push({ sample: true, hasImg: !!o.images, tier: o.modelTier });
    await new Promise(r => setTimeout(r, 400));
    const a = window.__sampleAnswer || { total: 23.5, date: '2026-10-08', merchant: 'Bagels & Beans', description: 'Lunch met klant', category: 'Maaltijd', readable: true };
    if (a.__error) throw a.__error;
    return a;
  };
  sample.limits = async () => opts.noImages ? { maxPromptBytes: 262144 } : { maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg'] } };
  const events = {
    '2026-10-08': [
      { summary: 'Ontwerpsessie KLMN2041 bij klant', start: { dateTime: '2026-10-08T10:00:00+02:00' }, end: { dateTime: '2026-10-08T13:00:00+02:00' }, status: 'confirmed' },
      { summary: 'Boulderen', start: { dateTime: '2026-10-08T20:30:00+02:00' }, end: { dateTime: '2026-10-08T22:00:00+02:00' } },
      { summary: 'Geannuleerd XXXX9999', status: 'cancelled', start: { dateTime: '2026-10-08T08:00:00+02:00' }, end: { dateTime: '2026-10-08T09:00:00+02:00' } },
    ],
    '2026-10-09': [
      { summary: 'Bouwvergadering', description: 'Project RTSV-3310 fase 2', start: { dateTime: '2026-10-09T09:00:00+02:00' }, end: { dateTime: '2026-10-09T10:00:00+02:00' } },
      { summary: 'Locatiebezoek ABCD1234', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } },
    ],
    '2026-10-10': [
      { summary: 'Week 2026 planning', start: { dateTime: '2026-10-10T09:00:00+02:00' }, end: { dateTime: '2026-10-10T10:00:00+02:00' } },
    ],
  };
  const mcp = {
    callTool: async (server, tool, input) => {
      window.__calls.push({ server, tool, input });
      await new Promise(r => setTimeout(r, 200));
      if (opts.calError) throw { code: opts.calError, message: 'mock' };
      if (tool === 'list_events') { const d = input.startTime.slice(0, 10); return { content: [], payload: { summary: 'Werk', events: events[d] || [] } }; }
      if (tool === 'list_calendars') return { content: [], payload: { calendars: [{ id: 'werk@group.calendar.google.com', summary: 'Werk' }, { id: 'primary', summary: 'Prive' }] } };
    },
  };
  const assets = { upload: async (b) => ({ id: 'a' + Math.random().toString(16).slice(2, 10).padEnd(8, '0'), url: URL.createObjectURL(b), sizeBytes: b.size }), delete: async () => ({ deleted: true }) };
  const downloads = { save: async ({ filename, data }) => { window.__saved.push({ filename, size: data.size, type: data.type }); window.__lastBlob = data; if (opts.declineSave) throw { code: 'declined' }; return { status: 'saved' }; } };
  const user = { id: async () => 'u1' };
  const caps = { db, sample, mcp, assets, downloads, user };
  window.claude = { use: async (n) => { await new Promise(r => setTimeout(r, 30)); return caps[n] || null; } };
})();
