/**
 * ==============================================================================
 * SPLITWISE UNIFIED SPLIT ENGINE
 * ==============================================================================
 * Single source of truth for every split method:
 *   equal | exact | percentage | shares | smart_custom | single
 *
 * Guarantees:
 *  - sum(participant shares) === expense total, to the minor currency unit
 *  - deterministic remainder allocation (no drift, no lost paisa)
 *  - server-side computation is authoritative; client amounts are validated
 * ==============================================================================
 */

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY']);
const ALLOWED_SPLIT_TYPES = new Set(['equal', 'exact', 'percentage', 'shares', 'smart_custom', 'single']);

function isZeroDecimal(currency) {
    return ZERO_DECIMAL_CURRENCIES.has(String(currency || 'INR').toUpperCase());
}

function unitScale(currency) {
    return isZeroDecimal(currency) ? 1 : 100;
}

function roundAmount(value, currency = 'INR') {
    const scale = unitScale(currency);
    return Math.round((Number(value) || 0) * scale) / scale;
}

/**
 * Deterministically allocate `total` across weights using the largest-remainder
 * method, in minor units. The returned values always sum exactly to `total`.
 */
function allocateByWeights(total, weights, currency = 'INR') {
    const scale = unitScale(currency);
    const totalUnits = Math.round((Number(total) || 0) * scale);
    const safeWeights = (weights || []).map(w => {
        const n = Number(w);
        return Number.isFinite(n) && n > 0 ? n : 0;
    });
    const count = safeWeights.length;
    if (count === 0) return [];
    if (totalUnits <= 0) return new Array(count).fill(0);

    const weightSum = safeWeights.reduce((a, b) => a + b, 0);
    if (weightSum <= 0) {
        // Fall back to equal allocation when no positive weights exist.
        return allocateByWeights(total, new Array(count).fill(1), currency);
    }

    const exact = safeWeights.map(w => (totalUnits * w) / weightSum);
    const floors = exact.map(v => Math.floor(v));
    let allocated = floors.reduce((a, b) => a + b, 0);
    let remainder = totalUnits - allocated;

    const order = exact
        .map((v, i) => ({ i, frac: v - Math.floor(v) }))
        .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

    const result = floors.slice();
    let k = 0;
    while (remainder > 0 && order.length > 0) {
        result[order[k % order.length].i] += 1;
        remainder -= 1;
        k += 1;
    }
    // If rounding somehow over-allocated (defensive), claw back from the end.
    while (remainder < 0) {
        for (let i = result.length - 1; i >= 0 && remainder < 0; i--) {
            if (result[i] > 0) { result[i] -= 1; remainder += 1; }
        }
    }

    return result.map(units => (scale === 1 ? units : Math.round(units) / scale));
}

function normalizeUserId(value) {
    const id = parseInt(value);
    return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Normalize and validate a split payload.
 *
 * @param {Object} options
 * @param {number} options.totalAmount
 * @param {string} options.splitType
 * @param {Array}  options.splits   [{ user_id, amount, percentage, shares, is_locked }]
 * @param {string} options.currency
 * @returns {{ splits: Array|null, error: string|null }}
 */
function normalizeSplits({ totalAmount, splitType, splits, currency = 'INR' }) {
    const total = roundAmount(totalAmount, currency);
    const type = String(splitType || 'equal').toLowerCase();

    if (!ALLOWED_SPLIT_TYPES.has(type)) {
        return { splits: null, error: `Unsupported split method "${splitType}".` };
    }
    if (!Array.isArray(splits) || splits.length === 0) {
        return { splits: null, error: 'Please select at least one participant for the split.' };
    }
    if (!(total > 0)) {
        return { splits: null, error: 'Expense amount must be greater than zero.' };
    }

    const seen = new Set();
    const clean = [];
    for (const s of splits) {
        const uid = normalizeUserId(s.user_id !== undefined ? s.user_id : (s.id !== undefined ? s.id : s.userId));
        if (!uid) {
            return { splits: null, error: 'Every split participant must have a valid member ID.' };
        }
        if (seen.has(uid)) {
            return { splits: null, error: 'The same member cannot appear twice in one split.' };
        }
        seen.add(uid);
        clean.push({ ...s, user_id: uid });
    }

    const scale = unitScale(currency);

    if (type === 'equal' || type === 'single') {
        if (type === 'single' && clean.length !== 1) {
            return { splits: null, error: 'A single-payer split must contain exactly one participant.' };
        }
        const amounts = allocateByWeights(total, clean.map(() => 1), currency);
        return {
            splits: clean.map((s, i) => ({
                user_id: s.user_id,
                amount: amounts[i],
                percentage: roundAmount((amounts[i] / total) * 100, 'INR'),
                shares: 1,
                is_locked: false
            })),
            error: null
        };
    }

    if (type === 'shares') {
        const weights = clean.map(s => Number(s.shares !== undefined ? s.shares : s.weight !== undefined ? s.weight : s.amount));
        if (weights.some(w => !Number.isFinite(w) || w <= 0)) {
            return { splits: null, error: 'Every participant needs a positive share count (for example 1, 2 or 3).' };
        }
        const weightSum = weights.reduce((a, b) => a + b, 0);
        const amounts = allocateByWeights(total, weights, currency);
        return {
            splits: clean.map((s, i) => ({
                user_id: s.user_id,
                amount: amounts[i],
                percentage: roundAmount((amounts[i] / total) * 100, 'INR'),
                shares: weights[i],
                share_weight_total: weightSum,
                is_locked: false
            })),
            error: null
        };
    }

    if (type === 'percentage') {
        let pcts = clean.map(s => Number(s.percentage !== undefined ? s.percentage : s.split_percentage));
        if (pcts.some(p => !Number.isFinite(p) || p < 0)) {
            // Fallback: derive percentages from supplied amounts.
            const amts = clean.map(s => Number(s.amount));
            if (amts.some(a => !Number.isFinite(a) || a < 0)) {
                return { splits: null, error: 'Please enter a valid percentage for every participant.' };
            }
            const sumAmts = amts.reduce((a, b) => a + b, 0);
            if (Math.abs(sumAmts - total) > (1 / scale)) {
                return { splits: null, error: 'Percentages or amounts must add up to the expense total.' };
            }
            pcts = amts.map(a => (a / total) * 100);
        }
        const pctSum = Math.round(pcts.reduce((a, b) => a + b, 0) * 100) / 100;
        if (Math.abs(pctSum - 100) > 0.011) {
            return { splits: null, error: `Percentages must add up to 100% (currently ${pctSum.toFixed(2)}%).` };
        }
        const amounts = allocateByWeights(total, pcts, currency);
        return {
            splits: clean.map((s, i) => ({
                user_id: s.user_id,
                amount: amounts[i],
                percentage: Math.round(pcts[i] * 100) / 100,
                shares: 1,
                is_locked: false
            })),
            error: null
        };
    }

    // exact / smart_custom: amounts are authoritative but must balance exactly.
    const amounts = clean.map(s => Number(s.amount));
    if (amounts.some(a => !Number.isFinite(a) || a < 0)) {
        return { splits: null, error: 'Every participant needs a valid non-negative amount.' };
    }
    const rawSum = Math.round(amounts.reduce((a, b) => a + b, 0) * scale) / scale;
    const diffUnits = Math.round((total - rawSum) * scale);
    if (Math.abs(diffUnits) > 0) {
        // Absorb a sub-unit rounding remainder into the largest share only when
        // it is a genuine rounding artefact (at most 1 minor unit per member).
        if (Math.abs(diffUnits) <= clean.length) {
            let idx = 0;
            for (let i = 1; i < amounts.length; i++) if (amounts[i] > amounts[idx]) idx = i;
            amounts[idx] = roundAmount(amounts[idx] + diffUnits / scale, currency);
        } else {
            return {
                splits: null,
                error: `The sum of splits (${rawSum.toFixed(2)}) does not match the total expense amount (${total.toFixed(2)}).`
            };
        }
    }
    const finalSum = roundAmount(amounts.reduce((a, b) => a + b, 0), currency);
    if (Math.abs(finalSum - total) > (1 / scale)) {
        return {
            splits: null,
            error: `The sum of splits (${finalSum.toFixed(2)}) does not match the total expense amount (${total.toFixed(2)}).`
        };
    }
    return {
        splits: clean.map((s, i) => ({
            user_id: s.user_id,
            amount: roundAmount(amounts[i], currency),
            percentage: total > 0 ? roundAmount((amounts[i] / total) * 100, 'INR') : 0,
            shares: Number(s.shares) > 0 ? Number(s.shares) : 1,
            is_locked: s.is_locked === true
        })),
        error: null
    };
}

module.exports = {
    ALLOWED_SPLIT_TYPES,
    ZERO_DECIMAL_CURRENCIES,
    allocateByWeights,
    normalizeSplits,
    roundAmount,
    isZeroDecimal
};
