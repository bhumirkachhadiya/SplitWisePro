/**
 * INTELLIGENT VOICE CONVERSATION & REAL ACTION EXECUTION ENGINE
 * 
 * Implements:
 * - Phase 3: SplitWise Knowledge & System Context
 * - Phase 4: Multilingual Voice Engine (English, Hindi, Gujarati, Hinglish, Gujlish)
 * - Phase 5: Multi-Turn Slot Filling, Context Continuity, Entity Disambiguation
 * - Phase 6: Real Authorized Database Execution with Strict Financial Confirmations
 */

const { detectLanguage, extractSpokenAmount, matchUserAcrossScripts, generateSpokenText } = require('./multilingualVoiceEngine');
const { buildUserSystemContext } = require('./splitwiseKnowledgeService');

// In-memory conversation session store with 30-minute TTL
const conversationSessions = new Map();

function getOrCreateSession(conversationId, userId) {
    const key = conversationId || `conv_${userId}_${Date.now()}`;
    let session = conversationSessions.get(key);
    if (!session || session.userId !== userId) {
        session = {
            id: key,
            userId,
            history: [],
            context: {
                turns: [],
                lastIntent: null,
                lastAction: null,
                lastGroup: null,
                lastPeer: null,
                lastAmount: null,
                pendingTool: null,
                slotFilling: null
            },
            updatedAt: Date.now()
        };
        conversationSessions.set(key, session);
    }
    session.updatedAt = Date.now();
    return session;
}

// Clean up expired sessions periodically (older than 30 mins)
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of conversationSessions.entries()) {
        if (now - session.updatedAt > 30 * 60 * 1000) {
            conversationSessions.delete(key);
        }
    }
}, 5 * 60 * 1000);

/**
 * Main Voice Assistant Query Processing Pipeline
 */
async function processVoiceAssistantQuery({ query, language = 'en', currentUserId, conversationId, pool, splitEngine }) {
    if (!currentUserId || isNaN(currentUserId) || currentUserId <= 0) {
        return {
            status: 401,
            response: { error: 'Authentication required. Please sign in to use the AI Assistant.' }
        };
    }

    const isMasterAdmin = (Number(currentUserId) === 1);
    const systemContext = await buildUserSystemContext(pool, currentUserId, isMasterAdmin);
    if (!systemContext) {
        return {
            status: 401,
            response: { error: 'Invalid user session. Please sign in again.' }
        };
    }

    const { user: currentUser, groups: allGroups, recentExpenses: allExpenses, knownPeers: allUsers, masterAdminTelemetry } = systemContext;
    const userFirstName = (currentUser.name || 'Friend').trim().split(' ')[0];
    const userCurrency = (currentUser.default_currency || 'INR').toUpperCase();
    const curSymbol = userCurrency === 'USD' ? '$' : (userCurrency === 'EUR' ? '€' : (userCurrency === 'GBP' ? '£' : '₹'));

    if (!query || typeof query !== 'string' || query.trim() === '') {
        return {
            status: 400,
            response: { error: 'Valid query text is required' }
        };
    }

    // Clean & Sanitize
    const safeQuery = query.replace(/<[^>]*>?/gm, '').replace(/[\x00-\x1F\x7F]/g, '').trim().substring(0, 500);
    const lowerQ = safeQuery.toLowerCase();

    // Session retrieval
    const session = getOrCreateSession(conversationId, currentUserId);
    const sessionCtx = session.context;

    // Detect language with Hinglish and Gujlish awareness
    const detectedLang = detectLanguage(safeQuery, language);

    const recordTurn = (reply, intent, action, view = null, spokenOverride = null) => {
        const spoken_text = spokenOverride || generateSpokenText(reply, detectedLang);
        session.history.push({ role: 'user', text: safeQuery, timestamp: Date.now() });
        session.history.push({ role: 'assistant', text: reply, spoken_text, intent, timestamp: Date.now() });
        sessionCtx.turns = sessionCtx.turns || [];
        sessionCtx.turns.push({ user: safeQuery, assistant: reply, intent, action });
        sessionCtx.lastIntent = intent;
        if (action) sessionCtx.lastAction = action;
        return spoken_text;
    };

    // Helper: Dynamic peer finder
    const findPeer = (text) => matchUserAcrossScripts(text, allUsers);

    // =========================================================================
    // 0. CANCELLATION / ABORT FLOW
    // =========================================================================
    if (/^(cancel|cancel\s+that|stop|abort|forget\s+it|don'?t|no|nahi|rad\s+karo|રદ\s+કરો|रद्द\s+करो)$/i.test(lowerQ.trim())) {
        if (sessionCtx.pendingTool || sessionCtx.slotFilling) {
            sessionCtx.pendingTool = null;
            sessionCtx.slotFilling = null;
            const reply = detectedLang === 'gu'
                ? 'વિનંતી રદ કરવામાં આવી છે. હું તમને આગળ કેવી રીતે મદદ કરી શકું?'
                : detectedLang === 'hi'
                ? 'अनुरोध रद्द कर दिया गया है। मैं आपकी आगे कैसे सहायता कर सकता हूँ?'
                : 'Operation cancelled. How else can I assist you with your ledger?';
            const spoken_text = recordTurn(reply, 'OPERATION_CANCELLED', 'NONE');
            return {
                status: 200,
                response: { reply, spoken_text, action: 'NONE', detectedLang, conversation_id: session.id }
            };
        }
    }

    // =========================================================================
    // 1. CONFIRMATION & EXECUTION OF PENDING TOOL
    // =========================================================================
    if (sessionCtx.pendingTool) {
        const pt = sessionCtx.pendingTool;
        const isAffirmative = /^(yes|confirm|proceed|do\s+it|sure|ok|okay|haan|ha|haa|હા|हाँ|કરવા\s+દો|करो|कर\s+दो|કરી\s+દો)[.!,? ]*$/i.test(lowerQ.trim());

        if (isAffirmative) {
            const actionToExec = pt.action;
            const ptParams = pt.params || {};

            if (actionToExec === 'ADD_EXPENSE') {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    // Verify group existence & lock status
                    const grpV = await client.query('SELECT is_locked, name FROM groups WHERE id = $1', [ptParams.groupId]);
                    if (grpV.rows.length === 0) throw new Error('Target circle not found.');
                    if (grpV.rows[0].is_locked) throw new Error('Circle is locked. No new expenses can be added.');

                    // Authorization check
                    const roleV = await client.query(
                        'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
                        [ptParams.groupId, currentUserId]
                    );
                    if (!['admin', 'editor'].includes(roleV.rows[0]?.role)) {
                        throw new Error('Only circle Admins or Editors can record expenses in this circle.');
                    }

                    // Normalize splits
                    const normExec = splitEngine.normalizeSplits({
                        totalAmount: ptParams.amount,
                        splitType: ptParams.splitType || 'equal',
                        splits: ptParams.splits || [],
                        currency: ptParams.currency || userCurrency
                    });
                    if (normExec.error) throw new Error(normExec.error);
                    ptParams.splits = normExec.splits;

                    const expRes = await client.query(`
                        INSERT INTO expenses (
                            group_id, paid_by, description, amount, currency, category, split_type,
                            original_amount, exchange_rate, converted_amount, rate_provider, rate_timestamp, expense_date
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1.0, $9, 'identity', NOW(), CURRENT_DATE)
                        RETURNING id
                    `, [ptParams.groupId, ptParams.paidBy || currentUserId, ptParams.description || 'Expense', ptParams.amount, ptParams.currency || userCurrency, ptParams.category || 'General', ptParams.splitType || 'equal', ptParams.amount, ptParams.amount]);

                    const expenseId = expRes.rows[0].id;
                    for (const s of (ptParams.splits || [])) {
                        await client.query(`
                            INSERT INTO expense_splits
                                (expense_id, user_id, amount, base_amount, split_percentage, shares, is_settled, settled_amount, settled_amount_base, is_locked)
                            VALUES ($1, $2, $3, $3, $4, 1, false, 0, 0, $5)
                        `, [expenseId, s.user_id, s.amount, ((s.amount / ptParams.amount) * 100).toFixed(2), s.is_locked === true]);
                    }

                    await client.query(`
                        INSERT INTO activity_logs (user_id, group_id, activity_type, message)
                        VALUES ($1, $2, 'EXPENSE_ADDED', $3)
                    `, [currentUserId, ptParams.groupId, `${currentUser.name} recorded expense of ${curSymbol}${ptParams.amount} for "${ptParams.description}" via Voice Assistant`]);

                    await client.query(`
                        INSERT INTO ai_agent_actions (user_id, command_text, action_type, action_payload, status, execution_result)
                        VALUES ($1, $2, 'ADD_EXPENSE', $3, 'EXECUTED', $4)
                    `, [currentUserId, safeQuery.slice(0, 500), JSON.stringify(ptParams), JSON.stringify({ expenseId })]);

                    await client.query('COMMIT');
                    sessionCtx.pendingTool = null;

                    const reply = detectedLang === 'hi'
                        ? `खर्चा सफलतापुर्वक जोड़ दिया गया है! ${curSymbol}${ptParams.amount} का खर्चा "${ptParams.description}" के लिए "${grpV.rows[0].name}" में दर्ज हो गया है।`
                        : detectedLang === 'gu'
                        ? `ખર્ચ સફળતાપૂર્વક નોંધાઈ ગયો છે! ${curSymbol}${ptParams.amount} નો ખર્ચ "${ptParams.description}" માટે "${grpV.rows[0].name}" માં ઉમેરાઈ ગયો છે.`
                        : `Expense of ${curSymbol}${ptParams.amount.toLocaleString('en-IN')} for "${ptParams.description}" was added successfully in ${grpV.rows[0].name}!`;

                    const spoken_text = recordTurn(reply, 'EXPENSE_CREATED', 'NONE');
                    return {
                        status: 200,
                        response: { reply, spoken_text, action: 'NONE', result: { expenseId }, detectedLang, conversation_id: session.id }
                    };
                } catch(err) {
                    await client.query('ROLLBACK');
                    const errReply = `Failed to record expense: ${err.message}`;
                    const spoken_text = recordTurn(errReply, 'EXPENSE_CREATION_FAILED', 'NONE');
                    return {
                        status: 200,
                        response: { reply: errReply, spoken_text, action: 'NONE', detectedLang, conversation_id: session.id }
                    };
                } finally {
                    client.release();
                }
            }

            if (actionToExec === 'RECORD_MANUAL_SETTLEMENT') {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    const settRes = await client.query(`
                        INSERT INTO settlements (payer_id, receiver_id, amount, payment_method, notes)
                        VALUES ($1, $2, $3, $4, $5)
                        RETURNING id
                    `, [currentUserId, ptParams.receiverId, ptParams.amount, ptParams.paymentMethod || 'cash', ptParams.notes || 'Recorded via AI Voice Assistant']);

                    const settlementId = settRes.rows[0].id;

                    await client.query(`
                        INSERT INTO activity_logs (user_id, activity_type, message)
                        VALUES ($1, 'SETTLEMENT_RECORDED', $2)
                    `, [currentUserId, `${currentUser.name} recorded settlement of ${curSymbol}${ptParams.amount} with ${ptParams.peerName} via Voice Assistant`]);

                    await client.query(`
                        INSERT INTO ai_agent_actions (user_id, command_text, action_type, action_payload, status, execution_result)
                        VALUES ($1, $2, 'RECORD_MANUAL_SETTLEMENT', $3, 'EXECUTED', $4)
                    `, [currentUserId, safeQuery.slice(0, 500), JSON.stringify(ptParams), JSON.stringify({ settlementId })]);

                    await client.query('COMMIT');
                    sessionCtx.pendingTool = null;

                    const reply = detectedLang === 'hi'
                        ? `${ptParams.peerName} के साथ ${curSymbol}${ptParams.amount} का भुगतान सफलतापूर्वक दर्ज कर लिया गया है।`
                        : detectedLang === 'gu'
                        ? `${ptParams.peerName} સાથે ${curSymbol}${ptParams.amount} ની ચૂકવણી સફળતાપૂર્વક નોંધાઈ ગઈ છે.`
                        : `Settlement of ${curSymbol}${ptParams.amount.toLocaleString('en-IN')} with ${ptParams.peerName} has been recorded successfully!`;

                    const spoken_text = recordTurn(reply, 'SETTLEMENT_RECORDED', 'NONE');
                    return {
                        status: 200,
                        response: { reply, spoken_text, action: 'NONE', result: { settlementId }, detectedLang, conversation_id: session.id }
                    };
                } catch(err) {
                    await client.query('ROLLBACK');
                    const errReply = `Failed to record settlement: ${err.message}`;
                    const spoken_text = recordTurn(errReply, 'SETTLEMENT_FAILED', 'NONE');
                    return {
                        status: 200,
                        response: { reply: errReply, spoken_text, action: 'NONE', detectedLang, conversation_id: session.id }
                    };
                } finally {
                    client.release();
                }
            }
        }
    }

    // -----------------------------------------------------------------
    // PRIVACY & SECURITY GUARD (Never share other users' private credentials)
    // -----------------------------------------------------------------
    if (/(password|passcode|credential|secret|token|hash|पिन|पासवर्ड|ગુપ્ત|પાસવર્ડ)/i.test(lowerQ)) {
        let reply = "Sorry, for security and privacy reasons, personal credentials and private account details of other users cannot be shared.";
        if (detectedLang === 'hi') {
            reply = "क्षमा करें, सुरक्षा और गोपनीयता कारणों से अन्य उपयोगकर्ताओं की निजी जानकारी या क्रेडेंशियल्स साझा नहीं की जा सकती हैं।";
        } else if (detectedLang === 'gu') {
            reply = "દિલગીર છીએ, સુરક્ષા અને ગોપનીયતાના કારણોસર અન્ય વપરાશકર્તાઓની અંગત માહિતી શેર કરી શકાતી નથી.";
        }
        const spoken_text = recordTurn(reply, 'PRIVACY_GUARD', 'NONE');
        return {
            status: 200,
            response: { reply, spoken_text, action: 'NONE', detectedLang, conversation_id: session.id }
        };
    }

    // =========================================================================
    // 2. MASTER ADMIN INTELLIGENCE & TELEMETRY (Charlie / ID 1)
    // =========================================================================
    const isTelemetryQuery = /(telemetry|system\s+health|server\s+status|how\s+many\s+users|total\s+users|system\s+audit|error\s+logs|platform\s+stats|स्थिति|सिस्टम|यूज़र्स|कुल\s+यूज़र|સ્ટેટસ|યૂઝર્સ|કુલ\s+વપરાશકર્તાઓ|પ્લેટફોર્મ|સિસ્ટમ|સ્વાસ્થ્ય|ટેલિમેટ્રી)/i.test(lowerQ);

    if (isMasterAdmin && isTelemetryQuery) {
        const tel = masterAdminTelemetry;
        let reply = '';
        if (detectedLang === 'hi') {
            reply = `**SplitEase प्लेटफ़ॉर्म मास्टर टेलीमेट्री:**\n\n` +
                `• 👑 **मास्टर एडमिन**: ${currentUser.name} (${currentUser.email})\n` +
                `• 👥 **कुल पंजीकृत यूज़र्स**: ${tel.totalUsers}\n` +
                `• ⭕ **सक्रिय सर्कल्स (ग्रुप्स)**: ${tel.totalGroups}\n` +
                `• 💳 **कुल दर्ज खर्चे**: ${tel.totalExpensesCount} (कुल वॉल्यूम ${curSymbol}${tel.totalExpenseVolume.toLocaleString('en-IN', { minimumFractionDigits: 2 })})\n` +
                `• 🛡️ **सिस्टम स्वास्थ्य**: ${tel.systemHealth} (${tel.unresolvedErrors} अनसुलझी त्रुटियां)\n` +
                `• 🗄️ **डेटाबेस प्रोवाइडर**: ${tel.databaseProvider}`;
        } else if (detectedLang === 'gu') {
            reply = `**SplitEase પ્લેટફોર્મ માસ્ટર ટેલિમેટ્રી:**\n\n` +
                `• 👑 **માસ્ટર એડમિન**: ${currentUser.name} (${currentUser.email})\n` +
                `• 👥 **કુલ નોંધાયેલ યૂઝર્સ**: ${tel.totalUsers}\n` +
                `• ⭕ **સક્રિય સર્કલ્સ (ગ્રૂપ્સ)**: ${tel.totalGroups}\n` +
                `• 💳 **કુલ નોંધાયેલ ખર્ચા**: ${tel.totalExpensesCount} (કુલ વોલ્યુમ ${curSymbol}${tel.totalExpenseVolume.toLocaleString('en-IN', { minimumFractionDigits: 2 })})\n` +
                `• 🛡️ **સિસ્ટમ સ્થિતિ**: ${tel.systemHealth} (${tel.unresolvedErrors} વણઉકેલાયેલ ભૂલો)\n` +
                `• 🗄️ **ડેટાબેઝ પ્રોવાઇડર**: ${tel.databaseProvider}`;
        } else {
            reply = `**SplitEase Platform Master Telemetry:**\n\n` +
                `• 👑 **Master User**: ${currentUser.name} (${currentUser.email})\n` +
                `• 👥 **Total Registered Users**: ${tel.totalUsers}\n` +
                `• ⭕ **Active Circles**: ${tel.totalGroups}\n` +
                `• 💳 **Total Expenses Recorded**: ${tel.totalExpensesCount} (${curSymbol}${tel.totalExpenseVolume.toLocaleString('en-IN', { minimumFractionDigits: 2 })} volume)\n` +
                `• 🛡️ **System Health**: ${tel.systemHealth} (${tel.unresolvedErrors} unresolved errors)\n` +
                `• 🗄️ **Database Provider**: ${tel.databaseProvider}`;
        }

        const spoken_text = recordTurn(reply, 'MASTER_TELEMETRY', 'NONE');
        return {
            status: 200,
            response: { reply, spoken_text, action: 'NONE', detectedLang, conversation_id: session.id }
        };
    }

    // =========================================================================
    // 3. MULTI-TURN SLOT-FILLING CONTINUATION
    // =========================================================================
    if (sessionCtx.slotFilling) {
        const sf = sessionCtx.slotFilling;

        if (sf.action === 'ADD_EXPENSE') {
            const parsedAmt = extractSpokenAmount(safeQuery);
            if (parsedAmt) {
                sf.slots.amount = parsedAmt;
                const descClean = safeQuery.replace(/(?:₹|rs\.?|inr|\$|€|£)?\s*\d+(?:,\d+)*(?:\.\d+)?/gi, '').replace(/\b(for|in|on|to|add|kar|karo|do)\b/gi, '').trim();
                if (descClean.length >= 2) sf.slots.description = descClean;

                // Check group
                let matchedGroup = allGroups.find(g => lowerQ.includes(g.name.toLowerCase()));
                if (!matchedGroup && allGroups.length > 0) matchedGroup = allGroups[0];

                if (matchedGroup) {
                    sessionCtx.slotFilling = null;
                    const finalDesc = sf.slots.description || 'General Expense';
                    const toolCall = {
                        action: 'ADD_EXPENSE',
                        params: {
                            amount: sf.slots.amount,
                            description: finalDesc,
                            groupId: matchedGroup.id,
                            groupName: matchedGroup.name,
                            splitType: 'equal'
                        },
                        summary: `Add ${curSymbol}${sf.slots.amount} for "${finalDesc}" in ${matchedGroup.name}`
                    };
                    sessionCtx.pendingTool = toolCall;

                    const reply = detectedLang === 'hi'
                        ? `क्या मैं "${matchedGroup.name}" में "${finalDesc}" के लिए ${curSymbol}${sf.slots.amount} का खर्चा जोड़ दूँ? पुष्टि करने के लिए 'हाँ' कहें।`
                        : detectedLang === 'gu'
                        ? `શું હું "${matchedGroup.name}" માં "${finalDesc}" માટે ${curSymbol}${sf.slots.amount} નો ખર્ચ ઉમેરી દઉં? ખાતરી માટે 'હા' કહો.`
                        : `Should I record an expense of ${curSymbol}${sf.slots.amount} for "${finalDesc}" in ${matchedGroup.name} split equally? Please confirm to proceed.`;

                    const spoken_text = recordTurn(reply, 'TOOL_PROPOSAL', 'CONFIRM_TOOL');
                    return {
                        status: 200,
                        response: { reply, spoken_text, action: 'CONFIRM_TOOL', toolCall, requiresConfirmation: true, detectedLang, conversation_id: session.id }
                    };
                }
            }
        }
    }

    // =========================================================================
    // 4. INCOMPLETE "ADD EXPENSE" TRIGGER -> INITIATES SLOT FILLING
    // =========================================================================
    const isIncompleteAddExpense = /^(?:add|record|log|insert|naya|nava|navo)\s+(?:an?\s+)?(?:expense|kharcha|kharcho)\s*$/i.test(lowerQ) ||
        /^(\s*नया\s+खर्चा\s*|\s*खर्च\s+जोड़ें\s*|\s*खर्चा\s+जोड़ो\s*|\s*નવો\s+ખર્ચ\s*|\s*નવો\s+ખર્ચો\s*|\s*ખર્ચ\s+ઉમેરો\s*)$/u.test(safeQuery.trim());

    if (isIncompleteAddExpense) {
        sessionCtx.slotFilling = { action: 'ADD_EXPENSE', slots: {} };
        const reply = detectedLang === 'hi'
            ? "ज़रूर! खर्चा कितना था और किस काम के लिए था? (उदा. 'गोवा ट्रिप में डिनर के लिए ₹1,500')"
            : detectedLang === 'gu'
            ? "ચોક્કસ! ખર્ચ કેટલો હતો અને શેના માટે હતો? (દા.ત. 'ગોવા ટ્રીપમાં ડિનર માટે ₹1,500')"
            : "Sure! How much was the expense, and what was it for? (e.g. '₹1,500 for dinner in Goa Trip')";

        const spoken_text = recordTurn(reply, 'SLOT_FILLING_EXPENSE', 'NONE');
        return {
            status: 200,
            response: { reply, spoken_text, action: 'NONE', detectedLang, conversation_id: session.id }
        };
    }

    // Returning null allows server.js standard parsing to take over if no specialized slot-filling triggered
    return null;
}

module.exports = {
    processVoiceAssistantQuery,
    getOrCreateSession
};
