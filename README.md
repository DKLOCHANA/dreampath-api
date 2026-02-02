# DreamPath API

Serverless backend for DreamPath mobile app. Provides secure ChatGPT integration for AI-powered goal planning.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Get OpenAI API Key

1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign up or log in
3. Go to **API Keys** → **Create new secret key**
4. Copy the key (starts with `sk-`)

### 3. Local Development

Create a `.env` file:

```bash
OPENAI_API_KEY=sk-your-api-key-here
```

Run locally:

```bash
npm run dev
```

Test the API:

- Health check: `http://localhost:3000/api/health`
- Generate plan: `POST http://localhost:3000/api/generate-plan`

### 4. Deploy to Vercel

```bash
# Install Vercel CLI globally (if not already)
npm install -g vercel

# Login to Vercel
vercel login

# Deploy
vercel

# For production
vercel --prod
```

### 5. Add Environment Variables in Vercel

1. Go to your Vercel dashboard
2. Select the dreampath-api project
3. Go to **Settings** → **Environment Variables**
4. Add: `OPENAI_API_KEY` = your OpenAI API key
5. Redeploy the project

## API Endpoints

### GET /api/health

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "service": "DreamPath API",
  "version": "1.0.0",
  "timestamp": "2026-02-02T10:00:00.000Z"
}
```

### POST /api/generate-plan

Generate an AI-powered goal plan.

**Request Body:**

```json
{
  "goal": "Become a software developer",
  "targetDate": "2026-06-01",
  "currentSituation": "Currently working in retail, have some basic coding knowledge",
  "budget": 500,
  "hoursPerDay": 2,
  "skills": ["HTML", "Basic JavaScript"]
}
```

**Response:**

```json
{
    "success": true,
    "plan": {
        "goalTitle": "Become a Software Developer",
        "goalDescription": "...",
        "totalWeeks": 16,
        "weeklyHoursRequired": 14,
        "successProbability": 0.75,
        "tips": ["...", "...", "..."],
        "milestones": [...]
    },
    "usage": {
        "promptTokens": 500,
        "completionTokens": 2000,
        "totalTokens": 2500
    }
}
```

## Cost Estimation

Using GPT-4o-mini:

- Input: ~$0.00015 per 1K tokens
- Output: ~$0.0006 per 1K tokens
- Average request: ~$0.002 per plan generation
- 1000 users generating plans: ~$2
