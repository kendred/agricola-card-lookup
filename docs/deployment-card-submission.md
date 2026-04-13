# Card Submission Pipeline — Deployment & Azure Setup

## What Changes on Deploy

The new `api/submit-card/` folder contains an Azure Function (HTTP trigger). **Azure Static Web Apps auto-discovers new folders under `api/`** and deploys them alongside existing functions. No changes to the GitHub Actions workflow or `staticwebapp.config.json` are needed — just push to `main` and the existing CI/CD pipeline handles it.

## One-Time Setup Steps

### 1. Create the `card-submission` GitHub label

The Azure Function creates issues with `labels: ['card-submission']`. GitHub rejects issue creation if the label doesn't exist. Run this once:

```bash
gh label create card-submission \
  --description "Unrecognized card submitted via draft tool" \
  --color "d4c5f9" \
  --repo riley-m-oneill/agricola-card-lookup
```

### 2. Create a fine-grained Personal Access Token (PAT)

1. Go to **GitHub → Settings → Developer Settings → Fine-grained personal access tokens**
2. Click **Generate new token**
3. Set **Repository access** to **Only select repositories** → select `agricola-card-lookup`
4. Under **Permissions → Repository permissions**, grant **Issues: Read and Write** (nothing else)
5. Set expiration to **1 year** (maximum)
6. Click **Generate token** and copy the value

### 3. Add the PAT to Azure as an environment variable

1. Go to **Azure Portal → Static Web Apps → your app**
2. Navigate to **Configuration** (under Settings)
3. Click **+ Add** under Application settings
4. Add:
   - **Name:** `GITHUB_TOKEN`
   - **Value:** the PAT from step 2
5. Click **Save**

The function also reads `GITHUB_REPO` but defaults to `riley-m-oneill/agricola-card-lookup`, so you only need to set it if the repo name ever changes.

## Verification

After deploying:

1. Open `draft.html` in production
2. Search for a card name that doesn't exist in the database
3. Click **+ Add "..." as temporary card**
4. Fill in the name and type, then click **Add to Hand**
5. Open browser DevTools console — you should see a `[card-submit] Submitted: ...` log line
6. Go to **GitHub → Issues** on the repo — a new issue with the `card-submission` label should appear with the card details

## Admin Review Workflow

1. Go to GitHub Issues → filter by the `card-submission` label
2. Review each submission (the issue body has a human-readable table and a machine-readable JSON block)
3. For approved cards: copy the JSON into `data/agricola-cards.json` (and `api/data/agricola-cards.json`), adding any admin-assigned fields (`card_id`, `tags`, etc.) and setting stats fields to `null` or placeholder values
4. Close the issue
5. Push to `main` → auto-deploy picks up the updated card database

## Environment Variables Summary

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `GITHUB_TOKEN` | Yes | — | Fine-grained PAT with Issues read/write |
| `GITHUB_REPO` | No | `riley-m-oneill/agricola-card-lookup` | Target repo for issue creation |

## Token Rotation

The PAT expires after 1 year. When it does:
1. Generate a new token following step 2 above
2. Update the `GITHUB_TOKEN` value in Azure Portal → Configuration
3. Save — the function picks up the new value on next cold start (no redeploy needed)
