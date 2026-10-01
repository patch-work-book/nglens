# Release Process — ngLens

## Overview

ngLens uses GitHub Actions to automatically build and publish to the Chrome Web Store when you push a version tag.

## Prerequisites

### 1. Chrome Web Store API Credentials

You need OAuth 2.0 credentials from Google Cloud Console to publish to the Chrome Web Store.

**Steps to get credentials:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable the **Chrome Web Store API**
4. Create an OAuth 2.0 Desktop Application:
   - Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client IDs**
   - Application type: Desktop application
   - Save the **Client ID** and **Client Secret**

5. Generate a **Refresh Token**:
   - You need to do an OAuth flow once to get a refresh token
   - Use this helper: https://github.com/DrewML/chrome-webstore-upload/blob/master/How%20to%20generate%20Google%20API%20refresh%20token.md
   - Or use curl:
     ```bash
     curl "https://oauth2.googleapis.com/token" \
       -d "client_id=YOUR_CLIENT_ID&scope=https://www.googleapis.com/auth/chromewebstore&response_type=code&redirect_uri=http://localhost"
     ```
   - Follow the auth flow, capture the auth code, exchange it for a refresh token

6. Find your **Extension ID**:
   - Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
   - Look for ngLens in your extensions list
   - The extension ID is in the URL or the item details

### 2. Add GitHub Secrets

Store the credentials as GitHub repository secrets so the workflow can access them:

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Add the following secrets:
   - `CWS_CLIENT_ID` — your OAuth Client ID
   - `CWS_CLIENT_SECRET` — your OAuth Client Secret
   - `CWS_REFRESH_TOKEN` — your refresh token (keep this secure!)
   - `EXTENSION_ID` — the ngLens extension ID from the Web Store

## How to Release

### 1. Update Version

Update the version in both `package.json` and `manifest.json`:

```json
{
  "version": "1.2.1"
}
```

Make sure they match.

### 2. Commit Changes

```bash
git add -A
git commit -m "chore: bump version to 1.2.1"
```

### 3. Create a Version Tag

```bash
git tag v1.2.1
```

### 4. Push Tag to GitHub

```bash
git push origin v1.2.1
```

This triggers the GitHub Actions workflow. The workflow will:
- ✅ Check out the code
- ✅ Run tests (unit + e2e)
- ✅ Build the production bundle
- ✅ Upload to Chrome Web Store (as draft by default)
- ✅ Create a GitHub Release page

### 5. Monitor the Workflow

1. Go to your GitHub repo → **Actions**
2. Look for the "Release to Chrome Web Store" workflow run
3. Watch the build progress

### 6. Publish to Public (Manual Step)

By default, the workflow uploads the extension but does NOT publish it to the public store (it stays in draft).

**To make it live:**
1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
2. Find the ngLens item
3. Click **Publish** (or click the new version item and publish it)

**Or** to auto-publish, uncomment the publish section in `scripts/publish-to-webstore.mjs` (not recommended for production — manual review is safer).

## Workflow File

The workflow is defined in `.github/workflows/release.yml`. It:

1. Triggers on version tags (`v*`)
2. Checks out the code
3. Installs dependencies
4. Runs full test suite
5. Builds production bundle
6. Uploads to Chrome Web Store
7. Creates a GitHub Release page

## Troubleshooting

### "CWS_CLIENT_ID is missing"
- Check that all four secrets are added to GitHub: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `EXTENSION_ID`
- Go to **Settings** → **Secrets and variables** → **Actions** to verify

### "Upload failed: 401 Unauthorized"
- The OAuth token is likely expired or invalid
- Re-generate a fresh refresh token using the Google OAuth flow
- Update the `CWS_REFRESH_TOKEN` secret

### "Extension not found"
- Verify the `EXTENSION_ID` is correct (check the Web Store Developer Dashboard)
- Make sure you own or have admin access to the extension

### Tests Fail, Build Doesn't Publish
- The workflow stops at the first failure (tests or build)
- Fix the issue locally, commit, and push a new tag
- Example: if tests fail, run `npm run test` locally, fix the issue, then re-tag and push

## Manual Upload (If Needed)

To upload manually without GitHub Actions:

```bash
CWS_CLIENT_ID=your_id \
CWS_CLIENT_SECRET=your_secret \
CWS_REFRESH_TOKEN=your_token \
EXTENSION_ID=your_extension_id \
node scripts/publish-to-webstore.mjs
```

Make sure you've run `npm run build:prod` first to generate the dist/ folder.

## Release Checklist

Before every release:

- [ ] Bump version in `package.json` and `manifest.json`
- [ ] Run `npm run test` locally (ensure all tests pass)
- [ ] Run `npm run build:prod` locally (ensure no build warnings)
- [ ] Commit and push
- [ ] Create and push a version tag: `git tag v1.2.1 && git push origin v1.2.1`
- [ ] Monitor the GitHub Actions workflow
- [ ] Manually publish in the Chrome Web Store Developer Dashboard (or verify auto-publish worked)
- [ ] Create release notes on GitHub

## See Also

- [chrome-webstore-upload documentation](https://github.com/DrewML/chrome-webstore-upload)
- [Chrome Web Store API docs](https://developer.chrome.com/docs/webstore/api/)
- [GitHub Actions documentation](https://docs.github.com/en/actions)
