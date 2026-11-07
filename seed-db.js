const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

const pool = new Pool(
    process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
        : {
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_NAME,
            password: process.env.DB_PASSWORD,
            port: process.env.DB_PORT,
        }
);

async function seedDatabase() {
    try {
        console.log("Seeding SplitEase database with design-matched data...");

        // Clean out existing data
        await pool.query(`
            DELETE FROM activity_logs;
            DELETE FROM settlements;
            DELETE FROM expense_splits;
            DELETE FROM expenses;
            DELETE FROM group_members;
            DELETE FROM groups;
            DELETE FROM users;
        `);

        // 1. Insert Demo Users
        const commonHash = await bcrypt.hash('password123', 10);
        await pool.query(`
            INSERT INTO users (id, name, email, password_hash, avatar_initials, upi_id, phone) VALUES 
            (1, 'Alex Sharma', 'alex@splitease.io', $1, 'AS', 'alex.sharma@okicici', '+91 98765 43210'),
            (2, 'Rahul Sharma', 'rahul@example.com', $1, 'RS', 'rahul.sharma@okaxis', '+91 98765 11111'),
            (3, 'Priya Patel', 'priya@example.com', $1, 'PP', 'priya.patel@icici', '+91 98765 22222'),
            (4, 'Aman Verma', 'aman@example.com', $1, 'AV', 'aman.verma@okhdfcbank', '+91 98765 33333'),
            (5, 'Neha Reddy', 'neha@example.com', $1, 'NR', 'neha.reddy@okaxis', '+91 98765 44444');
        `, [commonHash]);

        await pool.query(`SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));`);

        // 2. Insert Groups
        await pool.query(`
            INSERT INTO groups (id, name, description, category, avatar_color, created_by) VALUES 
            (1, 'Goa Trip 2024', 'Baga Beach, Scooters, Watersports & North Goa villa stay.', 'Travel & Vacation', '#006c4b', 1),
            (2, 'Flatmates', 'Apartment 402 - Groceries, WiFi, Electricity and Maid', 'Rent & Utilities', '#16a878', 1),
            (3, 'Office Lunch & Snacks', 'Team Friday treats, coffee breaks and celebrations', 'Food & Dining', '#4d6171', 1),
            (4, 'Bangalore Roadtrip', 'Weekend getaway to Nandi Hills & Coorg', 'Travel & Vacation', '#006c4c', 1);
        `);
        await pool.query(`SELECT setval('groups_id_seq', (SELECT MAX(id) FROM groups));`);

        // 3. Insert Group Members
        await pool.query(`
            INSERT INTO group_members (group_id, user_id, role) VALUES 
            (1, 1, 'admin'), (1, 2, 'editor'), (1, 3, 'member'), (1, 4, 'member'), (1, 5, 'member'),
            (2, 1, 'admin'), (2, 2, 'editor'), (2, 3, 'member'), (2, 4, 'editor'),
            (3, 1, 'admin'), (3, 2, 'editor'), (3, 4, 'member'),
            (4, 1, 'admin'), (4, 3, 'editor'), (4, 5, 'member');
        `);

        // 4. Insert Expenses calibrated to exactly match screenshot metrics:
        // You Owe ₹2,450 (Rahul ₹850, Priya ₹600, Aman ₹1,000)
        // You're Owed ₹5,800 (Aman ₹3,200, Neha ₹2,600)
        // Net Balance = +₹3,350
        await pool.query(`
            INSERT INTO expenses (id, group_id, paid_by, amount, currency, description, category, split_type, notes, expense_date) VALUES 
            (1, 1, 1, 4800.00, 'INR', 'Dinner at The Grand Restaurant', 'Food & Drinks', 'equal', 'North Goa seafood dinner with team', '2024-10-28'),
            (2, 1, 1, 5200.00, 'INR', 'Airbnb Villa Booking', 'Travel & Stay', 'equal', 'Villa stay deposit', '2024-10-27'),
            (3, 2, 2, 3400.00, 'INR', 'Electricity & Internet Bill', 'Utilities', 'equal', 'ACT Fibernet & Electricity', '2024-10-26'),
            (4, 1, 3, 2400.00, 'INR', 'Scuba Diving Adventure', 'Travel & Stay', 'equal', 'Grand Island scuba package', '2024-10-24'),
            (5, 2, 4, 4000.00, 'INR', 'Weekly Grocery Basket', 'Groceries', 'equal', 'Supermarket monthly supplies', '2024-10-22'),
            (6, 3, 1, 2100.00, 'INR', 'Pizza Party & Team Coffee', 'Food & Dining', 'equal', 'Friday team lunch at Dominoes', '2024-10-15');
        `);
        await pool.query(`SELECT setval('expenses_id_seq', (SELECT MAX(id) FROM expenses));`);

        // 5. Insert Expense Splits
        await pool.query(`
            INSERT INTO expense_splits (expense_id, user_id, amount, split_percentage, shares, is_settled) VALUES 
            -- Expense 1 (Dinner: 4800 paid by Alex. Alex 1600, Aman 3200) -> Aman owes Alex 3200
            (1, 1, 1600.00, 33.33, 1, false),
            (1, 4, 3200.00, 66.67, 2, false),

            -- Expense 2 (Airbnb: 5200 paid by Alex. Alex 2600, Neha 2600) -> Neha owes Alex 2600
            (2, 1, 2600.00, 50.00, 1, false),
            (2, 5, 2600.00, 50.00, 1, false),

            -- Expense 3 (Electricity: 3400 paid by Rahul. Rahul 2550, Alex 850) -> Alex owes Rahul 850
            (3, 2, 2550.00, 75.00, 3, false),
            (3, 1, 850.00, 25.00, 1, false),

            -- Expense 4 (Scuba: 2400 paid by Priya. Priya 1800, Alex 600) -> Alex owes Priya 600
            (4, 3, 1800.00, 75.00, 3, false),
            (4, 1, 600.00, 25.00, 1, false),

            -- Expense 5 (Groceries: 4000 paid by Aman. Aman 3000, Alex 1000) -> Alex owes Aman 1000
            (5, 4, 3000.00, 75.00, 3, false),
            (5, 1, 1000.00, 25.00, 1, false),

            -- Expense 6 (Pizza: 2100 paid by Alex. Alex 700, Rahul 700, Aman 700. Fully settled earlier)
            (6, 1, 700.00, 33.33, 1, true),
            (6, 2, 700.00, 33.33, 1, true),
            (6, 4, 700.00, 33.34, 1, true);
        `);
        await pool.query(`SELECT setval('expense_splits_id_seq', (SELECT MAX(id) FROM expense_splits));`);

        // 6. Settlements
        await pool.query(`
            INSERT INTO settlements (group_id, payer_id, receiver_id, amount, payment_method, transaction_reference, notes) VALUES 
            (3, 2, 1, 700.00, 'UPI', 'UPI-982314-AXIS', 'Settled pizza lunch share'),
            (3, 4, 1, 700.00, 'UPI', 'UPI-472195-HDFC', 'Settled pizza lunch share');
        `);

        // 7. Insert Activity Logs
        await pool.query(`
            INSERT INTO activity_logs (user_id, group_id, activity_type, message) VALUES 
            (1, 1, 'EXPENSE_ADDED', 'Alex Sharma added "Dinner at The Grand Restaurant" (₹4,800.00) in Goa Trip 2024'),
            (1, 1, 'EXPENSE_ADDED', 'Alex Sharma added "Airbnb Villa Booking" (₹5,200.00) in Goa Trip 2024'),
            (2, 2, 'EXPENSE_ADDED', 'Rahul Sharma added "Electricity & Internet Bill" (₹3,400.00) in Flatmates'),
            (3, 1, 'EXPENSE_ADDED', 'Priya Patel added "Scuba Diving Adventure" (₹2,400.00) in Goa Trip 2024'),
            (4, 2, 'EXPENSE_ADDED', 'Aman Verma added "Weekly Grocery Basket" (₹4,000.00) in Flatmates'),
            (2, 3, 'SETTLEMENT', 'Rahul Sharma settled ₹700.00 with Alex Sharma via UPI'),
            (4, 3, 'SETTLEMENT', 'Aman Verma settled ₹700.00 with Alex Sharma via UPI');
        `);

        console.log("Database seeded successfully with design-matched SplitEase data!");
        process.exit(0);
    } catch (err) {
        console.error("Database seed error:", err);
        process.exit(1);
    }
}

seedDatabase();
