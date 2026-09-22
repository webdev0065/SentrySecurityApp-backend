const pool = require('../../db');

class Plan {
  static async findAll() {
    const result = await pool.query(`SELECT * FROM plans ORDER BY price ASC`);
    return result.rows;
  }

  static async findByName(name) {
    const result = await pool.query(`SELECT * FROM plans WHERE name = $1`, [name]);
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`SELECT * FROM plans WHERE id = $1`, [id]);
    return result.rows[0];
  }
}

module.exports = Plan;