/**
 * ==============================================================================
 * SPLITWISE SMART CUSTOM SPLIT ENGINE (LOCK & AUTO-DISTRIBUTE)
 * ==============================================================================
 * Financial calculation engine supporting:
 *  - Deterministic currency rounding (cents/paise/yen precision, zero drift)
 *  - Interactive lock & unlock states per participant
 *  - Auto-distribution of remaining balance across unlocked members
 *  - Support for all currencies (INR, USD, EUR, GBP, AED, SGD, AUD, CAD, JPY)
 * ==============================================================================
 */

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY']);

/**
 * Distribute an amount deterministically across a given number of participants
 * without losing or gaining a single cent/paisa/yen.
 *
 * @param {number} amount - Total amount to distribute
 * @param {number} count - Number of recipients
 * @param {string} currency - Currency code (e.g. 'INR', 'USD', 'JPY')
 * @returns {number[]} Array of calculated share amounts
 */
function distributeDeterministically(amount, count, currency = 'INR') {
    if (count <= 0) return [];
    if (amount <= 0) return Array(count).fill(0);

    const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has((currency || 'INR').toUpperCase());

    if (isZeroDecimal) {
        const totalUnits = Math.round(amount);
        const base = Math.floor(totalUnits / count);
        let remainder = totalUnits - (base * count);
        const result = [];
        for (let i = 0; i < count; i++) {
            const extra = (i < remainder) ? 1 : 0;
            result.push(base + extra);
        }
        return result;
    } else {
        const totalCents = Math.round(amount * 100);
        const baseCents = Math.floor(totalCents / count);
        let remainderCents = totalCents - (baseCents * count);
        const result = [];
        for (let i = 0; i < count; i++) {
            const extra = (i < remainderCents) ? 1 : 0;
            result.push(parseFloat(((baseCents + extra) / 100).toFixed(2)));
        }
        return result;
    }
}

/**
 * Perform Smart Custom Split calculation with locked amounts and auto-distribution
 *
 * @param {Object} options
 * @param {number} options.totalAmount - Total expense amount
 * @param {Array} options.participants - Array of participant objects ({ id/user_id, name, ... })
 * @param {Object|Map} options.locks - Map of participant ID to locked amount (or boolean is_locked)
 * @param {string} options.currency - Currency code (default 'INR')
 * @returns {Object} Calculation result with splits, validation status, and remaining balance
 */
function calculateSmartCustomSplits({ totalAmount, participants, locks = {}, currency = 'INR' }) {
    const total = parseFloat(totalAmount) || 0;
    const cur = (currency || 'INR').toUpperCase();
    const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(cur);

    if (!participants || !Array.isArray(participants) || participants.length === 0) {
        return {
            totalAmount: total,
            currency: cur,
            sumLocked: 0,
            remainingAmount: total,
            lockedCount: 0,
            unlockedCount: 0,
            autoSharePerPerson: 0,
            isBalanced: false,
            errorMessage: 'Please select at least one participant for the split.',
            splits: []
        };
    }

    const lockMap = locks instanceof Map ? locks : new Map(Object.entries(locks));

    let sumLocked = 0;
    const lockedList = [];
    const unlockedList = [];

    // Categorize participants into locked vs unlocked
    for (const p of participants) {
        const uid = String(typeof p === 'object' && p !== null ? (p.id !== undefined ? p.id : (p.user_id || p.userId)) : p);
        const lockVal = lockMap.get(uid);

        let isLocked = false;
        let lockedAmt = 0;

        if (lockVal !== undefined && lockVal !== null) {
            if (typeof lockVal === 'object') {
                isLocked = lockVal.is_locked === true;
                lockedAmt = parseFloat(lockVal.amount || 0);
            } else if (typeof lockVal === 'boolean') {
                isLocked = lockVal;
                lockedAmt = parseFloat(p.amount || 0);
            } else if (typeof lockVal === 'number' || typeof lockVal === 'string') {
                isLocked = true;
                lockedAmt = parseFloat(lockVal);
            }
        } else if (typeof p === 'object' && p !== null && p.is_locked === true) {
            isLocked = true;
            lockedAmt = parseFloat(p.amount || 0);
        }

        const baseObj = typeof p === 'object' && p !== null ? p : {};
        const finalId = String(typeof p === 'object' && p !== null ? (p.id !== undefined ? p.id : (p.user_id || p.userId)) : p);
        const finalUserId = isNaN(parseInt(finalId)) ? finalId : parseInt(finalId);

        if (isLocked) {
            if (isNaN(lockedAmt) || lockedAmt < 0) {
                return {
                    totalAmount: total,
                    currency: cur,
                    sumLocked: 0,
                    remainingAmount: total,
                    lockedCount: 0,
                    unlockedCount: 0,
                    autoSharePerPerson: 0,
                    isBalanced: false,
                    errorMessage: `Locked amount for ${baseObj.name || 'participant'} cannot be negative.`,
                    splits: []
                };
            }
            const cleanLocked = isZeroDecimal ? Math.round(lockedAmt) : Math.round(lockedAmt * 100) / 100;
            sumLocked += cleanLocked;
            lockedList.push({ ...baseObj, id: finalId, user_id: finalUserId, amount: cleanLocked, is_locked: true, status: 'Locked' });
        } else {
            unlockedList.push({ ...baseObj, id: finalId, user_id: finalUserId, is_locked: false, status: 'Auto' });
        }
    }

    sumLocked = isZeroDecimal ? Math.round(sumLocked) : Math.round(sumLocked * 100) / 100;
    const remaining = isZeroDecimal ? (total - sumLocked) : Math.round((total - sumLocked) * 100) / 100;

    // Check for over-allocation
    if (remaining < 0) {
        const overAmt = Math.abs(remaining);
        return {
            totalAmount: total,
            currency: cur,
            sumLocked,
            remainingAmount: remaining,
            lockedCount: lockedList.length,
            unlockedCount: unlockedList.length,
            autoSharePerPerson: 0,
            isBalanced: false,
            errorMessage: `Locked amounts (${cur} ${sumLocked.toFixed(isZeroDecimal ? 0 : 2)}) exceed total expense (${cur} ${total.toFixed(isZeroDecimal ? 0 : 2)}) by ${cur} ${overAmt.toFixed(isZeroDecimal ? 0 : 2)}.`,
            splits: [...lockedList, ...unlockedList.map(u => ({ ...u, amount: 0 }))]
        };
    }

    // Auto-distribute remaining among unlocked members
    let distributedUnlocked = [];
    if (unlockedList.length > 0) {
        const shares = distributeDeterministically(remaining, unlockedList.length, cur);
        distributedUnlocked = unlockedList.map((u, idx) => ({
            ...u,
            amount: shares[idx],
            is_locked: false,
            status: 'Auto'
        }));
    } else {
        // No unlocked participants
        if (Math.abs(remaining) > (isZeroDecimal ? 0.5 : 0.05)) {
            return {
                totalAmount: total,
                currency: cur,
                sumLocked,
                remainingAmount: remaining,
                lockedCount: lockedList.length,
                unlockedCount: 0,
                autoSharePerPerson: 0,
                isBalanced: false,
                errorMessage: `All participants are locked, but an unallocated balance of ${cur} ${remaining.toFixed(isZeroDecimal ? 0 : 2)} remains. Unlock a member or balance the locked amounts.`,
                splits: lockedList
            };
        }
    }

    // Combine in original participant order
    const participantOrder = new Map(participants.map((p, idx) => [String(typeof p === 'object' && p !== null ? (p.id !== undefined ? p.id : (p.user_id || p.userId)) : p), idx]));
    const finalSplits = [...lockedList, ...distributedUnlocked].sort((a, b) => {
        return (participantOrder.get(String(a.id)) || 0) - (participantOrder.get(String(b.id)) || 0);
    });

    // Final balance validation
    const sumSplits = finalSplits.reduce((acc, s) => acc + s.amount, 0);
    const roundedSum = isZeroDecimal ? Math.round(sumSplits) : Math.round(sumSplits * 100) / 100;
    const isBalanced = Math.abs(roundedSum - total) <= (isZeroDecimal ? 0.5 : 0.05) && remaining >= 0;

    const autoShare = unlockedList.length > 0 ? (remaining / unlockedList.length) : 0;

    return {
        totalAmount: total,
        currency: cur,
        sumLocked,
        remainingAmount: remaining,
        lockedCount: lockedList.length,
        unlockedCount: unlockedList.length,
        autoSharePerPerson: isZeroDecimal ? Math.round(autoShare) : parseFloat(autoShare.toFixed(2)),
        isBalanced,
        errorMessage: isBalanced ? null : `The sum of splits (${cur} ${roundedSum.toFixed(isZeroDecimal ? 0 : 2)}) does not match the total expense (${cur} ${total.toFixed(isZeroDecimal ? 0 : 2)}).`,
        splits: finalSplits
    };
}

module.exports = {
    distributeDeterministically,
    calculateSmartCustomSplits,
    ZERO_DECIMAL_CURRENCIES
};
