# Azure Deployment Guide — Agricola Card Lookup

## Overview

The app has three layers that need hosting:
1. **Static website** — HTML, CSS, JS, card images (106MB), card data JSON
2. **Two Azure Functions** — `/api/ocr` (screenshot → card names) and `/api/strategy` (draft analysis)
3. **Azure OpenAI** — GPT-4o backing both functions

The recommended approach is **Azure Static Web Apps (SWA)**, which hosts static files AND Azure Functions in one resource, automatically maps functions to `/api/*` (matching the relative paths already in the code), and has a generous free tier. No nginx, no Docker, no manual routing needed.

---

## Azure Resources You'll Create

| Resource | What it does | Pricing |
|----------|-------------|---------|
| **Azure Static Web App** | Hosts HTML/CSS/JS/images + runs the two Azure Functions | Free tier (100GB bandwidth/mo, 2 custom domains) |
| **Azure OpenAI Service** | Provides GPT-4o for OCR and strategy analysis | Pay-per-token (~$2.50/1M input, $10/1M output for GPT-4o) |

That's it — just two resources.

---

## Step-by-step Deployment

### Step 1: Create an Azure Account

1. Go to [portal.azure.com](https://portal.azure.com) and sign up
2. You'll get $200 free credit for 30 days (new accounts)
3. Create a **Resource Group** (e.g., `agricola-rg`) — this is just a folder for your resources

### Step 2: Create Azure OpenAI Service

1. In the Azure Portal, search for **"Azure OpenAI"** and click Create
2. Pick your resource group (`agricola-rg`), give it a name (e.g., `agricola-openai`), pick a region
3. Pricing tier: **Standard S0** (pay-per-use)
4. Once created, go to the resource and note two things:
   - **Endpoint** (e.g., `https://agricola-openai.openai.azure.com/`)
   - **Keys** → copy **Key 1**

5. Go to **Azure AI Foundry** (link in the resource) → **Deployments** → **Create Deployment**:
   - Model: **gpt-4o**
   - Deployment name: `gpt-4o` (or any name — you'll reference it later)
   - Keep default settings

> **Gotcha:** Azure OpenAI requires an approval request. If you haven't been approved yet, you'll need to fill out a form and wait (usually 1-2 business days). Apply early: https://aka.ms/oai/access

### Step 3: Create a `staticwebapp.config.json`

Create this file in the repo root. It tells Azure SWA how to handle routing:

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/css/*", "/js/*", "/data/*", "/card-images/*", "/Icons/*", "/api/*"]
  }
}
```

This ensures direct URL access to pages works, while excluding static assets and API routes from the fallback.

### Step 4: Create Azure Static Web App

**Option A: Via Azure Portal (easiest for first time)**

1. In the Portal, search for **"Static Web Apps"** → Create
2. Fill in:
   - Resource group: `agricola-rg`
   - Name: `agricola-card-lookup`
   - Plan type: **Free**
   - Region: pick one close to you
   - Source: **GitHub**
3. Authorize GitHub and select your repo (`kendred/agricola-card-lookup`), branch `main`
4. Build settings:
   - App location: `/` (root)
   - API location: `/api`
   - Output location: `` (leave empty — no build step needed)
5. Click **Create**

Azure will automatically:
- Add a GitHub Actions workflow file (`.github/workflows/azure-static-web-apps-*.yml`) to your repo
- Deploy the static site + functions on every push to `main`
- Give you a URL like `https://happy-tree-abc123.azurestaticapps.net`

**Option B: Via Azure CLI**

```bash
az login
az staticwebapp create \
  --name agricola-card-lookup \
  --resource-group agricola-rg \
  --source https://github.com/kendred/agricola-card-lookup \
  --branch main \
  --app-location "/" \
  --api-location "/api" \
  --output-location "" \
  --login-with-github
```

### Step 5: Configure Environment Variables

The Azure Functions need your OpenAI credentials. In the Azure Portal:

1. Go to your Static Web App resource
2. Click **Configuration** (under Settings in the left menu)
3. Add these **Application Settings**:

| Name | Value |
|------|-------|
| `AZURE_OPENAI_ENDPOINT` | `https://agricola-openai.openai.azure.com/` |
| `AZURE_OPENAI_KEY` | Your Key 1 from Step 2 |
| `AZURE_OPENAI_DEPLOYMENT` | `gpt-4o` (or whatever you named the deployment) |

4. Click **Save**

> **Gotcha:** These settings are only available to the Functions runtime, never exposed to the browser. But make sure you don't accidentally commit them to your repo.

### Step 6: Verify Deployment

After the GitHub Action completes (~2-3 minutes):

1. Open your SWA URL (found in the Azure Portal overview page)
2. **Card Lookup page** — Should show 773 cards, search works, tag filter works
3. **Draft Tool** — Start a new draft, add cards via search
4. **Screenshot OCR** — Paste/upload a BGA screenshot (needs OpenAI to be configured)
5. **Strategy Advisor** — Click "Get AI Advice" with cards in hand

### Step 7: (Optional) Custom Domain

1. In your Static Web App → **Custom Domains** → Add
2. Add a CNAME record at your DNS provider pointing to the SWA URL
3. Azure auto-provisions a free SSL certificate

---

## Things That Will Trip You Up

### 1. Azure OpenAI Access Approval (Biggest Blocker)
Azure OpenAI isn't instantly available — new accounts need to apply for access. This can take 1-2 business days. **Apply before doing anything else.**

### 2. `fs.readFileSync` in Azure Functions
The strategy function loads `data/agricola-cards.json` and `docs/agricola-strategy-guide.md` using `fs.readFileSync` with `path.join(__dirname, '..', '..')`. In Azure Static Web Apps, the function runtime's working directory may differ from local. The `__dirname`-relative paths should work because SWA deploys the full repo structure, but **test this immediately** — if files aren't found, you may need to adjust paths or embed the data differently.

### 3. Card Images Size (106MB)
The `card-images/` directory is 106MB (716 PNGs). This is fine for SWA free tier (500MB storage limit) but will make:
- Initial deploy slower (~5 min)
- GitHub Actions workflow larger
- Consider: if you hit the 500MB limit, you could host images on Azure Blob Storage with a CDN instead

### 4. Cold Starts
Azure Functions on the free/consumption plan have **cold starts** — the first request after idle time (~20 min) will take 3-8 seconds while the runtime boots. The strategy function is heavier (loads 386KB JSON + 30KB guide on init). Users will notice this as a delay on the first "Get AI Advice" click after a quiet period.

### 5. Rate Limiting Resets
The in-memory rate limiting (`Map`) resets on every cold start and isn't shared across function instances. On a consumption plan with auto-scaling, different requests may hit different instances. For a personal tool this is fine; for production you'd want Azure Redis Cache or similar.

### 6. GitHub Actions Workflow Auto-Generated
Azure SWA adds a workflow file to your repo automatically. Don't delete it. If the deploy fails, check the **Actions** tab on GitHub for logs. Common issues:
- Build timeout (large card images)
- Node.js version mismatch (ensure `api/package.json` doesn't require a specific version)

### 7. CORS is Wide Open
Both functions set `Access-Control-Allow-Origin: *`. Fine for a personal tool, but if you want to restrict it, update the headers in `api/ocr/index.js` and `api/strategy/index.js` to your SWA domain.

### 8. API Version for Azure OpenAI
The functions use API version `2024-08-01-preview`. Azure occasionally retires preview versions. If calls start failing months later, check if the API version needs updating.

### 9. No `local.settings.json` for Local Dev
There's no `local.settings.json` in the repo (correctly — it should be gitignored). For local Azure Functions development, create one:
```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AZURE_OPENAI_ENDPOINT": "https://your-endpoint.openai.azure.com/",
    "AZURE_OPENAI_KEY": "your-key-here",
    "AZURE_OPENAI_DEPLOYMENT": "gpt-4o"
  }
}
```

---

## Cost Estimate (Monthly)

| Item | Cost |
|------|------|
| Azure Static Web App (Free tier) | $0 |
| Azure OpenAI — OCR calls (10/day x 30 days, ~2K tokens each) | ~$1.50 |
| Azure OpenAI — Strategy calls (5/day x 30 days, ~10K tokens each) | ~$5 |
| **Total for light personal use** | **~$6.50/mo** |

The $200 free credit for new accounts covers many months of use.

---

## Files to Create Before Deploying

| File | Action |
|------|--------|
| `staticwebapp.config.json` | **Create** in repo root — routing config for Azure SWA |
| `api/local.settings.json` | **Create** locally (gitignored) — for local dev only |
| `.gitignore` | **Update** — add `api/local.settings.json` |

---

## Environment Variables Reference

| Variable | Used By | Description |
|----------|---------|-------------|
| `AZURE_OPENAI_ENDPOINT` | Both functions | Full Azure OpenAI endpoint URL |
| `AZURE_OPENAI_KEY` | Both functions | API key for Azure OpenAI |
| `AZURE_OPENAI_DEPLOYMENT` | Both functions | Model deployment name (defaults to `gpt-4o`) |

---

## Verification Checklist

After deployment:
- [ ] SWA URL loads `index.html` with 773 cards
- [ ] Card images display on hover/detail view
- [ ] Draft tool loads, search works
- [ ] Tag filter multi-select works
- [ ] Tag dot hover shows colored tooltip
- [ ] Strategy sidebar appears on wide screens
- [ ] `/api/ocr` returns card names from a screenshot (POST with image)
- [ ] `/api/strategy` returns analysis (POST with hand data)
- [ ] Error messages are human-readable when services are unavailable
- [ ] Custom domain works (if configured)
