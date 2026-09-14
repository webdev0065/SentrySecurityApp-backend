const express = require('express');
const router = express.Router();
const Notification = require('../../data/models/Notification');
const Agency = require('../../data/models/Agency');
const authMiddleware = require('../middleware/authMiddleware');

const getRecipientId = async user => {
  if (user.account_type !== 'agency') return null;
  const agency = await Agency.findByUserId(user.id);
  return agency?.id ?? null;
};

// router.get('/notifications', authMiddleware, async (req, res) => {
//   try {
//     const notifications = await Notification.findForRole(req.user.account_type, req.query.status);
//     res.json(notifications);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const recipientId = await getRecipientId(req.user);
    const notifications = await Notification.findForRole(
      req.user.account_type,
      req.query.status,
      recipientId,
    );
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/notifications/unread-count', authMiddleware, async (req, res) => {
  try {
    const recipientId = await getRecipientId(req.user);
    const count = await Notification.countUnreadForRole(
      req.user.account_type,
      recipientId,
    );
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/notifications/:id/read', authMiddleware, async (req, res) => {
  try {
    const recipientId = await getRecipientId(req.user);
    const notification = await Notification.markAsRead(
      req.params.id,
      req.user.account_type,
      recipientId,
    );
    if (!notification) return res.status(404).json({ error: 'Not found' });
    res.json(notification);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    const recipientId = await getRecipientId(req.user);
    await Notification.markAllAsRead(req.user.account_type, recipientId);
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/notifications/:id', authMiddleware, async (req, res) => {
  try {
    const recipientId = await getRecipientId(req.user);
    const notification = await Notification.deleteById(
      req.params.id,
      req.user.account_type,
      recipientId,
    );
    if (!notification) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, message: 'Notification deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
