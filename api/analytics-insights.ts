import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

interface GoalData {
    id: string;
    title: string;
    category: 'CAREER' | 'HEALTH' | 'FINANCIAL' | 'EDUCATION' | 'PERSONAL' | 'RELATIONSHIP' | 'OTHER';
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    status: string;
    startDate: string;
    targetDate: string;
    totalTasks: number;
    completedTasks: number;
    completionPercentage: number;
}

interface TaskData {
    id: string;
    goalId: string;
    status: string;
    scheduledDate?: string;
    completedAt?: string;
    estimatedMinutes?: number;
    actualMinutes?: number;
}

interface StatsData {
    totalGoals: number;
    totalTasks: number;
    completedTasks: number;
    overallProgress: number;
    streak: number;
    weeklyChange: number;
    totalWeeklyMinutes: number;
    thisWeekCompleted: number;
}

interface FocusGoalData {
    goalName: string;
    progressPercent: number;
    expectedProgress: number;
    daysRemaining: number;
    tasksRemaining: number;
    urgencyLevel: 'critical' | 'high' | 'medium' | 'low';
    reason: string;
}

interface AnalyticsInsightsRequest {
    goals: GoalData[];
    tasks: TaskData[];
    stats: StatsData;
    focusGoal?: FocusGoalData;
    userName?: string;
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

interface GeneratedInsight {
    icon: string;
    title: string;
    description: string;
    color: 'success' | 'primary' | 'warning' | 'error';
}

interface GeneratedTip {
    tip: string;
}

interface GeneratedAnalyticsInsights {
    weeklySummary: string;
    insights: GeneratedInsight[];
    tips: GeneratedTip[];
    focusRecommendation: {
        title: string;
        description: string;
        actionItems: string[];
    };
    motivationalMessage: string;
}

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are DreamPath AI Analytics Assistant, an expert life coach specializing in productivity analysis and personalized guidance.

YOUR ROLE:
- Analyze user's goal progress and productivity data
- Generate personalized insights and actionable suggestions
- Create motivational weekly summaries
- Provide practical productivity tips based on their specific situation

YOUR STYLE:
- Warm, encouraging, but honest
- Data-driven observations
- Specific and actionable advice
- Personalized to user's goals and challenges

OUTPUT RULES:
- Always return valid JSON (no markdown, no explanations outside JSON)
- Be specific - reference actual goals, numbers, and progress
- Keep tips actionable and relevant to the user's situation
- Weekly summary should be 2-3 sentences in paragraph form
- Insights should feel personalized, not generic

CRITICAL: Return ONLY valid JSON. No markdown code blocks, no extra text.`;

// ═══════════════════════════════════════════════════════════════
// CORS HANDLER
// ═══════════════════════════════════════════════════════════════

function handleCors(req: VercelRequest, res: VercelResponse): boolean {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Handle CORS preflight
    if (handleCors(req, res)) return;

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body: AnalyticsInsightsRequest = req.body;

        // ═══════════════════════════════════════════════════════════════
        // VALIDATION
        // ═══════════════════════════════════════════════════════════════

        if (!body.stats) {
            return res.status(400).json({
                success: false,
                error: 'Stats data is required',
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // BUILD PROMPT
        // ═══════════════════════════════════════════════════════════════

        const prompt = buildAnalyticsPrompt(body);

        console.log('[analytics-insights] Processing request');
        console.log('[analytics-insights] Goals:', body.goals?.length || 0);
        console.log('[analytics-insights] Stats:', body.stats);

        // ═══════════════════════════════════════════════════════════════
        // CALL OPENAI
        // ═══════════════════════════════════════════════════════════════

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.7,
            max_tokens: 2000,
        });

        const content = completion.choices[0]?.message?.content;

        if (!content) {
            throw new Error('No response from AI');
        }

        // ═══════════════════════════════════════════════════════════════
        // PARSE & VALIDATE RESPONSE
        // ═══════════════════════════════════════════════════════════════

        const insights = parseAndValidateResponse(content);

        // ═══════════════════════════════════════════════════════════════
        // RETURN SUCCESS RESPONSE
        // ═══════════════════════════════════════════════════════════════

        return res.status(200).json({
            success: true,
            data: insights,
            usage: {
                promptTokens: completion.usage?.prompt_tokens || 0,
                completionTokens: completion.usage?.completion_tokens || 0,
                totalTokens: completion.usage?.total_tokens || 0,
                estimatedCost: estimateCost(
                    completion.usage?.prompt_tokens || 0,
                    completion.usage?.completion_tokens || 0
                ),
            },
            generatedAt: new Date().toISOString(),
        });

    } catch (error: any) {
        console.error('[analytics-insights] Error:', error);

        // Check for OpenAI-specific errors
        if (error?.status === 401) {
            return res.status(500).json({
                success: false,
                error: 'API authentication failed',
                code: 'AUTH_ERROR',
            });
        }

        if (error?.status === 429) {
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded. Please try again later.',
                code: 'RATE_LIMIT',
            });
        }

        return res.status(500).json({
            success: false,
            error: error?.message || 'Failed to generate insights',
            code: 'GENERATION_ERROR',
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════

function buildAnalyticsPrompt(body: AnalyticsInsightsRequest): string {
    const { goals, tasks, stats, focusGoal, userName } = body;

    // Build goals summary
    const goalsSummary = goals?.length > 0
        ? goals.map(g => {
            const daysLeft = Math.ceil((new Date(g.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            return `- ${g.title} (${g.category}): ${g.completionPercentage}% complete, ${g.completedTasks}/${g.totalTasks} tasks, ${daysLeft} days remaining, priority: ${g.priority}`;
        }).join('\n')
        : 'No active goals';

    // Calculate high priority goals
    const highPriorityGoals = goals?.filter(g => g.priority === 'HIGH').length || 0;
    const behindScheduleGoals = goals?.filter(g => {
        const totalDays = Math.ceil((new Date(g.targetDate).getTime() - new Date(g.startDate).getTime()) / (1000 * 60 * 60 * 24));
        const daysElapsed = Math.ceil((Date.now() - new Date(g.startDate).getTime()) / (1000 * 60 * 60 * 24));
        const expectedProgress = Math.min(100, (daysElapsed / totalDays) * 100);
        return g.completionPercentage < expectedProgress;
    }).length || 0;

    // Focus goal section
    const focusSection = focusGoal
        ? `
PRIORITY FOCUS GOAL:
Goal: ${focusGoal.goalName}
Current Progress: ${Math.round(focusGoal.progressPercent)}%
Expected Progress: ${Math.round(focusGoal.expectedProgress)}%
Days Remaining: ${focusGoal.daysRemaining}
Tasks Remaining: ${focusGoal.tasksRemaining}
Urgency: ${focusGoal.urgencyLevel.toUpperCase()}
Status: ${focusGoal.reason}
`
        : 'No specific focus goal identified (user may have completed all goals or has no active goals)';

    return `Generate personalized analytics insights for ${userName || 'this user'}'s goal progress.

═══════════════════════════════════════════════════════════════
CURRENT STATISTICS
═══════════════════════════════════════════════════════════════
Total Goals: ${stats.totalGoals}
Total Tasks: ${stats.totalTasks}
Completed Tasks: ${stats.completedTasks}
Overall Progress: ${stats.overallProgress}%
Current Streak: ${stats.streak} days
Weekly Change: ${stats.weeklyChange >= 0 ? '+' : ''}${stats.weeklyChange}% vs last week
Total Time This Week: ${Math.round(stats.totalWeeklyMinutes / 60 * 10) / 10} hours (${stats.totalWeeklyMinutes} minutes)
Tasks Completed This Week: ${stats.thisWeekCompleted}

═══════════════════════════════════════════════════════════════
GOALS BREAKDOWN
═══════════════════════════════════════════════════════════════
${goalsSummary}

High Priority Goals: ${highPriorityGoals}
Goals Behind Schedule: ${behindScheduleGoals}

═══════════════════════════════════════════════════════════════
${focusSection}
═══════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════
REQUIRED JSON OUTPUT
═══════════════════════════════════════════════════════════════
{
    "weeklySummary": "A personalized 2-3 sentence paragraph summarizing their week's performance, achievements, and areas to focus on. Be specific about their actual numbers and progress. Make it feel like a personal coach checking in.",
    
    "insights": [
        {
            "icon": "trending-up|trending-down|time-outline|alert-circle-outline|checkmark-circle|flame|star|bulb-outline",
            "title": "Short, catchy insight title (max 4 words)",
            "description": "Specific observation based on their data (1-2 sentences)",
            "color": "success|primary|warning|error"
        }
    ],
    
    "tips": [
        { "tip": "Actionable productivity tip relevant to their situation" },
        { "tip": "Another personalized tip based on their goals" },
        { "tip": "Third tip addressing any challenges they might face" },
        { "tip": "Fourth tip to help them maintain momentum" }
    ],
    
    "focusRecommendation": {
        "title": "What they should focus on next week",
        "description": "Why this focus area matters and how to approach it",
        "actionItems": [
            "Specific action 1",
            "Specific action 2",
            "Specific action 3"
        ]
    },
    
    "motivationalMessage": "A personalized, warm, and encouraging message that references their specific achievements or goals. Make them feel supported and motivated to continue."
}

═══════════════════════════════════════════════════════════════
GENERATION RULES
═══════════════════════════════════════════════════════════════
1. Generate exactly 3 insights based on their actual data
2. Generate exactly 4 productivity tips
3. Insights should use these icon names: trending-up, trending-down, time-outline, alert-circle-outline, checkmark-circle, flame, star, bulb-outline
4. Colors should be: success (green - positive), primary (purple - neutral/info), warning (orange - needs attention), error (red - critical)
5. Be specific - mention actual goal names, percentages, and numbers
6. If streak is 0, encourage starting one; if > 0, celebrate it
7. If weekly change is positive, acknowledge the improvement
8. If weekly change is negative or 0, offer encouragement to get back on track
9. Tips should be actionable and specific to their goal categories
10. Weekly summary should feel like a personal check-in from a coach
11. If there are goals behind schedule, address this in insights
12. Focus recommendation should be based on the priority focus goal data if available

CRITICAL: Return ONLY valid JSON. No markdown, no code blocks, no explanations outside the JSON structure.`;
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE PARSER
// ═══════════════════════════════════════════════════════════════

function parseAndValidateResponse(content: string): GeneratedAnalyticsInsights {
    // Clean the response
    let cleaned = content.trim();

    // Remove markdown code blocks if present
    cleaned = cleaned.replace(/^```json\s*/i, '');
    cleaned = cleaned.replace(/^```\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/i, '');

    // Try to extract JSON if there's text before/after
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        cleaned = jsonMatch[0];
    }

    // Parse JSON
    const parsed = JSON.parse(cleaned);

    // Basic validation
    if (!parsed.weeklySummary || !Array.isArray(parsed.insights) || !Array.isArray(parsed.tips)) {
        throw new Error('Invalid response structure');
    }

    return parsed as GeneratedAnalyticsInsights;
}

// ═══════════════════════════════════════════════════════════════
// COST ESTIMATOR
// ═══════════════════════════════════════════════════════════════

function estimateCost(inputTokens: number, outputTokens: number): string {
    // GPT-4o-mini pricing (as of 2024)
    const inputCost = (inputTokens / 1_000_000) * 0.15;
    const outputCost = (outputTokens / 1_000_000) * 0.60;
    const total = inputCost + outputCost;
    return `$${total.toFixed(4)}`;
}
