// Firebase: Console → Project settings → Your apps → Web app → firebaseConfig
// Эти ключи публичные (не секрет), безопасность задают правила Firestore (firestore.rules).
// Пока стоит "ВСТАВЬ" — аккаунты выключены, приложение работает локально.
window.FB_CONFIG = {
  apiKey: "ВСТАВЬ",
  authDomain: "ВСТАВЬ.firebaseapp.com",
  projectId: "ВСТАВЬ",
  storageBucket: "ВСТАВЬ.firebasestorage.app",
  messagingSenderId: "ВСТАВЬ",
  appId: "ВСТАВЬ"
};

// Конфиг, вставленный в приложении (Настройки → Account), главнее файла
try {
  var _o = JSON.parse(localStorage.getItem("fbcfg") || "null");
  if (_o && _o.projectId && _o.apiKey) window.FB_CONFIG = _o;
} catch (e) {}
