// api/utils/contentFilter.ts
// Content filtering to detect and block harmful goal requests

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface FilterResult {
    blocked: boolean;
    category?: HarmfulCategory;
    reason?: string;
    matchedPattern?: string;
}

export type HarmfulCategory = 
    | 'violence'
    | 'terrorism'
    | 'illegal_drugs'
    | 'weapons'
    | 'self_harm'
    | 'exploitation'
    | 'fraud'
    | 'hacking'
    | 'harassment'
    | 'other';

// ═══════════════════════════════════════════════════════════════
// HARMFUL CONTENT PATTERNS
// ═══════════════════════════════════════════════════════════════

interface HarmfulPattern {
    pattern: RegExp;
    category: HarmfulCategory;
    severity: 'high' | 'medium';
}

// High-severity patterns - always block
const HARMFUL_PATTERNS: HarmfulPattern[] = [
    // Violence & Murder
    { pattern: /\b(kill|murder|assassinate|execute)\s+(someone|people|person|him|her|them|my|a)\b/i, category: 'violence', severity: 'high' },
    { pattern: /\bhow\s+to\s+(kill|murder|assassinate)\b/i, category: 'violence', severity: 'high' },
    { pattern: /\b(plan|planning)\s+(a\s+)?(murder|killing|assassination)\b/i, category: 'violence', severity: 'high' },
    { pattern: /\b(hurt|harm|injure|attack)\s+(someone|people|person|him|her|them)\s+(badly|seriously|physically)\b/i, category: 'violence', severity: 'high' },
    
    // Poison
    { pattern: /\b(poison|poisoning)\s+(someone|people|person|him|her|them|my|food|water)\b/i, category: 'violence', severity: 'high' },
    { pattern: /\bhow\s+to\s+(poison|make\s+poison)\b/i, category: 'violence', severity: 'high' },
    { pattern: /\bundetectable\s+(poison|toxin)\b/i, category: 'violence', severity: 'high' },
    
    // Terrorism & Explosives
    { pattern: /\b(terrorist|terrorism|terror\s+attack)\b/i, category: 'terrorism', severity: 'high' },
    { pattern: /\b(bomb|explosive|detonate|ied|improvised\s+explosive)\b/i, category: 'terrorism', severity: 'high' },
    { pattern: /\b(mass\s+shooting|mass\s+attack|mass\s+casualty)\b/i, category: 'terrorism', severity: 'high' },
    { pattern: /\b(attack|target)\s+(school|church|mosque|temple|synagogue|crowd|public)\b/i, category: 'terrorism', severity: 'high' },
    
    // Weapons
    { pattern: /\b(make|build|create|manufacture)\s+(a\s+)?(gun|firearm|weapon)\s*(illegally)?\b/i, category: 'weapons', severity: 'high' },
    { pattern: /\billegal\s+(gun|firearm|weapon)\b/i, category: 'weapons', severity: 'high' },
    { pattern: /\b(3d\s+print|ghost)\s+gun\b/i, category: 'weapons', severity: 'high' },
    
    // Illegal Drugs
    { pattern: /\b(make|cook|manufacture|produce|synthesize)\s+(meth|methamphetamine|cocaine|heroin|fentanyl|mdma|lsd)\b/i, category: 'illegal_drugs', severity: 'high' },
    { pattern: /\bdrug\s+(dealing|trafficking|distribution)\b/i, category: 'illegal_drugs', severity: 'high' },
    { pattern: /\b(start|run)\s+(a\s+)?drug\s+(business|operation|ring)\b/i, category: 'illegal_drugs', severity: 'high' },
    
    // Self-harm & Suicide
    { pattern: /\b(how\s+to\s+)?(kill|end)\s+(myself|my\s+life)\b/i, category: 'self_harm', severity: 'high' },
    { pattern: /\bsuicide\s+(method|plan|ways)\b/i, category: 'self_harm', severity: 'high' },
    { pattern: /\bpainless\s+(way\s+to\s+)?(die|death|suicide)\b/i, category: 'self_harm', severity: 'high' },
    
    // Exploitation
    { pattern: /\b(child|minor)\s+(porn|pornography|exploitation|abuse|trafficking)\b/i, category: 'exploitation', severity: 'high' },
    { pattern: /\bhuman\s+trafficking\b/i, category: 'exploitation', severity: 'high' },
    { pattern: /\b(groom|grooming)\s+(children|minors|kids)\b/i, category: 'exploitation', severity: 'high' },
    
    // Fraud & Theft
    { pattern: /\b(scam|defraud|steal\s+from)\s+(people|elderly|seniors|victims)\b/i, category: 'fraud', severity: 'high' },
    { pattern: /\b(identity|credit\s+card)\s+theft\b/i, category: 'fraud', severity: 'high' },
    { pattern: /\bponzi\s+scheme\b/i, category: 'fraud', severity: 'high' },
    { pattern: /\bmoney\s+laundering\b/i, category: 'fraud', severity: 'high' },
    
    // Hacking & Cybercrime
    { pattern: /\bhack\s+(into|someone|bank|government|company)\b/i, category: 'hacking', severity: 'high' },
    { pattern: /\b(steal|breach)\s+(data|passwords|credentials|accounts)\b/i, category: 'hacking', severity: 'high' },
    { pattern: /\b(ransomware|malware)\s+(attack|create|deploy)\b/i, category: 'hacking', severity: 'high' },
    
    // Harassment & Stalking
    { pattern: /\b(stalk|stalking)\s+(someone|person|ex|him|her)\b/i, category: 'harassment', severity: 'high' },
    { pattern: /\brevenge\s+porn\b/i, category: 'harassment', severity: 'high' },
    { pattern: /\b(harass|threaten|intimidate)\s+(someone|person|ex|him|her)\b/i, category: 'harassment', severity: 'medium' },
];

// ═══════════════════════════════════════════════════════════════
// USER-FRIENDLY MESSAGES
// ═══════════════════════════════════════════════════════════════

const BLOCK_MESSAGES: Record<HarmfulCategory, string> = {
    violence: "DreamPath can't help with goals that involve harming others. Please choose a positive goal that improves your life.",
    terrorism: "This goal involves harmful activities that could endanger others. DreamPath is designed to help you achieve positive life goals.",
    illegal_drugs: "DreamPath can't assist with illegal drug-related activities. Consider focusing on health and wellness goals instead.",
    weapons: "We can't help with goals involving illegal weapons. Try setting goals around legal hobbies or skills.",
    self_harm: "We care about your wellbeing. If you're struggling, please reach out to a crisis helpline. DreamPath is here to help you build a better future.",
    exploitation: "This type of goal is not something DreamPath can assist with. Please choose a goal that respects others' rights and dignity.",
    fraud: "DreamPath can't help with fraudulent or deceptive activities. Consider setting goals around building legitimate income and skills.",
    hacking: "We can't assist with unauthorized access or cybercrime. Consider ethical cybersecurity or IT career goals instead.",
    harassment: "DreamPath promotes positive relationships. We can't help with goals that harm or harass others.",
    other: "This goal doesn't align with DreamPath's community guidelines. Please choose a different goal."
};

// ═══════════════════════════════════════════════════════════════
// MAIN FILTER FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Check if content contains harmful patterns
 * @param text - The text to check (goal title, description, etc.)
 * @returns FilterResult with blocked status and reason
 */
export function checkContent(text: string): FilterResult {
    if (!text || typeof text !== 'string') {
        return { blocked: false };
    }

    // Normalize text for checking
    const normalizedText = text.toLowerCase().trim();
    
    // Check against all harmful patterns
    for (const { pattern, category, severity } of HARMFUL_PATTERNS) {
        if (pattern.test(normalizedText)) {
            console.log(`[ContentFilter] Blocked content - Category: ${category}, Pattern: ${pattern}`);
            return {
                blocked: true,
                category,
                reason: BLOCK_MESSAGES[category],
                matchedPattern: pattern.toString()
            };
        }
    }

    return { blocked: false };
}

/**
 * Check multiple text fields at once
 * @param texts - Array of texts to check
 * @returns FilterResult - blocked if ANY text matches
 */
export function checkMultipleContent(texts: (string | undefined)[]): FilterResult {
    for (const text of texts) {
        if (text) {
            const result = checkContent(text);
            if (result.blocked) {
                return result;
            }
        }
    }
    return { blocked: false };
}

/**
 * Get a generic safe message for API responses
 */
export function getBlockedResponse(filterResult: FilterResult) {
    return {
        success: false,
        blocked: true,
        category: filterResult.category,
        message: filterResult.reason || BLOCK_MESSAGES.other
    };
}
