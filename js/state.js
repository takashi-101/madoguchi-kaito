/* 台帳と文書の保持。変更があれば保存し、画面に知らせる。 */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};
  var listeners = {};

  var state = {
    ledger: [],
    docs: [],
    on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit: function (ev, data) { (listeners[ev] || []).forEach(function (fn) { fn(data); }); },
    load: function () {
      return Promise.all([MK.storage.get('ledger'), MK.storage.get('docs')]).then(function (r) {
        state.ledger = Array.isArray(r[0]) ? r[0].map(cleanEntry) : [];
        state.docs = Array.isArray(r[1]) ? r[1] : [];
        state.emit('ledger');
        state.emit('docs');
      });
    },
    setLedger: function (list) {
      state.ledger = list.map(cleanEntry);
      return MK.storage.set('ledger', state.ledger).then(function (ok) {
        state.emit('ledger');
        return ok;
      });
    },
    setDocs: function (list) {
      state.docs = list;
      return MK.storage.set('docs', state.docs).then(function (ok) {
        state.emit('docs');
        return ok;
      });
    },
    upsertEntry: function (entry) {
      entry = cleanEntry(entry);
      var list = state.ledger.slice();
      var idx = list.findIndex(function (e) { return e.id === entry.id; });
      if (idx >= 0) list[idx] = entry; else list.push(entry);
      return state.setLedger(list).then(function () { return entry; });
    },
    removeEntry: function (id) {
      return state.setLedger(state.ledger.filter(function (e) { return e.id !== id; }));
    },
    findEntry: function (id) {
      return state.ledger.find(function (e) { return e.id === id; }) || null;
    },
    findDoc: function (id) {
      return state.docs.find(function (d) { return d.id === id; }) || null;
    }
  };

  var FIELDS = ['id', 'major', 'minor', 'question', 'answer', 'basisDoc', 'basisSection',
    'basisPage', 'basisQuote', 'kakari', 'updated'];

  function cleanEntry(e) {
    var o = {};
    FIELDS.forEach(function (f) {
      var v = e && e[f] != null ? e[f] : '';
      o[f] = String(v).trim();
    });
    if (!o.id) o.id = newId('L');
    return o;
  }

  function newId(prefix) {
    var r = '';
    try {
      var a = new Uint32Array(2);
      root.crypto.getRandomValues(a);
      r = a[0].toString(36) + a[1].toString(36);
    } catch (e) {
      r = Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
    return prefix + '-' + r;
  }

  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  state.FIELDS = FIELDS;
  state.cleanEntry = cleanEntry;
  state.newId = newId;
  state.today = today;
  MK.state = state;
})(typeof window !== 'undefined' ? window : globalThis);
