const { pool } = require('../db');

async function main() {
  try {
    const groupRes = await pool.query("SELECT * FROM groups WHERE name ILIKE '%Diwali%'");
    console.log("=== DIWALI GROUPS ===");
    console.log(groupRes.rows);

    if (groupRes.rows.length > 0) {
      const gId = groupRes.rows[0].id;
      const membersRes = await pool.query(
        "SELECT gm.*, u.name, u.email FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = $1",
        [gId]
      );
      console.log("\n=== GROUP MEMBERS ===");
      console.log(membersRes.rows);

      const expRes = await pool.query("SELECT * FROM expenses WHERE group_id = $1", [gId]);
      console.log("\n=== EXPENSES ===");
      console.log(expRes.rows);

      if (expRes.rows.length > 0) {
        const expIds = expRes.rows.map(e => e.id);
        const splitsRes = await pool.query(
          "SELECT es.*, u.name, u.email FROM expense_splits es JOIN users u ON es.user_id = u.id WHERE es.expense_id = ANY($1::int[])",
          [expIds]
        );
        console.log("\n=== EXPENSE SPLITS ===");
        console.log(splitsRes.rows);
      }

      const settRes = await pool.query("SELECT * FROM settlements WHERE group_id = $1", [gId]);
      console.log("\n=== SETTLEMENTS ===");
      console.log(settRes.rows);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
