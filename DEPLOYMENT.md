# GitHub Pages Deployment Guide

## Quick Start

1. **Initialize Git Repository:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: HawkAI Scan"
   ```

2. **Create GitHub Repository:**
   - Go to https://github.com/new
   - Create a new repository (e.g., `hawkai` or `hawkai-scan`)
   - **Do NOT** initialize with README, .gitignore, or license (we already have these)

3. **Push to GitHub:**
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git branch -M main
   git push -u origin main
   ```

4. **Enable GitHub Pages:**
   - Go to your repository on GitHub
   - Click **Settings** → **Pages**
   - Under **Source**, select **GitHub Actions**
   - Save the settings

5. **Verify Deployment:**
   - Go to **Actions** tab in your repository
   - You should see the "Deploy to GitHub Pages" workflow running
   - Once complete, your site will be available at:
     - `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/` (if repo is not `username.github.io`)
     - `https://YOUR_USERNAME.github.io/` (if repo is `username.github.io`)

## Custom Domain (Optional)

If you want to use a custom domain:

1. Add a `CNAME` file in the `public/` directory with your domain name
2. Configure DNS records as per GitHub Pages documentation
3. The workflow will automatically include the CNAME file in the build

## Manual Deployment

If you prefer to deploy manually:

```bash
npm run build
# Then upload the contents of the dist/ folder to your GitHub Pages branch
```

## Troubleshooting

- **404 errors:** Make sure the `base` path in `vite.config.ts` matches your repository name
- **Assets not loading:** Check that the base path is correctly set
- **Build fails:** Check the Actions tab for error logs

