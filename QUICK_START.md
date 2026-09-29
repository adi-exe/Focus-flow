# Quick start

### Run locally

From the project root:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

### Put it on GitHub Pages

Create a repository, push the project, and enable **Settings → Pages → GitHub Actions**. The included `pages.yml` workflow publishes the static app.

### Get the Android APK

Push the repo. The included `build-android.yml` workflow builds `android/app/build/outputs/apk/debug/app-debug.apk` and publishes it as a downloadable Actions artifact named `FocusFlow-debug-apk`.

You can also open the `android/` folder in Android Studio and build the APK manually.
