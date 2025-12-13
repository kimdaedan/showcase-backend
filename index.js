const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg'); // Gunakan library pg langsung
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// === 1. KONFIGURASI DATABASE POSTGRESQL ===
const pool = new Pool({
  user: 'postgres',         // Ganti dengan username postgres Anda
  host: 'localhost',
  database: 'nama_db_anda', // Ganti dengan nama database Anda
  password: 'password_anda',// Ganti dengan password postgres Anda
  port: 5432,
});

// Cek koneksi DB saat server start
pool.connect((err) => {
  if (err) console.error('❌ Koneksi Database Gagal:', err.stack);
  else console.log('✅ Terhubung ke Database PostgreSQL');
});

// === 2. MIDDLEWARE ===
app.use(cors());
app.use(express.json());
// Pastikan folder uploads bisa diakses publik untuk gambar
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// === 3. RUTE AUTH (REGISTER) ===
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, major } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Data tidak lengkap' });
    }

    const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Email sudah terdaftar' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const newUser = await pool.query(
      'INSERT INTO users (name, email, password_hash, major) VALUES ($1, $2, $3, $4) RETURNING id, name, email, major, role',
      [name, email, passwordHash, major]
    );

    res.status(201).json({
      message: 'Registrasi berhasil',
      user: newUser.rows[0]
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// === 4. RUTE AUTH (LOGIN) ===
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(400).json({ message: 'Email atau password salah' });
    }

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: 'Email atau password salah' });
    }

    const payload = {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET || 'rahasia', { expiresIn: '1h' });

    res.json({
      message: 'Login berhasil',
      token: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// === 5. RUTE PROJECTS (KHUSUS UNTUK TABEL "Karya") ===
// Saya menimpa route ini di sini agar Mapping Kolom (Aliasing) bekerja
app.get('/api/projects', async (req, res) => {
  try {
    // PENTING: Aliasing kolom agar sesuai dengan Frontend React
    const sql = `
      SELECT
        id,
        title,
        description,
        nama_ketua,
        nim AS nim_ketua,           -- DB: nim -> Front: nim_ketua
        upload_type AS karya_type,  -- DB: upload_type -> Front: karya_type
        file_path AS karya_url,     -- DB: file_path -> Front: karya_url
        status,
        prodi
      FROM "Karya"                  -- Gunakan Tanda Kutip karena tabel Case Sensitive
    `;

    const result = await pool.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error pada Project');
  }
});

// === 6. RUTE KOMENTAR (FIXED FOR POSTGRESQL) ===

// Ambil Komentar
app.get('/api/comments/:projectId', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    // Gunakan $1 bukan ?
    const sql = 'SELECT * FROM comments WHERE project_id = $1 ORDER BY created_at DESC';
    const result = await pool.query(sql, [projectId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

// Kirim Komentar
app.post('/api/comments', async (req, res) => {
  try {
    const { project_id, user_name, comment, rating } = req.body;

    if (!project_id || !user_name || !comment || !rating) {
      return res.status(400).json({ message: 'Semua data harus diisi!' });
    }

    // Gunakan $1, $2.. dan RETURNING id
    const sql = 'INSERT INTO comments (project_id, user_name, comment, rating) VALUES ($1, $2, $3, $4) RETURNING id';

    const result = await pool.query(sql, [project_id, user_name, comment, rating]);

    res.json({ message: 'Komentar berhasil dikirim!', id: result.rows[0].id });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

// === 7. JALANKAN SERVER ===
app.listen(port, () => {
  console.log(`🚀 Server backend berjalan di http://localhost:${port}`);
});