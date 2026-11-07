const { Pool } = require('pg');
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

async function setupDatabase() {
    try {
        console.log("Setting up PostgreSQL database for SplitEase...");

        // Drop older views and tables cleanly
        await pool.query(`
            DROP TABLE IF EXISTS event_members CASCADE;
            DROP VIEW IF EXISTS event_members CASCADE;
            DROP TABLE IF EXISTS events CASCADE;
            DROP VIEW IF EXISTS events CASCADE;
            DROP TABLE IF EXISTS activity_logs CASCADE;
            DROP TABLE IF EXISTS settlements CASCADE;
            DROP TABLE IF EXISTS expense_splits CASCADE;
            DROP TABLE IF EXISTS expenses CASCADE;
            DROP TABLE IF EXISTS group_members CASCADE;
            DROP TABLE IF EXISTS groups CASCADE;
            DROP TABLE IF EXISTS users CASCADE;
        `);

        console.log("Creating new comprehensive SplitEase schema...");

        // 1. Users Table
        await pool.query(`
            CREATE TABLE users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                avatar_initials VARCHAR(10),
                upi_id VARCHAR(100),
                phone VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Groups Table
        await pool.query(`
            CREATE TABLE groups (
                id SERIAL PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                description TEXT,
                category VARCHAR(50) DEFAULT 'General',
                avatar_color VARCHAR(50) DEFAULT '#006c4b',
                created_by INT REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 3. Group Members
        await pool.query(`
            CREATE TABLE group_members (
                group_id INT REFERENCES groups(id) ON DELETE CASCADE,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                role VARCHAR(20) DEFAULT 'member',
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (group_id, user_id)
            );
        `);

        // Backward compatibility views for "events" & "event_members"
        await pool.query(`
            CREATE OR REPLACE VIEW events AS 
            SELECT id, name AS title, description, category, created_by, created_at 
            FROM groups;

            CREATE OR REPLACE VIEW event_members AS 
            SELECT group_id AS event_id, user_id, joined_at 
            FROM group_members;
        `);

        // 4. Expenses Table
        await pool.query(`
            CREATE TABLE expenses (
                id SERIAL PRIMARY KEY,
                group_id INT REFERENCES groups(id) ON DELETE CASCADE,
                paid_by INT REFERENCES users(id) ON DELETE SET NULL,
                amount DECIMAL(10, 2) NOT NULL,
                currency VARCHAR(10) DEFAULT 'INR',
                description TEXT NOT NULL,
                category VARCHAR(50) DEFAULT 'Food & Drinks',
                split_type VARCHAR(20) DEFAULT 'equal',
                notes TEXT,
                receipt_url TEXT,
                expense_date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5. Expense Splits Table
        await pool.query(`
            CREATE TABLE expense_splits (
                id SERIAL PRIMARY KEY,
                expense_id INT REFERENCES expenses(id) ON DELETE CASCADE,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                amount DECIMAL(10, 2) NOT NULL,
                split_percentage DECIMAL(5, 2) DEFAULT 0,
                shares DECIMAL(5, 2) DEFAULT 1,
                is_settled BOOLEAN DEFAULT FALSE,
                UNIQUE (expense_id, user_id)
            );
        `);

        // 6. Settlements Table
        await pool.query(`
            CREATE TABLE settlements (
                id SERIAL PRIMARY KEY,
                group_id INT REFERENCES groups(id) ON DELETE SET NULL,
                payer_id INT REFERENCES users(id) ON DELETE CASCADE,
                receiver_id INT REFERENCES users(id) ON DELETE CASCADE,
                amount DECIMAL(10, 2) NOT NULL,
                currency VARCHAR(10) DEFAULT 'INR',
                payment_method VARCHAR(50) DEFAULT 'UPI',
                transaction_reference VARCHAR(100),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 7. Activity Logs Table
        await pool.query(`
            CREATE TABLE activity_logs (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                group_id INT REFERENCES groups(id) ON DELETE CASCADE,
                activity_type VARCHAR(50) NOT NULL,
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("Database schema created successfully with all tables and views!");
        process.exit(0);
    } catch (err) {
        console.error("Database setup error:", err);
        process.exit(1);
    }
}

setupDatabase();
