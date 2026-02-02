import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Types for the request
interface GoalRequest {
    goal: string;
    targetDate: string;
    currentSituation?: string;
    budget?: number;
    hoursPerDay?: number;
    skills?: string[];
    userId?: string;
}

interface Task {
    title: string;
    description: string;
    estimatedMinutes: number;
    category: 'learning' | 'practice' | 'networking' | 'preparation' | 'application';
    priority: 'high' | 'medium' | 'low';
    week: number;
    day: number;
}

interface Milestone {
    title: string;
    description: string;
    weekNumber: number;
    tasks: Task[];
}

interface GeneratedPlan {
    goalTitle: string;
    goalDescription: string;
    totalWeeks: number;
    milestones: Milestone[];
    weeklyHoursRequired: number;
    successProbability: number;
    tips: string[];
}

// CORS handler
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Handle CORS preflight
    if (handleCors(req, res)) return;

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body: GoalRequest = req.body;

        // Validate required fields
        if (!body.goal || !body.targetDate) {
            return res.status(400).json({ 
                error: 'Missing required fields: goal and targetDate are required' 
            });
        }

        // Calculate weeks until target
        const now = new Date();
        const target = new Date(body.targetDate);
        const weeksUntilTarget = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 7));

        if (weeksUntilTarget < 1) {
            return res.status(400).json({ error: 'Target date must be in the future' });
        }

        // Build the prompt
        const prompt = buildPrompt(body, weeksUntilTarget);

        // Call ChatGPT
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are DreamPath AI, an expert life coach and goal planning assistant. 
You create detailed, actionable plans to help people achieve their goals.
Always respond with valid JSON matching the exact schema provided.
Be realistic about timelines and requirements.
Break down goals into weekly milestones with specific daily tasks.`
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.7,
            max_tokens: 4000,
        });

        const content = completion.choices[0]?.message?.content;
        
        if (!content) {
            throw new Error('No response from ChatGPT');
        }

        const plan: GeneratedPlan = JSON.parse(content);

        // Return the generated plan
        return res.status(200).json({
            success: true,
            plan,
            usage: {
                promptTokens: completion.usage?.prompt_tokens,
                completionTokens: completion.usage?.completion_tokens,
                totalTokens: completion.usage?.total_tokens,
            }
        });

    } catch (error: any) {
        console.error('Error generating plan:', error);

        if (error.code === 'insufficient_quota') {
            return res.status(503).json({ 
                error: 'AI service temporarily unavailable. Please try again later.' 
            });
        }

        return res.status(500).json({ 
            error: error.message || 'Failed to generate plan' 
        });
    }
}

function buildPrompt(body: GoalRequest, weeksUntilTarget: number): string {
    const { goal, currentSituation, budget, hoursPerDay, skills } = body;

    let prompt = `Create a detailed plan to achieve this goal:

GOAL: ${goal}
TIMEFRAME: ${weeksUntilTarget} weeks
HOURS AVAILABLE PER DAY: ${hoursPerDay || 2} hours`;

    if (currentSituation) {
        prompt += `\nCURRENT SITUATION: ${currentSituation}`;
    }

    if (budget) {
        prompt += `\nBUDGET: $${budget}`;
    }

    if (skills && skills.length > 0) {
        prompt += `\nEXISTING SKILLS: ${skills.join(', ')}`;
    }

    prompt += `

Respond with a JSON object matching this exact schema:
{
    "goalTitle": "Short title for the goal",
    "goalDescription": "Brief description of what will be achieved",
    "totalWeeks": ${weeksUntilTarget},
    "weeklyHoursRequired": <number>,
    "successProbability": <number between 0.5 and 0.95>,
    "tips": ["tip1", "tip2", "tip3"],
    "milestones": [
        {
            "title": "Milestone title",
            "description": "What will be accomplished",
            "weekNumber": 1,
            "tasks": [
                {
                    "title": "Task title",
                    "description": "Detailed task description",
                    "estimatedMinutes": 30,
                    "category": "learning",
                    "priority": "high",
                    "week": 1,
                    "day": 1
                }
            ]
        }
    ]
}

Requirements:
- Create ${Math.min(weeksUntilTarget, 8)} milestones (one per week, max 8)
- Each milestone should have 3-5 specific tasks
- Tasks should be actionable and specific
- Distribute tasks across days of the week (1-7)
- Categories: learning, practice, networking, preparation, application
- Be realistic about what can be achieved in the timeframe`;

    return prompt;
}
