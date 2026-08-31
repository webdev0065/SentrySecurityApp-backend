const pool = require('../../db');
const bcrypt = require('bcrypt');

class User {
  static async findByEmailOrMobile(email, mobile_number) {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR mobile_number = $2',
      [email, mobile_number]
    );
    return result.rows[0];
  }

  static async create({ full_name, mobile_number, email, password, account_type }) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (full_name, mobile_number, email, password, account_type) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, account_type, created_at`,
      [full_name, mobile_number, email, hashedPassword, account_type]
    );
    return result.rows[0];
  }

  static async findByEmail(email) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
  }

  static async findByEmailOrMobileForLogin(identifier) {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR mobile_number = $1',
      [identifier]
    );
    return result.rows[0];
  }

  static async setOtp(identifier, otp, expiry) {
    const result = await pool.query(
      `UPDATE users SET otp = $1, otp_expiry = $2 
       WHERE email = $3 OR mobile_number = $3 RETURNING id`,
      [otp, expiry, identifier]
    );
    return result.rows[0];
  }

  static async verifyOtp(identifier, otp) {
    const result = await pool.query(
      `SELECT * FROM users 
       WHERE (email = $1 OR mobile_number = $1) AND otp = $2 AND otp_expiry > NOW()`,
      [identifier, otp]
    );
    return result.rows[0];
  }

  static async resetPassword(identifier, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      `UPDATE users SET password = $1, otp = NULL, otp_expiry = NULL 
       WHERE email = $2 OR mobile_number = $2 RETURNING id`,
      [hashedPassword, identifier]
    );
    return result.rows[0];
  }

  // ===== NAYE METHODS (Firebase OTP ke liye) =====
  static async findByPhoneNumber(mobile_number) {
    const result = await pool.query(
      'SELECT * FROM users WHERE mobile_number = $1',
      [mobile_number]
    );
    return result.rows[0];
  }

  static async createFromPhone(mobile_number) {
    const randomPassword = await bcrypt.hash(Math.random().toString(36), 10);
    const placeholderEmail = `${mobile_number}@placeholder.com`;

    const result = await pool.query(
      `INSERT INTO users (full_name, mobile_number, email, password, account_type) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, full_name, mobile_number, email, account_type, created_at`,
      ['New User', mobile_number, placeholderEmail, randomPassword, 'client']
    );

    return result.rows[0];
  }
}

module.exports = User;