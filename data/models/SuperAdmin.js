const pool = require('../../db');
const bcrypt = require('bcrypt');

class SuperAdmin {
  static async findByAccountId(account_id) {
    const result = await pool.query(
      'SELECT * FROM super_admins WHERE account_id = $1',
      [account_id]
    );
    return result.rows[0];
  }

  static async findByEmail(email) {
    const result = await pool.query(
      'SELECT * FROM super_admins WHERE email = $1',
      [email]
    );
    return result.rows[0];
  }

  static async create({ account_id, full_name, mobile_number, email, password }) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO super_admins (account_id, full_name, mobile_number, email, password) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, account_id, full_name, mobile_number, email, created_at`,
      [account_id, full_name, mobile_number, email, hashedPassword]
    );
    return result.rows[0];
  }

  static async updateProfile(id, { full_name, email, mobile_number }) {
    const result = await pool.query(
      `UPDATE super_admins SET full_name = $1, email = $2, mobile_number = $3, updated_at = NOW() 
       WHERE id = $4 RETURNING id, account_id, full_name, email, mobile_number`,
      [full_name, email, mobile_number, id]
    );
    return result.rows[0];
  }

  static async updateProfilePhoto(id, photoPath) {
    const result = await pool.query(
      `UPDATE super_admins SET profile_photo = $1, updated_at = NOW() WHERE id = $2 RETURNING id, profile_photo`,
      [photoPath, id]
    );
    return result.rows[0];
  }
}

module.exports = SuperAdmin;