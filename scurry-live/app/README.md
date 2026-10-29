# Scurry native app (Android now, iOS later)

A thin native shell that loads the hosted game, so site updates reach the app without reinstalling. Its job: keep sharing your location while the **screen is locked** or you switch apps, which a website can never do. On Android it runs a "location" foreground service and shows a notification while a game is on.

The website detects the app (`window.Capacitor`) and uses the background-location plugin instead of the browser's GPS. Normal browsers are unchanged.

## Get the APK (no Android Studio)
1. GitHub repo -> Settings -> Secrets and variables -> Actions -> **Variables** -> New: `SCURRY_URL` = your game's https address.
2. Actions tab -> **Build Android APK** -> Run workflow. About 5 minutes.
3. Open the finished run, download **scurry-android**, unzip, send `app-debug.apk` to phones (WhatsApp/Drive/USB).
4. On the phone: open the file, allow "install unknown apps" when asked, install, open **Scurry**.
5. Allow location. Choose **Allow all the time / While using** (either works; the notification keeps it running). Allow notifications.
6. In Android Settings -> Apps -> Scurry -> Battery, choose **Unrestricted** so the phone doesn't stop it.

## Build locally
    cd scurry-live/app && npm install
    SCURRY_URL=https://your-game.onrender.com npx cap sync android
    cd android && ./gradlew assembleDebug      # needs JDK 21 + Android SDK 35

## iPhone
Needs a Mac with Xcode and an Apple developer account ($99/yr): `npx cap add ios`, enable the "Location updates" background mode, then archive and distribute with TestFlight. Until then iPhone players use the website in Safari and must keep the screen on.

## Notes
- This is a debug-signed APK for sideloading. Google Play needs a release build, signing key, privacy policy, and a background-location declaration.
- Not yet tested on a real phone: confirm tracking continues with the screen locked for a few minutes.
