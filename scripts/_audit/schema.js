const { pool } = require('../../db');

(async () => {
  const cols = await pool.query(`
    select table_name, column_name, data_type, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale
    from information_schema.columns where table_schema='public'
    order by table_name, ordinal_position`);
  let cur = '';
  for (const r of cols.rows) {
    if (r.table_name !== cur) { cur = r.table_name; console.log('\n## ' + cur); }
    let t = r.data_type;
    if (r.character_maximum_length) t += `(${r.character_maximum_length})`;
    if (r.numeric_precision && r.data_type === 'numeric') t += `(${r.numeric_precision},${r.numeric_scale})`;
    console.log(`  ${r.column_name.padEnd(34)} ${t.padEnd(24)} null=${r.is_nullable.padEnd(3)} def=${r.column_default || ''}`);
  }

  const cons = await pool.query(`
    select tc.table_name, tc.constraint_type, tc.constraint_name, kcu.column_name, ccu.table_name fk_table, ccu.column_name fk_col
    from information_schema.table_constraints tc
    left join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name and kcu.table_schema=tc.table_schema
    left join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name and ccu.table_schema=tc.table_schema
    where tc.table_schema='public' and tc.constraint_type in ('PRIMARY KEY','UNIQUE','FOREIGN KEY','CHECK')
    order by tc.table_name, tc.constraint_type`);
  console.log('\n\n=== CONSTRAINTS ===');
  for (const r of cons.rows) {
    console.log(`${r.table_name} | ${r.constraint_type} | ${r.constraint_name} | ${r.column_name || ''} -> ${r.fk_table || ''}.${r.fk_col || ''}`);
  }

  const idx = await pool.query(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' order by tablename, indexname`);
  console.log('\n\n=== INDEXES ===');
  for (const r of idx.rows) console.log(`${r.tablename} | ${r.indexname} | ${r.indexdef}`);

  const rls = await pool.query(`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by relname`);
  console.log('\n\n=== RLS ===');
  for (const r of rls.rows) console.log(`${r.relname} rls=${r.relrowsecurity}`);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
