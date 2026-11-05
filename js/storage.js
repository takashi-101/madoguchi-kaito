/* ブラウザ内の保存（IndexedDB）。保存するのは台帳と、取り込んだ文書の本文だけ。
 * 問い合わせの入力欄の中身は保存しない。 */
(function (root) {
  'use strict';
  var MK = root.MK = root.MK || {};
  var DB_NAME = 'madoguchi-kaito';
  var STORE = 'kv';
  var dbPromise = null;
  var memory = {}; // IndexedDB が使えないときの一時保存
  var available = true;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      try {
        if (!root.indexedDB) { available = false; resolve(null); return; }
        var req = root.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { available = false; resolve(null); };
        req.onblocked = function () { available = false; resolve(null); };
      } catch (e) {
        available = false; resolve(null);
      }
    });
    return dbPromise;
  }

  function get(key) {
    return open().then(function (db) {
      if (!db) return memory[key];
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readonly');
          var r = tx.objectStore(STORE).get(key);
          r.onsuccess = function () { resolve(r.result); };
          r.onerror = function () { resolve(memory[key]); };
        } catch (e) { resolve(memory[key]); }
      });
    });
  }

  function set(key, value) {
    memory[key] = value;
    return open().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
          tx.onabort = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    });
  }

  MK.storage = {
    get: get,
    set: set,
    isAvailable: function () { return open().then(function (db) { return !!db && available; }); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
