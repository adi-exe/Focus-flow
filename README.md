# FocusFlow — personal study + exercise tracker

A local-first productivity app designed for GitHub Pages and Android. It uses only browser-native HTML/CSS/JavaScript and stores your data in `localStorage` on the device/browser.

## Included

- Add any number of study timers in one action.
- Give the batch a default number of minutes, then edit each timer individually.
- Start/stop an optional countdown per timer.
- Mark a session done or undone without ever starting its timer.
- Completed minutes roll up into the selected day.
- Browse previous days and see the last 7 days in a study-time bar chart.
- Add/remove exercises.
- Press `+` beside an exercise to log reps after a study session.
- See the selected day’s final exercise totals and individual entries.
- PWA support for installation on Android/desktop browsers.
- No backend or account required.

## GitHub Pages

1. Create a GitHub repository.
2. Copy everything in this folder into the repository root.
3. Commit and push.
4. In GitHub: **Settings → Pages → Deploy from a branch → main → / (root)**.
5. Open the published URL. The app is already static and does not need a build step.

The included `sw.js` and manifest make the app installable as a PWA. Because the project is fully client-side, your data remains on the device/browser where you use it.

## Android APK project

The `android/` directory contains an Android Studio project that wraps the same app in a native WebView. To build an APK locally, open `android/` in Android Studio and choose **Build → Build APK(s)**.

The Web app is copied into `android/app/src/main/assets/`, so the Android build works offline at runtime and does not depend on your GitHub Pages URL.

### Important data note

Browser storage and the Android app's WebView storage are separate. Installing the APK will start with a new local data store.
