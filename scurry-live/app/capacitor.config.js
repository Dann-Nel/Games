// The app is a thin native shell around the hosted game: it loads SCURRY_URL, so site updates reach the app without a new install.
// Build with:  SCURRY_URL=https://your-app.onrender.com npx cap sync android
const url = process.env.SCURRY_URL || 'https://YOUR-APP.onrender.com';
module.exports = {
  appId: 'live.scurry.app',
  appName: 'Scurry',
  webDir: 'www',
  server: { url, cleartext: false, androidScheme: 'https' },
  android: { allowMixedContent: false },
};
