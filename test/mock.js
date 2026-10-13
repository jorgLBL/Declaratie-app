// Fake viewer runtime for local testing: in-memory db/assets, canned Claude + calendar answers.
(() => {
  const store = new Map();
  const snap = (path) => ({ id: path.split('/').pop(), exists: store.has(path), data: () => store.get(path), metadata: {} });
  const db = {
    doc: (path) => ({
      get: async () => snap(path),
      set: async (d) => { store.set(path, JSON.parse(JSON.stringify(d))); },
      update: async (d) => { store.set(path, { ...(store.get(path) || {}), ...d }); },
      delete: async () => { store.delete(path); },
    }),
    collection: (path) => ({
      get: async () => { const docs = [...store.keys()].filter(k => k.startsWith(path + '/') && k.slice(path.length + 1).indexOf('/') < 0).map(snap); return { docs, size: docs.length, empty: !docs.length }; },
    }),
  };
  window.__store = store;
  window.__saved = [];
  window.__calls = [];
  const sample = async () => ({ text: '' });
  sample.json = async (prompt, opts) => { window.__calls.push({ sample: prompt.slice(0, 40), hasImg: !!opts.images }); await new Promise(r => setTimeout(r, 600)); return window.__sampleAnswer || { total: 23.5, date: '2026-10-08', merchant: 'Bagels & Beans', description: 'Lunch met klant', category: 'Maaltijd', readable: true }; };
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg'] } });
  const events = {
    '2026-10-08': [
      { summary: 'Ontwerpsessie KLMN2041 bij klant', start: { dateTime: '2026-10-08T10:00:00+02:00' }, end: { dateTime: '2026-10-08T13:00:00+02:00' }, status: 'confirmed' },
      { summary: 'Boulderen', start: { dateTime: '2026-10-08T20:30:00+02:00' }, end: { dateTime: '2026-10-08T22:00:00+02:00' } },
    ],
    '2026-10-09': [
      { summary: 'Bouwvergadering', description: 'Project RTSV-3310 fase 2', start: { dateTime: '2026-10-09T09:00:00+02:00' }, end: { dateTime: '2026-10-09T10:00:00+02:00' } },
      { summary: 'Locatiebezoek ABCD1234', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } },
    ],
  };
  const mcp = {
    callTool: async (server, tool, input) => {
      window.__calls.push({ server, tool, input });
      await new Promise(r => setTimeout(r, 300));
      if (tool === 'list_events') { const d = input.startTime.slice(0, 10); return { content: [], payload: { summary: 'Werk', events: events[d] || [] } }; }
      if (tool === 'list_calendars') throw { code: 'tool_error', message: 'Forbidden' };
    },
  };
  const assets = { upload: async (b) => ({ id: 'a' + Math.random().toString(16).slice(2), url: URL.createObjectURL(b), sizeBytes: b.size }), delete: async () => ({ deleted: true }) };
  const downloads = { save: async ({ filename, data }) => { window.__saved.push({ filename, size: data.size, type: data.type }); window.__lastBlob = data; return { status: 'saved' }; } };
  const user = { id: async () => 'u1' };
  const caps = { db, sample, mcp, assets, downloads, user };
  window.claude = { use: async (n) => { await new Promise(r => setTimeout(r, 50)); return caps[n] || null; } };
})();
