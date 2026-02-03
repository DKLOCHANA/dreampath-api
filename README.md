# DreamPath API

Serverless backend for DreamPath mobile app. Provides secure ChatGPT integration for AI-powered goal planning and analytics insights.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Get OpenAI API Key

1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign up or log in
3. Go to **API Keys** ? **Create new secret key**
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
- Analytics insights: `POST http://localhost:3000/api/analytics-insights`

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
3. Go to **Settings** ? **Environment Variables**
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
  "goal": {
    "title": "Become a software developer",
    "category": "CAREER",
    "priority": "HIGH",
    "startDate": "2026-02-01",
    "targetDate": "2026-06-01"
  },
  "user": {
    "timeAvailability": { "dailyAvailableHours": 2 },
    "skills": { "experienceLevel": "beginner" }
  }
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
        "milestones": [...]
    },
    "usage": {
        "promptTokens": 500,
        "completionTokens": 2000,
        "totalTokens": 2500
    }
}
```

### POST /api/analytics-insights

Generate AI-powered analytics insights, tips, and weekly summary.

**Request Body:**

```json
{
  "goals": [
    {
      "id": "goal-123",
      "title": "Learn React Native",
      "category": "EDUCATION",
      "priority": "HIGH",
      "status": "ACTIVE",
      "startDate": "2026-01-01",
      "targetDate": "2026-03-01",
      "totalTasks": 20,
      "completedTasks": 8,
      "completionPercentage": 40
    }
  ],
  "tasks": [
    {
      "id": "task-1",
      "goalId": "goal-123",
      "status": "COMPLETED",
      "completedAt": "2026-02-01T10:00:00.000Z",
      "estimatedMinutes": 30,
      "actualMinutes": 35
    }
  ],
  "stats": {
    "totalGoals": 3,
    "totalTasks": 50,
    "completedTasks": 20,
    "overallProgress": 40,
    "streak": 5,
    "weeklyChange": 15,
    "totalWeeklyMinutes": 300,
    "thisWeekCompleted": 8
  },
  "focusGoal": {
    "goalName": "Learn React Native",
    "progressPercent": 40,
    "expectedProgress": 60,
    "daysRemaining": 28,
    "tasksRemaining": 12,
    "urgencyLevel": "high",
    "reason": "20% behind schedule"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "weeklySummary": "This week you completed 8 tasks and maintained a 5-day streak. Your React Native goal is slightly behind schedule, but with focused effort you can catch up.",
    "insights": [
      {
        "icon": "trending-up",
        "title": "Strong momentum!",
        "description": "You completed 15% more tasks than last week.",
        "color": "success"
      }
    ],
    "tips": [
      { "tip": "Focus on your React Native tutorials during morning hours for best retention." }
    ],
    "focusRecommendation": {
      "title": "Catch Up on React Native",
      "description": "Dedicate extra time this week to close the gap.",
      "actionItems": [
        "Complete 2 extra lessons this week",
        "Review completed material for 15 minutes daily"
      ]
    },
    "motivationalMessage": "You're building amazing skills! Keep pushing forward."
  },
  "usage": {
    "promptTokens": 800,
    "completionTokens": 500,
    "totalTokens": 1300,
    "estimatedCost": ".0004"
  }
}
```

## Cost Estimation

Using GPT-4o-mini:

- Input: ~.15 per 1M tokens
- Output: ~.60 per 1M tokens
- Average plan generation: ~.002 per request
- Average analytics insights: ~.0004 per request
- 1000 users generating plans: ~
- 1000 analytics insight requests: ~.40
