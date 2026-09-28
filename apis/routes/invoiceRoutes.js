const express = require('express');
const router = express.Router();
const Invoice = require('../../data/models/Invoice');
const Notification = require('../../data/models/Notification');
const verifyToken = require('../middleware/authMiddleware');

const VALID_STATUSES = ['pending', 'paid', 'overdue'];

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

router.use(verifyToken);

router.use((req, res, next) => {
  if (req.user.account_type !== 'agency') {
    return res.status(403).json({ success: false, message: 'Agency access is required' });
  }
  next();
});

router.get('/invoices/clients', async (req, res) => {
  try {
    const clients = await Invoice.findClientsWithSummary(req.user.id);
    return res.status(200).json({ success: true, data: clients });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/invoices/clients/:clientId/summary', async (req, res) => {
  try {
    const summary = await Invoice.getClientSummary(req.user.id, req.params.clientId);
    if (!summary) {
      return res.status(404).json({ success: false, message: 'Client not found for this agency' });
    }
    return res.status(200).json({ success: true, data: summary });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/invoices', async (req, res) => {
  try {
    const { clientId, amount, description, dueDate } = req.body;

    if (!clientId || amount == null || !dueDate) {
      return res.status(400).json({ success: false, message: 'clientId, amount and dueDate are required' });
    }
    if (isNaN(amount) || Number(amount) <= 0 || Number(amount) > 99999999.99) {
      return res.status(400).json({ success: false, message: 'amount must be a positive number' });
    }
    if (!isValidDate(dueDate)) {
      return res.status(400).json({ success: false, message: 'dueDate must be a valid date in YYYY-MM-DD format' });
    }
    if (dueDate < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ success: false, message: 'dueDate cannot be in the past' });
    }

    const client = await Invoice.getClientSummary(req.user.id, clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found for this agency' });
    }

    const invoice = await Invoice.create({
      agencyId: req.user.id,
      clientId: client.client_id,
      amount: Number(amount),
      description: description ? String(description).trim() : null,
      dueDate,
    });

    try {
      await Notification.createForRecipient({
        recipientId: client.user_id,
        recipientType: 'client',
        type: 'invoice',
        targetRole: 'client',
        title: 'New Invoice Received',
        message: `Invoice of Rs ${Number(amount)} for ${client.site_name} is due on ${dueDate}.`,
        referenceType: 'invoice',
        referenceId: invoice.id,
      });
    } catch (notifyErr) {
      console.error('Invoice notification failed:', notifyErr.message);
    }

    return res.status(201).json({
      success: true,
      data: {
        ...invoice,
        invoice_code: `INV-${invoice.id}`,
        client_name: client.client_name,
        site_name: client.site_name,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/invoices', async (req, res) => {
  try {
    const { status } = req.query;
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be pending, paid or overdue' });
    }
    const invoices = await Invoice.findByAgencyId(req.user.id, status || null);
    const data = invoices.map(i => ({ ...i, invoice_code: `INV-${i.id}` }));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.patch('/invoices/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be pending, paid or overdue' });
    }
    const invoice = await Invoice.updateStatus(req.params.id, req.user.id, status);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    return res.status(200).json({ success: true, data: { ...invoice, invoice_code: `INV-${invoice.id}` } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;