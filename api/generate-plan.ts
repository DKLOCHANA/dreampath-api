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
            max_tokens: 32000,
        });

        const content = completion.choices[0]?.message?.content;
        
        if (!content) {
            throw new Error('No response from ChatGPT');
        }

        // ═══════════════════════════════════════════════════════════════
        // DEBUG: Log raw GPT response
        // ═══════════════════════════════════════════════════════════════
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('[generate-plan] RAW GPT RESPONSE:');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(content);
        console.log('═══════════════════════════════════════════════════════════════\n');

        // ═══════════════════════════════════════════════════════════════
        // PARSE & VALIDATE RESPONSE
        // ═══════════════════════════════════════════════════════════════
        
        const dailyMinutes = body.user.timeAvailability.dailyAvailableHours * 60;
        const plan = parseAndValidateResponse(content, weeksUntilTarget, dailyMinutes);

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
    
    // ═══════════════════════════════════════════════════════════════
    // DYNAMIC CALCULATIONS - Never hardcode these values
    // ═══════════════════════════════════════════════════════════════
    
    // Determine number of milestones based on timeline
    const numMilestones = Math.min(Math.max(weeksUntilTarget, 3), 8);
    
    // Daily time in minutes
    const dailyMinutes = user.timeAvailability.dailyAvailableHours * 60;
    
    // Minimum tasks calculation: at least 2 per day
    const minimumTotalTasks = daysUntilTarget * 2;
    
    // Average task duration (aim for 30-45 min tasks to ensure variety)
    const avgTaskDuration = 40;
    const tasksPerDay = Math.max(2, Math.ceil(dailyMinutes / avgTaskDuration));
    
    // Total tasks needed to fill all days properly
    const idealTotalTasks = daysUntilTarget * tasksPerDay;
    
    // Build the explicit day grid for all weeks
    const dayGrid = buildDayGrid(weeksUntilTarget, dailyMinutes, tasksPerDay);
    
    // Calculate experience multiplier for task difficulty
    const experienceMultiplier = {
        'beginner': 'Start with fundamentals, include more learning tasks, break complex activities into smaller steps. Tasks should be simple, well-explained, and confidence-building.',
        'intermediate': 'Balance learning with practice, include moderate challenges, build on existing knowledge. Tasks can assume basic understanding.',
        'advanced': 'Focus on optimization and mastery, include stretch goals, emphasize efficiency. Tasks should challenge and push boundaries.',
    }[user.skills?.experienceLevel || 'beginner'];

    // Occupation-aware task suggestions
    const occupationContext = user.profile?.occupation 
        ? `Consider that the user works as a ${user.profile.occupation}. Schedule demanding tasks for when they likely have more energy (weekends or evenings). Leverage any transferable skills from their profession.`
        : 'No occupation specified - assume flexible schedule but respect daily time limits.';

    // Build challenges section
    const challengesSection = user.challenges?.selected?.length 
        ? `Known Challenges: ${user.challenges.selected.join(', ')}${user.challenges.custom ? `, ${user.challenges.custom}` : ''}\nIMPORTANT: Each challenge must be addressed in at least one task's tips or description.`
        : 'No specific challenges mentioned';

    // Build skills section
    const skillsSection = user.skills?.existingSkills?.length
        ? `Existing Skills: ${user.skills.existingSkills.join(', ')}`
        : 'No specific skills mentioned';

    return `You are creating a DAY-BY-DAY action plan. Your PRIMARY goal is to ensure EVERY SINGLE DAY has tasks that fill the user's available time.

═══════════════════════════════════════════════════════════════
🎯 CRITICAL TIME REQUIREMENTS - READ FIRST
═══════════════════════════════════════════════════════════════
• Total days in plan: ${daysUntilTarget} days
• Total weeks in plan: ${weeksUntilTarget} weeks
• User's daily time: ${dailyMinutes} minutes (${user.timeAvailability.dailyAvailableHours} hours)
• MINIMUM tasks required: ${minimumTotalTasks} tasks (at least 2 per day)
• IDEAL tasks to generate: ${idealTotalTasks} tasks (~${tasksPerDay} per day)
• Each day's tasks MUST sum to ${Math.floor(dailyMinutes * 0.8)}-${dailyMinutes} minutes

═══════════════════════════════════════════════════════════════
GOAL INFORMATION
═══════════════════════════════════════════════════════════════
Title: ${goal.title}
Description: ${goal.description || 'No additional description provided'}
Category: ${goal.category}
Priority: ${goal.priority}
Start Date: ${goal.startDate || new Date().toISOString().split('T')[0]}
Target Date: ${goal.targetDate}

═══════════════════════════════════════════════════════════════
USER CONTEXT (Use this to personalize tasks)
═══════════════════════════════════════════════════════════════
${user.displayName ? `Name: ${user.displayName}` : ''}
${user.profile?.age ? `Age: ${user.profile.age}` : ''}
${user.profile?.occupation ? `Occupation: ${user.profile.occupation}` : ''}
${occupationContext}

Experience Level: ${user.skills?.experienceLevel || 'beginner'}
${experienceMultiplier}
${skillsSection}

${challengesSection}

${user.finances?.monthlyBudget ? `Budget Constraint: Keep costs under ${user.finances.currency || '$'}${user.finances.monthlyBudget}/month` : 'Budget: Prefer free/low-cost resources'}

═══════════════════════════════════════════════════════════════
📅 MANDATORY DAY-BY-DAY COVERAGE
═══════════════════════════════════════════════════════════════
You MUST create tasks for EVERY day listed below. No exceptions.

${dayGrid}

═══════════════════════════════════════════════════════════════
REQUIRED JSON OUTPUT SCHEMA
═══════════════════════════════════════════════════════════════
{
    "planSummary": "2-3 sentence strategic overview",
    "goalTitle": "Refined, action-oriented title",
    "goalDescription": "Clear description of success",
    "difficultyScore": <1-10>,
    "difficultyExplanation": "Why this score for this user",
    "totalWeeks": ${weeksUntilTarget},
    "weeklyHoursRequired": <max ${user.timeAvailability.dailyAvailableHours * 7}>,
    "successProbability": <0.5-0.95>,
    "keySuccessFactors": ["factor1", "factor2", "factor3"],
    "milestones": [
        {
            "order": 1,
            "title": "Milestone title",
            "description": "What will be accomplished",
            "targetDate": "YYYY-MM-DD",
            "weekNumber": 1,
            "keyActivities": ["activity1", "activity2"],
            "tasks": [
                {
                    "title": "Task title (max 60 chars)",
                    "description": "Detailed paragraph (100+ words): what to do, how, resources, outcome, mistakes to avoid",
                    "estimatedMinutes": <15-90>,
                    "priority": "HIGH|MEDIUM|LOW",
                    "difficulty": "EASY|MEDIUM|HARD",
                    "category": "LEARNING|ACTION|PLANNING|REVIEW|PRACTICE|NETWORKING",
                    "dayOfWeek": <1-7>,
                    "weekNumber": <1-${weeksUntilTarget}>,
                    "tips": "Practical advice (REQUIRED)"
                }
            ]
        }
    ],
    "risks": [{"risk": "...", "likelihood": "LOW|MEDIUM|HIGH", "mitigation": "..."}],
    "resourceRequirements": {
        "timeInvestment": "X hours/week",
        "financialInvestment": "...",
        "toolsNeeded": [],
        "skillsToDevelop": []
    },
    "quickWins": ["Quick win 1", "Quick win 2"],
    "motivationalMessage": "Personalized encouragement"
}

═══════════════════════════════════════════════════════════════
⚠️ STRICT RULES - MUST FOLLOW
═══════════════════════════════════════════════════════════════

RULE 1: DAILY TASK MINIMUM
• EVERY day (Week 1 Day 1 through Week ${weeksUntilTarget} Day 7) MUST have tasks
• Each day MUST have AT LEAST 2 tasks
• Exception: A single task is allowed ONLY if it's ${Math.floor(dailyMinutes * 0.8)}+ minutes (fills 80%+ of daily time)

RULE 2: TIME ALIGNMENT
• User has exactly ${dailyMinutes} minutes per day - RESPECT THIS
• Sum of task durations per day: ${Math.floor(dailyMinutes * 0.8)}-${dailyMinutes} minutes
• Individual task duration: 15-90 minutes
• Never exceed user's daily time allocation

RULE 3: REALISTIC PROGRESSION
• Week 1: Focus on setup, learning basics, and quick wins (easier tasks)
• Middle weeks: Build momentum with practice and action tasks
• Final week(s): Focus on completion, polish, and review
• Difficulty should match user's "${user.skills?.experienceLevel || 'beginner'}" level

RULE 4: TASK VARIETY
• Mix categories each day: LEARNING, ACTION, PRACTICE, REVIEW
• Don't repeat the same task title
• Progress logically (don't assign advanced tasks before basics)

RULE 5: QUALITY DESCRIPTIONS
Each task description must be a detailed paragraph (100+ words) containing:
- WHAT to do specifically
- HOW to do it (methods, approach)
- RESOURCES to use (websites, tools, apps)
- SUCCESS criteria (how to know it's done)
- COMMON MISTAKES to avoid

FORBIDDEN in descriptions:
- Numbered steps (Step 1, Step 2)  
- Bullet points or lists
- Vague phrases like "learn the basics"

═══════════════════════════════════════════════════════════════
✅ EXAMPLE OF CORRECT DAILY DISTRIBUTION
═══════════════════════════════════════════════════════════════
If user has ${dailyMinutes} minutes/day, a valid day might look like:

Day example (${dailyMinutes} min available):
- Task 1: ${Math.floor(dailyMinutes * 0.4)} minutes
- Task 2: ${Math.floor(dailyMinutes * 0.35)} minutes  
- Task 3: ${Math.floor(dailyMinutes * 0.25)} minutes
Total: ${dailyMinutes} minutes ✓

OR if high difficulty task:
- Task 1: ${Math.floor(dailyMinutes * 0.85)} minutes (single intensive task)
Total: ${Math.floor(dailyMinutes * 0.85)} minutes ✓

═══════════════════════════════════════════════════════════════
🚨 FINAL CHECKLIST BEFORE RESPONDING
═══════════════════════════════════════════════════════════════
□ Did I create tasks for ALL ${daysUntilTarget} days?
□ Does EVERY day have at least 2 tasks (or 1 task of ${Math.floor(dailyMinutes * 0.8)}+ min)?
□ Do daily task totals equal ${Math.floor(dailyMinutes * 0.8)}-${dailyMinutes} minutes?
□ Are tasks appropriate for "${user.skills?.experienceLevel || 'beginner'}" level?
□ Did I include the required "tips" field on every task?
□ Are week 1 tasks easier than later weeks?
□ Is every task description 100+ words with no bullet points?

Return ONLY valid JSON. No markdown, no explanations.`;
}

// ═══════════════════════════════════════════════════════════════
// DAY GRID BUILDER - Creates explicit day-by-day requirement list
// ═══════════════════════════════════════════════════════════════

function buildDayGrid(weeksUntilTarget: number, dailyMinutes: number, tasksPerDay: number): string {
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    let grid = '';
    
    for (let week = 1; week <= weeksUntilTarget; week++) {
        grid += `\nWEEK ${week}:\n`;
        for (let day = 1; day <= 7; day++) {
            grid += `  • ${dayNames[day - 1]} (Week ${week}, Day ${day}): Need ${tasksPerDay}+ tasks totaling ~${dailyMinutes} min\n`;
        }
    }
    
    return grid;
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE PARSER & VALIDATOR
// ═══════════════════════════════════════════════════════════════

function parseAndValidateResponse(content: string, weeksUntilTarget?: number, dailyMinutes?: number): GeneratedPlan {
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

    // ═══════════════════════════════════════════════════════════════
    // DAILY COVERAGE VALIDATION
    // ═══════════════════════════════════════════════════════════════
    if (weeksUntilTarget && dailyMinutes) {
        // Collect all tasks and group by week+day
        const tasksByDay: Map<string, GeneratedTask[]> = new Map();
        
        for (const milestone of parsed.milestones) {
            for (const task of milestone.tasks) {
                const key = `W${task.weekNumber}D${task.dayOfWeek}`;
                if (!tasksByDay.has(key)) {
                    tasksByDay.set(key, []);
                }
                tasksByDay.get(key)!.push(task);
            }
        }

        // Check coverage for each day
        const warnings: string[] = [];
        let totalTasks = 0;
        
        for (let week = 1; week <= weeksUntilTarget; week++) {
            for (let day = 1; day <= 7; day++) {
                const key = `W${week}D${day}`;
                const dayTasks = tasksByDay.get(key) || [];
                totalTasks += dayTasks.length;
                
                if (dayTasks.length === 0) {
                    warnings.push(`Week ${week} Day ${day}: No tasks`);
                } else if (dayTasks.length === 1) {
                    // Single task must be at least 80% of daily time
                    const taskMinutes = dayTasks[0].estimatedMinutes;
                    const minRequired = Math.floor(dailyMinutes * 0.8);
                    if (taskMinutes < minRequired) {
                        warnings.push(`Week ${week} Day ${day}: Single task (${taskMinutes}min) below ${minRequired}min threshold`);
                    }
                }
                
                // Check total daily time
                const dailyTotal = dayTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
                const minDailyTime = Math.floor(dailyMinutes * 0.7); // Allow 70% minimum
                
                if (dayTasks.length > 0 && dailyTotal < minDailyTime) {
                    warnings.push(`Week ${week} Day ${day}: Total time ${dailyTotal}min < ${minDailyTime}min minimum`);
                }
            }
        }

        // Log warnings but don't fail (GPT output may vary)
        if (warnings.length > 0) {
            console.warn('[generate-plan] Daily coverage warnings:', warnings.slice(0, 5));
            console.warn(`[generate-plan] Total tasks generated: ${totalTasks}`);
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
