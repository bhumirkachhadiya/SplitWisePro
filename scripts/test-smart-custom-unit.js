const assert = require('assert');
const { calculateSmartCustomSplits, distributeDeterministically } = require('../smartCustomSplitService');

console.log('====================================================');
console.log('   SMART CUSTOM SPLIT ENGINE UNIT TEST SUITE        ');
console.log('====================================================\n');

const participants5 = [
    { id: 1, name: 'Person 1' },
    { id: 2, name: 'Person 2' },
    { id: 3, name: 'Person 3' },
    { id: 4, name: 'Person 4' },
    { id: 5, name: 'Person 5' }
];

// Test 1: Initial equal state (no locks)
console.log('--- TEST 1: Initial State (No Locks) ---');
const r1 = calculateSmartCustomSplits({
    totalAmount: 10000,
    participants: participants5,
    locks: {}
});
assert.strictEqual(r1.isBalanced, true);
assert.strictEqual(r1.lockedCount, 0);
assert.strictEqual(r1.unlockedCount, 5);
assert.strictEqual(r1.autoSharePerPerson, 2000);
r1.splits.forEach(s => assert.strictEqual(s.amount, 2000));
console.log('✓ PASS: ₹10,000 divided equally across 5 members (₹2,000 each)');

// Test 2: Lock Person 1 at ₹5,000
console.log('--- TEST 2: Lock Person 1 at ₹5,000 ---');
const r2 = calculateSmartCustomSplits({
    totalAmount: 10000,
    participants: participants5,
    locks: { '1': 5000 }
});
assert.strictEqual(r2.isBalanced, true);
assert.strictEqual(r2.lockedCount, 1);
assert.strictEqual(r2.unlockedCount, 4);
assert.strictEqual(r2.sumLocked, 5000);
assert.strictEqual(r2.remainingAmount, 5000);
assert.strictEqual(r2.autoSharePerPerson, 1250);
assert.strictEqual(r2.splits.find(s => s.id === '1').amount, 5000);
assert.strictEqual(r2.splits.find(s => s.id === '1').is_locked, true);
r2.splits.filter(s => s.id !== '1').forEach(s => {
    assert.strictEqual(s.amount, 1250);
    assert.strictEqual(s.is_locked, false);
});
console.log('✓ PASS: Person 1 locked at ₹5,000, 4 unlocked auto-allocated ₹1,250 each');

// Test 3: Lock Person 2 at ₹2,000
console.log('--- TEST 3: Lock Person 2 at ₹2,000 ---');
const r3 = calculateSmartCustomSplits({
    totalAmount: 10000,
    participants: participants5,
    locks: { '1': 5000, '2': 2000 }
});
assert.strictEqual(r3.isBalanced, true);
assert.strictEqual(r3.lockedCount, 2);
assert.strictEqual(r3.unlockedCount, 3);
assert.strictEqual(r3.sumLocked, 7000);
assert.strictEqual(r3.remainingAmount, 3000);
assert.strictEqual(r3.autoSharePerPerson, 1000);
assert.strictEqual(r3.splits.find(s => s.id === '1').amount, 5000);
assert.strictEqual(r3.splits.find(s => s.id === '2').amount, 2000);
r3.splits.filter(s => s.id !== '1' && s.id !== '2').forEach(s => {
    assert.strictEqual(s.amount, 1000);
    assert.strictEqual(s.is_locked, false);
});
console.log('✓ PASS: Person 1 at ₹5,000, Person 2 at ₹2,000, 3 unlocked auto-allocated ₹1,000 each');

// Test 4: Unlock Person 1
console.log('--- TEST 4: Unlock Person 1 ---');
const r4 = calculateSmartCustomSplits({
    totalAmount: 10000,
    participants: participants5,
    locks: { '2': 2000 }
});
assert.strictEqual(r4.isBalanced, true);
assert.strictEqual(r4.lockedCount, 1);
assert.strictEqual(r4.unlockedCount, 4);
assert.strictEqual(r4.sumLocked, 2000);
assert.strictEqual(r4.remainingAmount, 8000);
assert.strictEqual(r4.autoSharePerPerson, 2000);
assert.strictEqual(r4.splits.find(s => s.id === '2').amount, 2000);
r4.splits.filter(s => s.id !== '2').forEach(s => {
    assert.strictEqual(s.amount, 2000);
});
console.log('✓ PASS: Unlocked Person 1, remaining ₹8,000 redistributed across 4 members (₹2,000 each)');

// Test 5: Over-allocation error
console.log('--- TEST 5: Over-allocation Validation ---');
const r5 = calculateSmartCustomSplits({
    totalAmount: 10000,
    participants: participants5,
    locks: { '1': 7000, '2': 4000 }
});
assert.strictEqual(r5.isBalanced, false);
assert.strictEqual(r5.sumLocked, 11000);
assert(r5.errorMessage.includes('exceed total expense'));
console.log('✓ PASS: Over-allocation detected and prevented: ' + r5.errorMessage);

// Test 6: Deterministic Decimal Rounding (₹100 across 3 members)
console.log('--- TEST 6: Deterministic Decimal Rounding (₹100 / 3) ---');
const r6 = calculateSmartCustomSplits({
    totalAmount: 100,
    participants: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' }
    ],
    locks: {}
});
assert.strictEqual(r6.isBalanced, true);
const sum6 = r6.splits.reduce((acc, s) => acc + s.amount, 0);
assert.strictEqual(Math.round(sum6 * 100) / 100, 100.00);
assert.strictEqual(r6.splits[0].amount, 33.34);
assert.strictEqual(r6.splits[1].amount, 33.33);
assert.strictEqual(r6.splits[2].amount, 33.33);
console.log(`✓ PASS: Exact sum: ₹${sum6.toFixed(2)} (${r6.splits.map(s => s.amount).join(' + ')})`);

// Test 7: JPY Zero-decimal currency
console.log('--- TEST 7: Zero-Decimal JPY Currency (¥10,000 / 3) ---');
const r7 = calculateSmartCustomSplits({
    totalAmount: 10000,
    participants: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' }
    ],
    locks: {},
    currency: 'JPY'
});
assert.strictEqual(r7.isBalanced, true);
const sum7 = r7.splits.reduce((acc, s) => acc + s.amount, 0);
assert.strictEqual(sum7, 10000);
assert.strictEqual(r7.splits[0].amount, 3334);
assert.strictEqual(r7.splits[1].amount, 3333);
assert.strictEqual(r7.splits[2].amount, 3333);
console.log(`✓ PASS: Exact sum: ¥${sum7} (${r7.splits.map(s => s.amount).join(' + ')})`);

// Test 8: All locked balanced
console.log('--- TEST 8: All Locked Balanced ---');
const r8 = calculateSmartCustomSplits({
    totalAmount: 5000,
    participants: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' }
    ],
    locks: { '1': 3000, '2': 2000 }
});
assert.strictEqual(r8.isBalanced, true);
assert.strictEqual(r8.unlockedCount, 0);
assert.strictEqual(r8.remainingAmount, 0);
console.log('✓ PASS: All participants locked with exact sum');

console.log('\n====================================================');
console.log('   🎉 ALL SMART CUSTOM SPLIT UNIT TESTS PASSED!     ');
console.log('====================================================\n');
