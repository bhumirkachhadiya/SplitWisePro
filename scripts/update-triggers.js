require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        console.log('Updating triggers to ensure payer self-splits are not treated as settled participant debts...');

        await pool.query(`
            CREATE OR REPLACE FUNCTION public.check_expense_deletion_protection()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $function$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM public.expense_splits 
                    WHERE expense_id = OLD.id AND is_settled = TRUE AND user_id != OLD.paid_by
                ) THEN
                    RAISE EXCEPTION 'Cannot delete expense: one or more participant shares have already been settled or paid. Use the safe correction process instead.';
                END IF;

                IF EXISTS (
                    SELECT 1 FROM public.expense_corrections
                    WHERE expense_id = OLD.id
                ) THEN
                    RAISE EXCEPTION 'Cannot delete expense with existing audit correction history.';
                END IF;

                RETURN OLD;
            END;
            $function$;
        `);

        await pool.query(`
            CREATE OR REPLACE FUNCTION public.check_split_modification_protection()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $function$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.is_settled = TRUE THEN
                        IF EXISTS (SELECT 1 FROM public.expenses WHERE id = OLD.expense_id AND paid_by = OLD.user_id) THEN
                            RETURN OLD;
                        END IF;
                        RAISE EXCEPTION 'Cannot delete a settled expense split. Settlement history must be preserved.';
                    END IF;
                    RETURN OLD;
                END IF;

                IF TG_OP = 'UPDATE' THEN
                    IF OLD.is_settled = TRUE THEN
                        IF NEW.amount < OLD.amount THEN
                            IF EXISTS (SELECT 1 FROM public.expenses WHERE id = OLD.expense_id AND paid_by = OLD.user_id) THEN
                                RETURN NEW;
                            END IF;
                            RAISE EXCEPTION 'Cannot reduce amount of an already settled split. Use the safe correction process.';
                        END IF;
                    END IF;
                    RETURN NEW;
                END IF;

                RETURN NEW;
            END;
            $function$;
        `);

        console.log('✓ Successfully updated database triggers!');
    } catch (err) {
        console.error('Error updating triggers:', err);
    } finally {
        await pool.end();
    }
}

main();
