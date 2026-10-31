const express = require('express');
const { requireRole } = require('../middleware/auth');

function mapBilling(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    card_holder_name: row.card_holder_name,
    card_last4: row.card_last4,
    expiry_date: row.expiry_date,
    billing_address: row.billing_address
  };
}

function createBillingRouter(db) {
  const router = express.Router();
  const requireAdmin = requireRole('ADMIN');

  router.get('/', requireAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT id, user_id, card_holder_name, card_last4, expiry_date, billing_address
         FROM billing_details WHERE tenant_id = $1 ORDER BY id`,
        [req.auth.tenantId]
      );
      return res.json(rows.map(mapBilling));
    } catch (error) {
      console.error('Billing list query failed:', error);
      return res.status(500).json({ error: 'Failed to retrieve billing details.' });
    }
  });

  router.get('/:id', requireAdmin, async (req, res) => {
    const billingId = Number(req.params.id);
    if (!Number.isSafeInteger(billingId) || billingId < 1) {
      return res.status(400).json({ error: 'Billing ID must be a positive integer.' });
    }

    try {
      const { rows } = await db.query(
        `SELECT id, user_id, card_holder_name, card_last4, expiry_date, billing_address
         FROM billing_details WHERE tenant_id = $1 AND id = $2`,
        [req.auth.tenantId, billingId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Billing record not found.' });
      }
      return res.json(mapBilling(rows[0]));
    } catch (error) {
      console.error('Billing lookup query failed:', error);
      return res.status(500).json({ error: 'Failed to retrieve billing details.' });
    }
  });

  return router;
}

module.exports = createBillingRouter;
