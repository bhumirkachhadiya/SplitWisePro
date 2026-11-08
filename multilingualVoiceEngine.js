/**
 * MULTILINGUAL VOICE & INDIC NLP ENGINE
 * 
 * Supports:
 * - English, Hindi (Devanagari + Hinglish), Gujarati (Gujarati script + Gujlish)
 * - Indic spoken number parsing (e.g., "panso" -> 500, "do hazaar" -> 2000, "dedh hazaar" -> 1500)
 * - Dynamic phonetic name transliteration across scripts (Latin, Devanagari, Gujarati)
 * - Natural spoken response synthesis (spoken_text generator) for seamless Text-To-Speech
 */

// Common name transliteration dictionary for rapid exact-match
const NAME_SCRIPT_MAP = {
    'charlie': { en: 'Charlie', hi: 'चार्ली', gu: 'ચાર્લી' },
    'alex': { en: 'Alex', hi: 'एलेक्स', gu: 'એલેક્સ' },
    'rahul': { en: 'Rahul', hi: 'राहुल', gu: 'રાહુલ' },
    'priya': { en: 'Priya', hi: 'प्रिया', gu: 'પ્રિયા' },
    'aman': { en: 'Aman', hi: 'अमन', gu: 'અમન' },
    'neha': { en: 'Neha', hi: 'नेहा', gu: 'નેહા' },
    'bhavik': { en: 'Bhavik', hi: 'भाविक', gu: 'ભાવિક' },
    'bhumir': { en: 'Bhumir', hi: 'भूमिर', gu: 'ભૂમિર' },
    'kachhadiya': { en: 'Kachhadiya', hi: 'काछड़िया', gu: 'કાછડિયા' },
    'rohit': { en: 'Rohit', hi: 'रोहित', gu: 'રોહિત' },
    'ankit': { en: 'Ankit', hi: 'अंकित', gu: 'અંકિત' },
    'sneha': { en: 'Sneha', hi: 'स्नेहा', gu: 'સ્નેહા' },
    'pooja': { en: 'Pooja', hi: 'पूजा', gu: 'પૂજા' },
    'raj': { en: 'Raj', hi: 'राज', gu: 'રાજ' },
    'meet': { en: 'Meet', hi: 'मीत', gu: 'મીત' },
    'yash': { en: 'Yash', hi: 'यश', gu: 'યશ' }
};

// Spoken Word to Number mapping for Indic and English speech
const NUMBER_WORDS = {
    // English
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'hundred': 100, 'one hundred': 100, 'two hundred': 200, 'three hundred': 300, 'four hundred': 400, 'five hundred': 500,
    'thousand': 1000, 'one thousand': 1000, 'two thousand': 2000, 'three thousand': 3000, 'four thousand': 4000, 'five thousand': 5000,
    'ten thousand': 10000, 'fifteen hundred': 1500, 'twenty five hundred': 2500,
    
    // Hindi (Latin + Devanagari)
    'ek': 1, 'do': 2, 'teen': 3, 'chaar': 4, 'char': 4, 'paanch': 5, 'panch': 5, 'chhe': 6, 'saat': 7, 'aath': 8, 'nau': 9, 'das': 10,
    'sau': 100, 'ek sau': 100, 'do sau': 200, 'teen sau': 300, 'chaar sau': 400, 'char sau': 400, 'paanch sau': 500,
    'hazaar': 1000, 'hazar': 1000, 'ek hazaar': 1000, 'ek hazar': 1000, 'dedh hazaar': 1500, 'dedh hazar': 1500,
    'do hazaar': 2000, 'do hazar': 2000, 'dhai hazaar': 2500, 'dhai hazar': 2500, 'teen hazaar': 3000, 'teen hazar': 3000,
    'char hazaar': 4000, 'paanch hazaar': 5000, 'das hazaar': 10000,
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
    'सौ': 100, 'एक सौ': 100, 'दो सौ': 200, 'तीन सौ': 300, 'चार सौ': 400, 'पांच सौ': 500,
    'हजार': 1000, 'हज़ार': 1000, 'एक हजार': 1000, 'डेढ़ हजार': 1500, 'दो हजार': 2000, 'ढाई हजार': 2500, 'तीन हजार': 3000, 'पांच हजार': 5000,

    // Gujarati (Latin + Gujarati script)
    'ek': 1, 'be': 2, 'tran': 3, 'char': 4, 'paanch': 5, 'panch': 5, 'chha': 6, 'saat': 7, 'aath': 8, 'nav': 9, 'das': 10,
    'so': 100, 'ek so': 100, 'baso': 200, 'tran so': 300, 'char so': 400, 'panso': 500, 'pancho': 500, 'chhaso': 600, 'saat so': 700,
    'hajar': 1000, 'ek hajar': 1000, 'dedh hajar': 1500, 'be hajar': 2000, 'dhadhi hajar': 2500, 'dhai hajar': 2500, 'tran hajar': 3000,
    'char hajar': 4000, 'paanch hajar': 5000, 'das hajar': 10000,
    'એક': 1, 'બે': 2, 'ત્રણ': 3, 'ચાર': 4, 'પાંચ': 5, 'છ': 6, 'સાત': 7, 'આઠ': 8, 'નવ': 9, 'દસ': 10,
    'સો': 100, 'એક સો': 100, 'બસો': 200, 'ત્રણ સો': 300, 'ચાર સો': 400, 'પાંચસો': 500, 'છસો': 600,
    'હજાર': 1000, 'એક હજાર': 1000, 'દોઢ હજાર': 1500, 'બે હજાર': 2000, 'અઢી હજાર': 2500, 'ત્રણ હજાર': 3000, 'પાંચ હજાર': 5000
};

/**
 * Detect language with Hinglish and Gujlish awareness
 */
function detectLanguage(text, requestedLang = 'en') {
    if (!text || typeof text !== 'string') return requestedLang;
    const lower = text.toLowerCase();

    // 1. Native script detection (high confidence)
    if (/[\u0A80-\u0AFF]/.test(text)) return 'gu';
    if (/[\u0900-\u097F]/.test(text)) return 'hi';

    // 2. Count distinct Hindi vs Gujarati keyword hits
    const hiTokens = [
        /\b(kisko|kisse|kitna|kitne|kitni|dena|dene|lena|lene|batao|dikhaye|mera|meri|mere|humara|kaun|kiska|bhai|kar\s+do|baanto|banto|batwara|jodo|nikalo|hatao|sabse|dusri|alawa|chhodkar|namaste|shukriya|dhanyawad|badhiya|theek\s+hai|paise|paisa|rupay|rupya|rupiye|chuka|chukao|udhar|kharcha|kharch)\b/gi,
        /\b(karo|kar|kare|kaise|kya|kyun|kab|kahan|hai|hain)\b/gi
    ];
    const guTokens = [
        /\b(kharcho|ketla|leva|aapva|maro|mari|maru|mane|tame|tamaro|tamari|tamaru|chhe|karyo|shunya|vachche|vacche|vahecho|badha|kone|chuko|chuki|rupia|rokda|panso|baso|hajar|sauthi|bijee|trippo|umero|kadho|shu|kem|aavjo|barobar|saras|aabhar|sarve|sarvaalo)\b/gi
    ];

    let hiScore = 0;
    for (const pat of hiTokens) {
        const m = lower.match(pat);
        if (m) hiScore += m.length;
    }

    let guScore = 0;
    for (const pat of guTokens) {
        const m = lower.match(pat);
        if (m) guScore += m.length;
    }

    if (hiScore > 0 && hiScore >= guScore) return 'hi';
    if (guScore > 0 && guScore > hiScore) return 'gu';

    if (requestedLang === 'hi' || requestedLang === 'gu') return requestedLang;
    return 'en';
}

/**
 * Extract numbers from spoken queries, supporting Indic words (e.g. "panso" -> 500)
 */
function extractSpokenAmount(query) {
    if (!query || typeof query !== 'string') return null;
    const cleanQ = query.toLowerCase().trim();

    // 1. Direct digits (e.g. ₹500, 1500, 2,500.50)
    const digitMatch = cleanQ.match(/(?:₹|rs\.?|inr|\$|€|£)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
    if (digitMatch) {
        const val = parseFloat(digitMatch[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) return val;
    }

    // 2. Indic words to numbers (longest match first)
    const sortedWords = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length);
    for (const phrase of sortedWords) {
        const regex = new RegExp(`\\b${phrase}\\b`, 'i');
        if (regex.test(cleanQ)) {
            return NUMBER_WORDS[phrase];
        }
    }

    return null;
}

/**
 * Matches a user in the database across English, Hindi, and Gujarati scripts
 */
function matchUserAcrossScripts(text, allUsers) {
    if (!text || !Array.isArray(allUsers) || allUsers.length === 0) return null;
    const lower = text.toLowerCase();

    for (const u of allUsers) {
        const fullName = u.name.trim().toLowerCase();
        const firstName = fullName.split(' ')[0];

        // 1. Direct name match
        if (lower.includes(fullName) || lower.includes(firstName)) return u;

        // 2. User code match (e.g. CHARLIE-9821)
        if (u.user_code && lower.includes(u.user_code.toLowerCase())) return u;

        // 3. Known transliteration match
        const cleanFirst = firstName.replace(/[^a-z0-9]/g, '');
        if (NAME_SCRIPT_MAP[cleanFirst]) {
            const aliases = Object.values(NAME_SCRIPT_MAP[cleanFirst]);
            for (const alias of aliases) {
                if (lower.includes(alias.toLowerCase())) return u;
            }
        }
    }

    return null;
}

/**
 * Converts rich markdown reply into clean, natural voice text for Text-to-Speech (TTS)
 */
function generateSpokenText(replyMarkdown, lang = 'en') {
    if (!replyMarkdown || typeof replyMarkdown !== 'string') return '';

    let text = replyMarkdown;

    // 1. Remove markdown links, code blocks, images
    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/`([^`]+)`/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

    // 2. Convert currency symbols to natural spoken words per language
    if (lang === 'hi') {
        text = text.replace(/₹\s*(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1 रुपये');
        text = text.replace(/\$\s*(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1 डॉलर');
    } else if (lang === 'gu') {
        text = text.replace(/₹\s*(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1 રૂપિયા');
        text = text.replace(/\$\s*(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1 ડૉલર');
    } else {
        text = text.replace(/₹\s*(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1 rupees');
        text = text.replace(/\$\s*(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1 dollars');
        text = text.replace(/€\s*(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1 euros');
    }

    // 3. Strip bullet characters, asterisks, hashtags, and emojis
    text = text.replace(/[*#_~•]/g, ' ');
    text = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

    // 4. Clean formatting and excess whitespace
    text = text.replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();

    // 5. Shorten excessively long bulleted lists for audio clarity
    const sentences = text.split(/(?<=[.?!])\s+/);
    if (sentences.length > 5) {
        // Keep first 3 sentences and append polite summary
        const summaryTail = lang === 'hi' 
            ? 'पूरी जानकारी आपकी स्क्रीन पर उपलब्ध है।'
            : (lang === 'gu' ? 'સંપૂર્ણ વિગતો તમારી સ્ક્રીન પર દર્શાવેલ છે.' : 'Full details are shown on your screen.');
        return `${sentences.slice(0, 3).join(' ')} ${summaryTail}`.trim();
    }

    return text;
}

module.exports = {
    detectLanguage,
    extractSpokenAmount,
    matchUserAcrossScripts,
    generateSpokenText,
    NAME_SCRIPT_MAP,
    NUMBER_WORDS
};
