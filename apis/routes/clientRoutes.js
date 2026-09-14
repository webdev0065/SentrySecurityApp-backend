const express = require('express');
const router = express.Router();
const Client = require('../../data/models/Client');
const ClientRating = require('../../data/models/ClientRating');
const pool = require('../../db');
const verifyToken = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const avatarDir = path.join(__dirname, '../../uploads/clients/avatars');
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarDir),
  filename: (req, file, cb) => {
    cb(null, `${req.user.id}_${Date.now()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only image files allowed'), ok);
  },
});

router.post('/client/details', verifyToken, async (req, res) => {
  try {
    const { companyName, siteName, siteAddress, city, state, pincode } =
      req.body;

    if (
      !companyName ||
      !siteName ||
      !siteAddress ||
      !city ||
      !state ||
      !pincode
    ) {
      return res
        .status(400)
        .json({ success: false, message: 'Missing required fields' });
    }

    if (!/^\d{6}$/.test(pincode)) {
      return res
        .status(400)
        .json({ success: false, message: 'Pincode must be 6 digits' });
    }

    const client = await Client.create({
      userId: req.user.id,
      companyName,
      siteName,
      siteAddress,
      city,
      state,
      pincode,
    });

    return res.status(201).json({ success: true, data: client });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.patch(
  '/client/avatar',
  verifyToken,
  upload.single('avatar'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: 'No image uploaded' });
      }
      const avatarUrl = `/uploads/clients/avatars/${req.file.filename}`;
      const updated = await Client.updateAvatar(req.user.id, avatarUrl);
      if (!updated) {
        return res
          .status(404)
          .json({ success: false, message: 'Client not found' });
      }
      return res.status(200).json({ success: true, data: updated });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  },
);
router.patch(
  '/client/avatar',
  verifyToken,
  (req, res, next) => {
    upload.single('avatar')(req, res, err => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, message: err.message });
      } else if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: 'No image uploaded' });
      }
      const avatarUrl = `/uploads/clients/avatars/${req.file.filename}`;
      const updated = await Client.updateAvatar(req.user.id, avatarUrl);
      if (!updated) {
        return res
          .status(404)
          .json({ success: false, message: 'Client not found' });
      }
      return res.status(200).json({ success: true, data: updated });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  },
);
router.get('/client/details', verifyToken, async (req, res) => {
  try {
    const client = await Client.findByUserId(req.user.id);
    if (!client) {
      return res
        .status(404)
        .json({ success: false, message: 'Client details not found' });
    }
    return res.status(200).json({ success: true, data: client });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});
router.patch('/client/details', verifyToken, async (req, res) => {
  try {
    const { companyName, siteName, siteAddress, city, state, pincode } =
      req.body;

    const updates = {};
    if (companyName !== undefined) updates.companyName = companyName;
    if (siteName !== undefined) updates.siteName = siteName;
    if (siteAddress !== undefined) updates.siteAddress = siteAddress;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    if (pincode !== undefined) updates.pincode = pincode;

    if (Object.keys(updates).length === 0) {
      return res
        .status(400)
        .json({ success: false, message: 'No fields provided to update' });
    }

    if (updates.pincode !== undefined && !/^\d{6}$/.test(updates.pincode)) {
      return res
        .status(400)
        .json({ success: false, message: 'Pincode must be 6 digits' });
    }

    const updated = await Client.updateDetails(req.user.id, updates);
    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: 'Client not found' });
    }

    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

async function getAuthorizedClientAgency(req, res, agencyId) {
  const client = await Client.findByUserId(req.user.id);
  if (!client) {
    res.status(404).json({ success: false, message: 'Client not found' });
    return null;
  }
  const access = await pool.query(
    `SELECT 1 FROM coverage_requests
     WHERE client_id = $1
       AND status IN ('approved', 'assigned', 'completed')
       AND (selected_agency_id = $2 OR assigned_agency_id = $2)
     LIMIT 1`,
    [client.id, agencyId],
  );
  if (!access.rows.length) {
    res.status(403).json({ success: false, message: 'Agency access denied' });
    return null;
  }
  return client;
}

router.get(
  '/client/agencies/:agencyId/guards',
  verifyToken,
  async (req, res) => {
    try {
      const agencyId = Number(req.params.agencyId);
      const client = await getAuthorizedClientAgency(req, res, agencyId);
      if (!client) return;
      const guards = await pool.query(
        `SELECT DISTINCT ON (g.id)
         g.id,
         CONCAT('SG-', g.id) AS guard_code,
         u.full_name,
         g.status,
         s.site_name,
         ROUND(AVG(all_ratings.rating)::numeric, 1) AS average_rating,
         COUNT(all_ratings.id)::int AS rating_count,
         MAX(own_rating.rating) AS client_rating,
         MAX(own_rating.comment) AS client_comment
       FROM coverage_requests cr
       JOIN sites s ON s.source_coverage_request_id = cr.id
       JOIN guards g ON g.site_id = s.id
       JOIN users u ON u.id = g.user_id
       LEFT JOIN client_ratings all_ratings ON all_ratings.guard_id = g.id
       LEFT JOIN client_ratings own_rating
         ON own_rating.guard_id = g.id AND own_rating.client_id = $1
       WHERE cr.client_id = $1
         AND (cr.selected_agency_id = $2 OR cr.assigned_agency_id = $2)
         AND cr.status IN ('approved', 'assigned', 'completed')
       GROUP BY g.id, u.full_name, g.status, s.site_name
       ORDER BY g.id, s.site_name`,
        [client.id, agencyId],
      );
      const agencyRating = await ClientRating.findAgencySummary(
        client.id,
        agencyId,
      );
      return res.json({
        success: true,
        data: { guards: guards.rows, agencyRating },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  },
);

router.put(
  '/client/agencies/:agencyId/rating',
  verifyToken,
  async (req, res) => {
    try {
      const agencyId = Number(req.params.agencyId);
      const client = await getAuthorizedClientAgency(req, res, agencyId);
      if (!client) return;
      const rating = Number(req.body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res
          .status(400)
          .json({ success: false, message: 'Rating must be between 1 and 5' });
      }
      const saved = await ClientRating.upsertAgency({
        clientId: client.id,
        agencyId,
        rating,
        comment: String(req.body.comment || '').trim(),
      });
      return res.json({ success: true, data: saved });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  },
);

router.put('/client/guards/:guardId/rating', verifyToken, async (req, res) => {
  try {
    const guardId = Number(req.params.guardId);
    const guard = await pool.query(
      `SELECT a.id AS agency_id
       FROM guards g
       JOIN agencies a ON a.user_id = g.agency_id
       WHERE g.id = $1`,
      [guardId],
    );
    if (!guard.rows[0]) {
      return res
        .status(404)
        .json({ success: false, message: 'Guard not found' });
    }
    const agencyId = guard.rows[0].agency_id;
    const client = await getAuthorizedClientAgency(req, res, agencyId);
    if (!client) return;
    const assigned = await pool.query(
      `SELECT 1
       FROM guards g
       JOIN sites s ON s.id = g.site_id
       JOIN coverage_requests cr ON cr.id = s.source_coverage_request_id
       WHERE g.id = $1 AND cr.client_id = $2
       LIMIT 1`,
      [guardId, client.id],
    );
    if (!assigned.rows.length) {
      return res
        .status(403)
        .json({
          success: false,
          message: 'Guard is not assigned to your site',
        });
    }
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res
        .status(400)
        .json({ success: false, message: 'Rating must be between 1 and 5' });
    }
    const saved = await ClientRating.upsertGuard({
      clientId: client.id,
      agencyId,
      guardId,
      rating,
      comment: String(req.body.comment || '').trim(),
    });
    return res.json({ success: true, data: saved });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});
module.exports = router;
