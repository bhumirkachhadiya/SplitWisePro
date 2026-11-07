require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('--- Starting DB Migration ---');

    // 1. Add lock columns to groups
    await client.query(`
      ALTER TABLE groups 
      ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS locked_by INT;
    `);
    console.log('✓ Added lock columns to groups table');

    // 2. Check and seed missing custom_email_templates
    const existingRes = await client.query(`SELECT template_type FROM custom_email_templates`);
    const existingTypes = new Set(existingRes.rows.map(r => r.template_type));
    console.log('Existing templates in DB:', Array.from(existingTypes));

    const defaultTemplates = [
      {
        type: 'signup_otp',
        subject: 'Your SplitWise Verification Code: {{otp}}',
        body_text: 'Hi {{user_name}},\n\nYour SplitWise verification OTP is: {{otp}}\nValid for 10 minutes.',
        body_html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #4F46E5;">Welcome to SplitWise!</h2>
          <p>Hi {{user_name}},</p>
          <p>Thank you for signing up. Please use the following One-Time Password (OTP) to verify your email address:</p>
          <div style="background: #EEF2FF; padding: 15px; border-radius: 6px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #4F46E5; margin: 20px 0;">
            {{otp}}
          </div>
          <p>This OTP is valid for 10 minutes. If you did not request this, please ignore this email.</p>
          <p style="color: #6B7280; font-size: 12px; margin-top: 30px;">Best regards,<br>The SplitWise Team</p>
        </div>`
      },
      {
        type: 'reset_otp',
        subject: 'Reset Your SplitWise Password: {{otp}}',
        body_text: 'Hi {{user_name}},\n\nYour password reset code is: {{otp}}\nValid for 10 minutes.',
        body_html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #DC2626;">Password Reset Request</h2>
          <p>Hi {{user_name}},</p>
          <p>We received a request to reset your SplitWise account password. Use the verification code below to proceed:</p>
          <div style="background: #FEF2F2; padding: 15px; border-radius: 6px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #DC2626; margin: 20px 0;">
            {{otp}}
          </div>
          <p>This code expires in 10 minutes. If you did not make this request, your account remains secure and you can disregard this email.</p>
          <p style="color: #6B7280; font-size: 12px; margin-top: 30px;">Best regards,<br>The SplitWise Team</p>
        </div>`
      },
      {
        type: 'settlement_receipt',
        subject: 'Payment Settled: {{amount}} from {{payer_name}} to {{receiver_name}}',
        body_text: 'Hi {{user_name}},\n\nA settlement of {{amount}} was recorded between {{payer_name}} and {{receiver_name}}.',
        body_html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #059669;">Payment Recorded Successfully</h2>
          <p>Hi {{user_name}},</p>
          <p>A settlement has been recorded between <strong>{{payer_name}}</strong> and <strong>{{receiver_name}}</strong>.</p>
          <div style="background: #ECFDF5; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 4px 0;"><strong>Amount:</strong> {{amount}}</p>
            <p style="margin: 4px 0;"><strong>Settlement Method:</strong> {{method}}</p>
            <p style="margin: 4px 0;"><strong>Circle:</strong> {{group_name}}</p>
            <p style="margin: 4px 0;"><strong>Date:</strong> {{date}}</p>
          </div>
          <p>Balances across the circle have been updated accordingly.</p>
          <p style="color: #6B7280; font-size: 12px; margin-top: 30px;">Best regards,<br>The SplitWise Team</p>
        </div>`
      },
      {
        type: 'friend_invite',
        subject: '{{inviter_name}} invited you to connect on SplitWise',
        body_text: 'Hi {{user_name}},\n\n{{inviter_name}} ({{inviter_email}}) wants to connect with you on SplitWise.',
        body_html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #4F46E5;">New Connection Request</h2>
          <p>Hi {{user_name}},</p>
          <p><strong>{{inviter_name}}</strong> ({{inviter_email}}) wants to connect with you on SplitWise to easily split bills and track shared expenses.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="{{app_url}}" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Open SplitWise</a>
          </div>
          <p style="color: #6B7280; font-size: 12px; margin-top: 30px;">Best regards,<br>The SplitWise Team</p>
        </div>`
      }
    ];

    for (const tpl of defaultTemplates) {
      if (!existingTypes.has(tpl.type)) {
        await client.query(`
          INSERT INTO custom_email_templates (template_type, subject, body_text, body_html, updated_at)
          VALUES ($1, $2, $3, $4, NOW())
        `, [tpl.type, tpl.subject, tpl.body_text, tpl.body_html]);
        console.log(`✓ Inserted missing template: ${tpl.type}`);
      } else {
        console.log(`- Template already present: ${tpl.type}`);
      }
    }

    // 3. Performance Indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_expense_splits_exp_user ON expense_splits(expense_id, user_id);',
      'CREATE INDEX IF NOT EXISTS idx_expenses_group_id ON expenses(group_id);',
      'CREATE INDEX IF NOT EXISTS idx_settlements_payer_rec ON settlements(payer_id, receiver_id);',
      'CREATE INDEX IF NOT EXISTS idx_settlements_group ON settlements(group_id);',
      'CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id, created_at DESC);',
      'CREATE INDEX IF NOT EXISTS idx_group_members_user_group ON group_members(user_id, group_id);',
      'CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, created_at ASC);'
    ];

    for (const idx of indexes) {
      await client.query(idx);
    }
    console.log('✓ Created all performance indexes');

    console.log('--- Migration Completed Successfully ---');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
