const jwt = require('jsonwebtoken');

module.exports = async function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.account_type === 'agency') {
      const pool = require('../../db');
      const result = await pool.query('SELECT status FROM agencies WHERE user_id = $1', [decoded.id]);
      const creatingDetails = req.method === 'POST' && req.path === '/agency/details' && !result.rows.length;
      if (!creatingDetails && result.rows[0]?.status !== 'approved') {
        return res.status(403).json({ error: 'Your agency account requires Super Admin approval.', code: 'AGENCY_APPROVAL_REQUIRED' });
      }
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
