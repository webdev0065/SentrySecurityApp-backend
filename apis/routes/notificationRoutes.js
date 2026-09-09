const express = require('express');
const router = express.Router();
const Notification = require('../../data/models/Notification');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.findForRole(req.user.account_type, req.query.status);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/notifications/unread-count', authMiddleware, async (req, res) => {
  try {
    const count = await Notification.countUnreadForRole(req.user.account_type);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/notifications/:id/read', authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.markAsRead(req.params.id, req.user.account_type);
    if (!notification) return res.status(404).json({ error: 'Not found' });
    res.json(notification);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    await Notification.markAllAsRead(req.user.account_type);
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/notifications/:id', authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.deleteById(req.params.id, req.user.account_type);
    if (!notification) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, message: 'Notification deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
