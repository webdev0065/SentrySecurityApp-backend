const pool = require('../../db');

class Agency {
  static async create({
    userId,
    agencyName,
    businessType,
    gstNumber,
    officeAddress,
    city,
    state,
    district,
    pincode,
  }) {
    const result = await pool.query(
      `INSERT INTO agencies (user_id, agency_name, business_type, gst_number, office_address, city, state, district, pincode, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending') RETURNING *`,
      [
        userId,
        agencyName,
        businessType,
        gstNumber,
        officeAddress,
        city,
        state,
        district,
        pincode,
      ],
    );
    return result.rows[0];
  }
  static async updateProfilePhoto(userId, photoUrl) {
    const result = await pool.query(
      `UPDATE agencies SET profile_photo_url = $1 WHERE user_id = $2 RETURNING *`,
      [photoUrl, userId],
    );
    return result.rows[0];
  }
  static async isApprovedForDistrict(agencyId, district) {
    const result = await pool.query(
      `SELECT id FROM agencies WHERE id = $1 AND district = $2 AND status = 'approved'`,
      [agencyId, district],
    );
    return result.rows.length > 0;
  }

  static async update(
    userId,
    {
      agencyName,
      businessType,
      gstNumber,
      officeAddress,
      city,
      state,
      district,
      pincode,
      fullName,
      email,
      mobileNumber,
    },
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const agencyResult = await client.query(
        `UPDATE agencies
         SET agency_name = $1, business_type = $2, gst_number = $3, office_address = $4,
             city = $5, state = $6, district = $7, pincode = $8
         WHERE user_id = $9 RETURNING *`,
        [
          agencyName,
          businessType,
          gstNumber,
          officeAddress,
          city,
          state,
          district,
          pincode,
          userId,
        ],
      );
      if (!agencyResult.rows[0]) {
        await client.query('ROLLBACK');
        return undefined;
      }
      await client.query(
        `UPDATE users
         SET full_name = $1, email = $2, mobile_number = $3
         WHERE id = $4`,
        [fullName, email, mobileNumber, userId],
      );
      await client.query('COMMIT');
      return {
        ...agencyResult.rows[0],
        full_name: fullName,
        email,
        mobile_number: mobileNumber,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  static async findByUserId(userId) {
    const result = await pool.query(
      `SELECT a.*, u.full_name, u.email, u.mobile_number
       FROM agencies a
       JOIN users u ON u.id = a.user_id
       WHERE a.user_id = $1`,
      [userId],
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(
      `SELECT a.*, u.full_name, u.email, u.mobile_number
       FROM agencies a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = $1`,
      [id],
    );
    return result.rows[0];
  }

  static async findPublicApprovedById(id) {
    const result = await pool.query(
      `SELECT id, agency_name, business_type, gst_number, office_address,
              city, state, district, pincode
       FROM agencies
       WHERE id = $1 AND status = 'approved'`,
      [id],
    );
    return result.rows[0];
  }

  static async findAll({ status } = {}) {
    if (status) {
      const result = await pool.query(
        `SELECT a.*, u.full_name, u.email, u.mobile_number
         FROM agencies a
         JOIN users u ON u.id = a.user_id
         WHERE a.status = $1
         ORDER BY a.created_at DESC`,
        [status],
      );
      return result.rows;
    }
    const result = await pool.query(
      `SELECT a.*, u.full_name, u.email, u.mobile_number
       FROM agencies a
       JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC`,
    );
    return result.rows;
  }

  static async findApprovedByDistrict(district) {
    const result = await pool.query(
      `SELECT id, agency_name, business_type, city, state, district
       FROM agencies
       WHERE status = 'approved'
         AND LOWER(TRIM(district)) = LOWER(TRIM($1))
       ORDER BY agency_name ASC`,
      [district],
    );
    return result.rows;
  }

  static async updateStatus(id, status) {
    const result = await pool.query(
      `UPDATE agencies SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id],
    );
    return result.rows[0];
  }

  static async deleteById(id) {
    const result = await pool.query(
      `DELETE FROM agencies WHERE id = $1 RETURNING *`,
      [id],
    );
    return result.rows[0];
  }
}

module.exports = Agency;
