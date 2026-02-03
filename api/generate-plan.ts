import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS - Matching DreamPath Domain Entities
// ═══════════════════════════════════════════════════════════════

// User Profile (from onboarding)
interface UserProfile {
    age?: number;
    occupation?: string;
    educationLevel?: string;
}

interface UserFinances {
    monthlyBudget?: number;
    currency?: string;
}

interface UserTime {
    dailyAvailableHours: number;
    preferredTimeSlots?: string[];
    busyDays?: string[];
}

interface UserSkills {
    experienceLevel: 'beginner' | 'intermediate' | 'advanced';
    existingSkills?: string[];
    learningInterests?: string[];
}

interface UserChallenges {
    selected: string[];
    custom?: string;
}

// Goal Input (from goal creation wizard)
interface GoalInput {
    title: string;
    description?: string;
    category: 'CAREER' | 'HEALTH' | 'FINANCIAL' | 'EDUCATION' | 'PERSONAL' | 'RELATIONSHIP' | 'OTHER';
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    startDate: string;
    targetDate: string;
}

// Complete Request Body
interface PlanGenerationRequest {
    goal: GoalInput;
    user: {
        id?: string;
        displayName?: string;
        profile?: UserProfile;
        finances?: UserFinances;
        timeAvailability: UserTime;
        skills: UserSkills;
        challenges?: UserChallenges;
    };
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE TYPES - What ChatGPT Returns
// ═══════════════════════════════════════════════════════════════

interface GeneratedTask {
    title: string;
    description: string;
    estimatedMinutes: number;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    category: 'LEARNING' | 'ACTION' | 'PLANNING' | 'REVIEW' | 'PRACTICE' | 'NETWORKING';
    dayOfWeek: number; // 1-7 (Monday-Sunday)
    weekNumber: number;
    tips?: string;
}

interface GeneratedMilestone {
    order: number;
    title: string;
    description: string;
    targetDate: string; // ISO date
    weekNumber: number;
    keyActivities: string[];
    tasks: GeneratedTask[];
}

interface GeneratedRisk {
    risk: string;
    likelihood: 'LOW' | 'MEDIUM' | 'HIGH';
    mitigation: string;
}

interface GeneratedPlan {
    planSummary: string;
    goalTitle: string;
    goalDescription: string;
    difficultyScore: number; // 1-10
    difficultyExplanation: string;
    totalWeeks: number;
    weeklyHoursRequired: number;
    successProbability: number; // 0.5-0.95
    keySuccessFactors: string[];
    milestones: GeneratedMilestone[];
    risks: GeneratedRisk[];
    resourceRequirements: {
        timeInvestment: string;
        financialInvestment: string;
        toolsNeeded: string[];
        skillsToDevelop: string[];
    };
    quickWins: string[];
    motivationalMessage: string;
}

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT - DreamPath AI Personality
// ═══════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are DreamPath AI, an expert life coach and strategic planner with 20+ years of experience helping people achieve ambitious goals.

YOUR ROLE:
- Analyze goals and create realistic, achievable action plans
- Break down large goals into manageable milestones and daily tasks
- Consider user's unique circumstances (time, money, skills, constraints)
- Be motivating but realistic - never overpromise

YOUR STYLE:
- Clear, actionable language
- Supportive but honest
- Practical over theoretical
- Specific over vague

OUTPUT RULES:
- Always return valid JSON (no markdown, no explanations outside JSON)
- Include all required fields as specified in the schema
- Use ISO 8601 date format (YYYY-MM-DD)
- Task times should fit within user's daily availability
- Be realistic about what can be achieved

CONSTRAINTS TO RESPECT:
- Never suggest more hours than user's stated availability
- Consider financial limitations in recommendations
- Account for user's current skill/experience level
- Factor in known challenges and provide mitigation strategies
- Adjust task difficulty based on experience level`;

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
        const body: PlanGenerationRequest = req.body;

        // ═══════════════════════════════════════════════════════════════
        // VALIDATION
        // ═══════════════════════════════════════════════════════════════
        
        if (!body.goal?.title || !body.goal?.targetDate) {
            return res.status(400).json({ 
                error: 'Missing required fields: goal.title and goal.targetDate are required' 
            });
        }

        if (!body.user?.timeAvailability?.dailyAvailableHours) {
            return res.status(400).json({ 
                error: 'Missing required field: user.timeAvailability.dailyAvailableHours' 
            });
        }

        // Calculate timeline
        const now = new Date();
        const startDate = body.goal.startDate ? new Date(body.goal.startDate) : now;
        const targetDate = new Date(body.goal.targetDate);
        
        const daysUntilTarget = Math.ceil((targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const weeksUntilTarget = Math.ceil(daysUntilTarget / 7);

        if (daysUntilTarget < 7) {
            return res.status(400).json({ error: 'Target date must be at least 1 week in the future' });
        }

        // ═══════════════════════════════════════════════════════════════
        // BUILD PROMPT
        // ═══════════════════════════════════════════════════════════════
        
        const prompt = buildComprehensivePrompt(body, daysUntilTarget, weeksUntilTarget, targetDate);

        // Log for debugging (remove in production)
        console.log('[generate-plan] Processing request for goal:', body.goal.title);
        console.log('[generate-plan] Timeline:', daysUntilTarget, 'days /', weeksUntilTarget, 'weeks');

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
            max_tokens: 16000,
        });

        const content = completion.choices[0]?.message?.content;
        
        if (!content) {
            throw new Error('No response from ChatGPT');
        }

        // ═══════════════════════════════════════════════════════════════
        // PARSE & VALIDATE RESPONSE
        // ═══════════════════════════════════════════════════════════════
        
        const plan = parseAndValidateResponse(content);

        // ═══════════════════════════════════════════════════════════════
        // RETURN SUCCESS RESPONSE
        // ═══════════════════════════════════════════════════════════════
        
        return res.status(200).json({
            success: true,
            plan,
            metadata: {
                generatedAt: new Date().toISOString(),
                daysUntilTarget,
                weeksUntilTarget,
                model: 'gpt-4o-mini',
            },
            usage: {
                promptTokens: completion.usage?.prompt_tokens,
                completionTokens: completion.usage?.completion_tokens,
                totalTokens: completion.usage?.total_tokens,
                estimatedCost: estimateCost(
                    completion.usage?.prompt_tokens || 0,
                    completion.usage?.completion_tokens || 0
                ),
            }
        });

    } catch (error: any) {
        console.error('[generate-plan] Error:', error);

        // Handle specific OpenAI errors
        if (error.code === 'insufficient_quota') {
            return res.status(503).json({ 
                error: 'AI service temporarily unavailable. Please try again later.',
                code: 'QUOTA_EXCEEDED'
            });
        }

        if (error.code === 'rate_limit_exceeded') {
            return res.status(429).json({ 
                error: 'Too many requests. Please wait a moment and try again.',
                code: 'RATE_LIMITED'
            });
        }

        return res.status(500).json({ 
            error: error.message || 'Failed to generate plan',
            code: 'GENERATION_ERROR'
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// PROMPT BUILDER - Comprehensive & Structured
// ═══════════════════════════════════════════════════════════════

function buildComprehensivePrompt(
    body: PlanGenerationRequest, 
    daysUntilTarget: number, 
    weeksUntilTarget: number,
    targetDate: Date
): string {
    const { goal, user } = body;
    
    // Determine number of milestones based on timeline
    const numMilestones = Math.min(Math.max(weeksUntilTarget, 3), 8);
    
    // Calculate experience multiplier for task difficulty
    const experienceMultiplier = {
        'beginner': 'Start with fundamentals, include more learning tasks, break complex activities into smaller steps',
        'intermediate': 'Balance learning with practice, include moderate challenges, build on existing knowledge',
        'advanced': 'Focus on optimization and mastery, include stretch goals, emphasize efficiency',
    }[user.skills?.experienceLevel || 'beginner'];

    // Build challenges section
    const challengesSection = user.challenges?.selected?.length 
        ? `Known Challenges: ${user.challenges.selected.join(', ')}${user.challenges.custom ? `, ${user.challenges.custom}` : ''}`
        : 'No specific challenges mentioned';

    // Build skills section
    const skillsSection = user.skills?.existingSkills?.length
        ? `Existing Skills: ${user.skills.existingSkills.join(', ')}`
        : 'No specific skills mentioned';

    return `Create a comprehensive, personalized action plan for achieving this goal.

═══════════════════════════════════════════════════════════════
GOAL INFORMATION
═══════════════════════════════════════════════════════════════
Title: ${goal.title}
Description: ${goal.description || 'No additional description provided'}
Category: ${goal.category}
Priority: ${goal.priority}
Start Date: ${goal.startDate || new Date().toISOString().split('T')[0]}
Target Date: ${goal.targetDate}
Timeline: ${daysUntilTarget} days (${weeksUntilTarget} weeks)

═══════════════════════════════════════════════════════════════
USER PROFILE
═══════════════════════════════════════════════════════════════
${user.displayName ? `Name: ${user.displayName}` : ''}
${user.profile?.age ? `Age: ${user.profile.age}` : ''}
${user.profile?.occupation ? `Occupation: ${user.profile.occupation}` : ''}
${user.profile?.educationLevel ? `Education: ${user.profile.educationLevel}` : ''}

═══════════════════════════════════════════════════════════════
TIME AVAILABILITY
═══════════════════════════════════════════════════════════════
Daily Hours Available: ${user.timeAvailability.dailyAvailableHours} hours
${user.timeAvailability.preferredTimeSlots?.length ? `Preferred Times: ${user.timeAvailability.preferredTimeSlots.join(', ')}` : ''}
${user.timeAvailability.busyDays?.length ? `Busy Days: ${user.timeAvailability.busyDays.join(', ')}` : ''}
Weekly Commitment Capacity: ${user.timeAvailability.dailyAvailableHours * 7} hours maximum

═══════════════════════════════════════════════════════════════
FINANCIAL CONTEXT
═══════════════════════════════════════════════════════════════
${user.finances?.monthlyBudget ? `Monthly Budget: ${user.finances.currency || '$'}${user.finances.monthlyBudget}` : 'Budget: Flexible / Not specified'}

═══════════════════════════════════════════════════════════════
EXPERIENCE & SKILLS
═══════════════════════════════════════════════════════════════
Experience Level: ${user.skills?.experienceLevel || 'beginner'} 
Strategy: ${experienceMultiplier}
${skillsSection}
${user.skills?.learningInterests?.length ? `Interested in Learning: ${user.skills.learningInterests.join(', ')}` : ''}

═══════════════════════════════════════════════════════════════
CHALLENGES & OBSTACLES
═══════════════════════════════════════════════════════════════
${challengesSection}

═══════════════════════════════════════════════════════════════
REQUIRED JSON OUTPUT SCHEMA
═══════════════════════════════════════════════════════════════
{
    "planSummary": "2-3 sentence strategic overview of the approach",
    "goalTitle": "Refined, action-oriented title",
    "goalDescription": "Clear description of the end state",
    "difficultyScore": <1-10 based on user context>,
    "difficultyExplanation": "Why this difficulty level given user's situation",
    "totalWeeks": ${weeksUntilTarget},
    "weeklyHoursRequired": <realistic hours needed per week, max ${user.timeAvailability.dailyAvailableHours * 7}>,
    "successProbability": <0.5-0.95 based on realistic assessment>,
    "keySuccessFactors": ["factor1", "factor2", "factor3"],
    "milestones": [
        {
            "order": 1,
            "title": "Action-oriented milestone title",
            "description": "What will be accomplished",
            "targetDate": "YYYY-MM-DD",
            "weekNumber": 1,
            "keyActivities": ["activity1", "activity2", "activity3"],
            "tasks": [
                {
                    "title": "Specific, actionable task title (max 60 chars)",
                    "description": "DETAILED description with: 1) Exact steps to follow 2) Resources/tools to use 3) Expected outcome 4) Tips to avoid common mistakes. Minimum 100 words.",
                    "estimatedMinutes": <15-90, multiple tasks should fill daily ${user.timeAvailability.dailyAvailableHours * 60} minutes>,
                    "priority": "HIGH|MEDIUM|LOW",
                    "difficulty": "EASY|MEDIUM|HARD",
                    "category": "LEARNING|ACTION|PLANNING|REVIEW|PRACTICE|NETWORKING",
                    "dayOfWeek": <1-7, Monday=1, EVERY day must have tasks>,
                    "weekNumber": 1,
                    "tips": "Practical advice, shortcuts, or motivation (REQUIRED)"
                }
            ]
        }
    ],
    "risks": [
        {
            "risk": "Potential obstacle",
            "likelihood": "LOW|MEDIUM|HIGH",
            "mitigation": "How to prevent or handle it"
        }
    ],
    "resourceRequirements": {
        "timeInvestment": "X hours per week",
        "financialInvestment": "$X - $Y or 'None required'",
        "toolsNeeded": ["tool1", "tool2"],
        "skillsToDevelop": ["skill1", "skill2"]
    },
    "quickWins": [
        "Something achievable in first 3 days",
        "Another quick win to build momentum"
    ],
    "motivationalMessage": "Personalized encouragement based on user's goal and challenges"
}

═══════════════════════════════════════════════════════════════
GENERATION RULES
═══════════════════════════════════════════════════════════════
1. Create exactly ${numMilestones} milestones spread across ${weeksUntilTarget} weeks
2. EVERY SINGLE DAY must have tasks - no empty days allowed
3. Each day MUST contain enough tasks to fill approximately ${user.timeAvailability.dailyAvailableHours * 60} minutes (${user.timeAvailability.dailyAvailableHours} hours)
4. Each day MUST include at least TWO tasks unless a single task uses 90-100% of the daily available time
5. Calculate total daily minutes = ${user.timeAvailability.dailyAvailableHours * 60}. The sum of all task estimatedMinutes per day must fall between 80-100% of this value
6. No single task may exceed 50% of the daily available time unless it is the only task for that day
7. Start with easier tasks in week 1 and gradually increase difficulty over time
8. Include variety each day: mix learning, practice, planning, and action tasks
9. Address user challenges with explicit mitigation strategies inside tasks or tips
10. ${user.finances?.monthlyBudget ? `Keep financial recommendations under $${user.finances.monthlyBudget}/month` : 'Prioritize free or low-cost resources'}
11. Task difficulty must align with the user's "${user.skills?.experienceLevel || 'beginner'}" level
12. Include 2-3 quick wins achievable within the first week
13. Each milestone target date must be a real date between today and ${targetDate.toISOString().split('T')[0]}
14. Motivational message must reference the user's specific goal and challenges

═══════════════════════════════════════════════════════════════
CRITICAL TASK REQUIREMENTS
═══════════════════════════════════════════════════════════════
DAILY COVERAGE:
- User has ${user.timeAvailability.dailyAvailableHours} hours (${user.timeAvailability.dailyAvailableHours * 60} minutes) per day
- EVERY day (1-7) of EVERY week must contain tasks
- Total task time per day must use 80-100% of available time
- If a user has 2 hours/day, each day should contain tasks totaling roughly 90-120 minutes
- If total time is not fully consumed by one task, the remaining time MUST be filled with additional tasks

TASK DESCRIPTIONS MUST BE DETAILED:
Each task description should include:
- Exactly WHAT to do (Be written in clear, natural paragraph form)
- naturally clearly explain what to do, how to do it, tools/resources, expected outcome, and common mistakes
- WHERE to find resources (websites, apps, books if applicable)
- EXPECTED OUTCOME (what success looks like)
- COMMON MISTAKES to avoid
- Sound like a mentor guiding the user, NOT a numbered tutorial

STRICTLY FORBIDDEN IN DESCRIPTIONS:
- Numbered steps (Step 1, Step 2, etc.)
- Bullet points or lists
- Short or vague sentences


Example of a GOOD detailed task:
{
    "title": "Complete Python Basics Tutorial - Variables & Data Types",
    "description": "Spend this session learning Python variables and data types using a beginner-friendly platform such as Codecademy or freeCodeCamp, focusing on how different data types are defined and used in real code. Apply what you learn by creating a simple practice.py file and experimenting with declaring variables of different types, including strings, integers, floats, booleans, and lists, then printing each variable along with its type to reinforce understanding. By the end of this task, you should feel comfortable creating and identifying Python variables without needing to constantly check documentation. Be careful with naming conventions, as Python is case-sensitive and variables like Name and name are treated as completely different identifiers.",
    "estimatedMinutes": 45,
    ...
}

Example of a BAD task (too vague - DO NOT DO THIS):
{
    "title": "Learn Python basics",
    "description": "Study Python fundamentals",
    "estimatedMinutes": 30,
    ...
}

TASK DISTRIBUTION PER DAY:
- Each weekNumber + dayOfWeek combination MUST include multiple tasks if individual tasks are shorter than 60 minutes
- For ${user.timeAvailability.dailyAvailableHours} hours/day, aim for ${Math.ceil((user.timeAvailability.dailyAvailableHours * 60) / 30)} to ${Math.ceil((user.timeAvailability.dailyAvailableHours * 60) / 45)} tasks per day
- Tasks must range between 15 and 90 minutes
- Larger tasks (60-90 minutes) may stand alone ONLY if they nearly fill the daily time

TIPS FIELD:
- Every task MUST have a "tips" field
- Tips must provide practical advice, shortcuts, motivation
- Reference specific resources when helpful

CRITICAL: Return ONLY valid JSON. No markdown, no code blocks, no explanations outside the JSON structure.`;
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE PARSER & VALIDATOR
// ═══════════════════════════════════════════════════════════════

function parseAndValidateResponse(content: string): GeneratedPlan {
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
    if (!parsed.planSummary || !Array.isArray(parsed.milestones) || parsed.milestones.length === 0) {
        throw new Error('Invalid response structure: missing required fields');
    }

    // Validate each milestone has tasks
    for (const milestone of parsed.milestones) {
        if (!Array.isArray(milestone.tasks) || milestone.tasks.length === 0) {
            throw new Error(`Milestone "${milestone.title}" has no tasks`);
        }
    }

    return parsed as GeneratedPlan;
}

// ═══════════════════════════════════════════════════════════════
// COST ESTIMATOR
// ═══════════════════════════════════════════════════════════════

function estimateCost(inputTokens: number, outputTokens: number): string {
    // GPT-4o-mini pricing (as of 2024)
    const inputCost = (inputTokens / 1_000_000) * 0.15;  // $0.15 per 1M input tokens
    const outputCost = (outputTokens / 1_000_000) * 0.60; // $0.60 per 1M output tokens
    const total = inputCost + outputCost;
    return `$${total.toFixed(4)}`;
}
