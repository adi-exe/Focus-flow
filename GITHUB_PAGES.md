# Publish on GitHub Pages

### Fastest route (no build)

This repository is intentionally static. Push the files to GitHub, then select:

**Settings → Pages → Build and deployment → Deploy from a branch → `main` → `/ (root)` → Save**

After deployment, GitHub will publish `index.html` at your repository Pages URL.

### Optional GitHub Actions route

You do not need Actions for this project. The app has no npm build step and uses relative paths so it works from a repository subpath.
