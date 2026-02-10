import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

interface GeneratedTask {
    title: string;
    description: string;
    estimatedMinutes: number;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    category: 'LEARNING' | 'ACTION' | 'PLANNING' | 'REVIEW' | 'PRACTICE' | 'NETWORKING';
    dayOfWeek: number;
    weekNumber: number;
    tips?: string;
}

interface WeekTasksRequest {
    goal: {
        title: string;
        description?: string;
        category: string;
    };
    milestone: {
        title: string;
        description: string;
        weekNumber: number;
    };
    user: {
        experienceLevel: 'beginner' | 'intermediate' | 'advanced';
        dailyAvailableHours: number;
        occupation?: string;
        challenges?: string[];
    };
    weekRange: {
        startWeek: number;
        endWeek: number;
    };
    totalWeeks: number;
}

interface WeekTasksResponse {
    success: boolean;
    tasks: GeneratedTask[];
    weekRange: {
        startWeek: number;
        endWeek: number;
    };
}

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are DreamPath AI, generating specific daily tasks for a goal.

OUTPUT RULES:
- Return ONLY valid JSON
- Every day must have at least 2 tasks
- Task times must respect user's daily available hours
- Tasks should progress logically through the weeks
- Include detailed descriptions (100+ words, no bullet points)
- Every task MUST have a "tips" field`;

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
    if (handleCors(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body: WeekTasksRequest = req.body;

        // Validation
        if (!body.goal?.title || !body.weekRange?.startWeek || !body.weekRange?.endWeek) {
            return res.status(400).json({ 
                error: 'Missing required fields: goal.title, weekRange.startWeek, weekRange.endWeek' 
            });
        }

        const { goal, milestone, user, weekRange, totalWeeks } = body;
        const dailyMinutes = (user.dailyAvailableHours || 2) * 60;
        const weeksInBatch = weekRange.endWeek - weekRange.startWeek + 1;
        const daysInBatch = weeksInBatch * 7;
        const tasksPerDay = Math.max(2, Math.ceil(dailyMinutes / 40));

        console.log(`[generate-week-tasks] Generating tasks for weeks ${weekRange.startWeek}-${weekRange.endWeek}`);

        // Build day grid for this batch
        const dayGrid = buildDayGrid(weekRange.startWeek, weekRange.endWeek, dailyMinutes, tasksPerDay);

        const prompt = buildWeekTasksPrompt(body, dailyMinutes, tasksPerDay, daysInBatch, dayGrid);

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.7,
            max_tokens: 16000,
        });

        const content = completion.choices[0]?.message?.content;
        
        if (!content) {
            throw new Error('No response from ChatGPT');
        }

        console.log(`[generate-week-tasks] Response received, length: ${content.length}`);

        // Parse response
        const parsed = JSON.parse(content);
        
        if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
            throw new Error('Invalid response: missing tasks array');
        }

        console.log(`[generate-week-tasks] Tasks generated: ${parsed.tasks.length}`);

        return res.status(200).json({
            success: true,
            tasks: parsed.tasks,
            weekRange: weekRange,
            usage: {
                totalTokens: completion.usage?.total_tokens,
            }
        } as WeekTasksResponse);

    } catch (error: any) {
        console.error('[generate-week-tasks] Error:', error);
        return res.status(500).json({ 
            error: error.message || 'Failed to generate week tasks',
            code: 'GENERATION_ERROR'
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// DAY GRID BUILDER
// ═══════════════════════════════════════════════════════════════

function buildDayGrid(startWeek: number, endWeek: number, dailyMinutes: number, tasksPerDay: number): string {
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    let grid = '';
    
    for (let week = startWeek; week <= endWeek; week++) {
        grid += `\nWEEK ${week}:\n`;
        for (let day = 1; day <= 7; day++) {
            grid += `  • ${dayNames[day - 1]} (weekNumber: ${week}, dayOfWeek: ${day}): ${tasksPerDay}+ tasks, ~${dailyMinutes} min total\n`;
        }
    }
    
    return grid;
}

// ═══════════════════════════════════════════════════════════════
// PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════

function buildWeekTasksPrompt(
    body: WeekTasksRequest, 
    dailyMinutes: number, 
    tasksPerDay: number,
    daysInBatch: number,
    dayGrid: string
): string {
    const { goal, milestone, user, weekRange, totalWeeks } = body;
    const minimumTasks = daysInBatch * 2;

    return `Generate daily tasks for weeks ${weekRange.startWeek} to ${weekRange.endWeek} of a ${totalWeeks}-week plan.

═══════════════════════════════════════════════════════════════
GOAL
═══════════════════════════════════════════════════════════════
Title: ${goal.title}
Description: ${goal.description || 'Not provided'}
Category: ${goal.category}

Current Milestone: ${milestone?.title || 'General progress'}
Milestone Description: ${milestone?.description || 'Continue working toward the goal'}

═══════════════════════════════════════════════════════════════
USER CONTEXT
═══════════════════════════════════════════════════════════════
Experience Level: ${user.experienceLevel}
Daily Time Available: ${dailyMinutes} minutes (${user.dailyAvailableHours} hours)
${user.occupation ? `Occupation: ${user.occupation}` : ''}
${user.challenges?.length ? `Challenges: ${user.challenges.join(', ')}` : ''}

═══════════════════════════════════════════════════════════════
📅 REQUIRED DAYS TO COVER
═══════════════════════════════════════════════════════════════
${dayGrid}

═══════════════════════════════════════════════════════════════
REQUIREMENTS
═══════════════════════════════════════════════════════════════
• Generate tasks for ${daysInBatch} days (${weekRange.endWeek - weekRange.startWeek + 1} weeks)
• MINIMUM ${minimumTasks} tasks total (at least 2 per day)
• Each day's tasks must total ${Math.floor(dailyMinutes * 0.8)}-${dailyMinutes} minutes
• Week ${weekRange.startWeek === 1 ? '1 should have easier setup/learning tasks' : `${weekRange.startWeek} should build on previous weeks`}
• Task descriptions: 100+ words, no bullet points, mentor-style guidance
• Every task MUST include "tips" field

═══════════════════════════════════════════════════════════════
REQUIRED JSON OUTPUT
═══════════════════════════════════════════════════════════════
{
    "tasks": [
        {
            "title": "Task title (max 60 chars)",
            "description": "Detailed paragraph (100+ words): what to do, how, resources, outcome, mistakes to avoid",
            "estimatedMinutes": <15-90>,
            "priority": "HIGH|MEDIUM|LOW",
            "difficulty": "EASY|MEDIUM|HARD",
            "category": "LEARNING|ACTION|PLANNING|REVIEW|PRACTICE|NETWORKING",
            "dayOfWeek": <1-7>,
            "weekNumber": <${weekRange.startWeek}-${weekRange.endWeek}>,
            "tips": "Practical advice (REQUIRED)"
        }
    ]
}

⚠️ CRITICAL CHECKS:
□ Every day from Week ${weekRange.startWeek} to Week ${weekRange.endWeek} has at least 2 tasks
□ Each task has weekNumber between ${weekRange.startWeek} and ${weekRange.endWeek}
□ Each task has dayOfWeek between 1 and 7
□ Daily task totals are ${Math.floor(dailyMinutes * 0.8)}-${dailyMinutes} minutes
□ All tasks have the "tips" field

Return ONLY valid JSON.`;
}
