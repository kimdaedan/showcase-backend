const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Agar aman, kita definisikan satu variabel kunci di sini
// Jadi Login dan Middleware pasti pakai kunci yang SAMA
const JWT_SECRET_KEY = process.env.JWT_SECRET || 'INI_ADALAH_KUNCI_RAHASIA_SAYA_YANG_SANGAT_PANJANG';

// === 1. KONFIGURASI DATABASE POSTGRESQL ===
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'showcase_db',
  password: 'ineedmoney7236',
  port: 5432,
});

// Cek koneksi DB
pool.connect((err) => {
  if (err) console.error('❌ Koneksi Database Gagal:', err.stack);
  else console.log('✅ Terhubung ke Database PostgreSQL');
});

// === 2. KONFIGURASI UPLOAD (MULTER) ===
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });


// === 3. MIDDLEWARE ===
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Middleware Cek Token (PERBAIKAN KUNCI RAHASIA)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  console.log("🔍 [DEBUG] Auth Header:", authHeader); // Debugging

  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log("❌ [DEBUG] Token kosong");
    return res.status(401).json({ message: 'Akses ditolak: Token kosong' });
  }

  // [PERBAIKAN] Gunakan konstanta JWT_SECRET_KEY yang sama dengan Login
  jwt.verify(token, JWT_SECRET_KEY, (err, user) => {
    if (err) {
      console.error("❌ [DEBUG] Gagal Verifikasi JWT:", err.message);
      return res.status(403).json({ message: 'Token tidak valid', error: err.message });
    }

    console.log("✅ [DEBUG] Token Valid. User:", user.user.name);
    req.user = user;
    next();
  });
};

// === 4. RUTE AUTH ===
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, major } = req.body;
    if (!email || !password || !name) return res.status(400).json({ message: 'Data tidak lengkap' });

    const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) return res.status(400).json({ message: 'Email sudah terdaftar' });

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const newUser = await pool.query(
      'INSERT INTO users (name, email, password_hash, major) VALUES ($1, $2, $3, $4) RETURNING id, name, email, major, role',
      [name, email, passwordHash, major]
    );
    res.status(201).json({ message: 'Registrasi berhasil', user: newUser.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) return res.status(400).json({ message: 'Email atau password salah' });

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(400).json({ message: 'Email atau password salah' });

    const payload = { user: { id: user.id, email: user.email, name: user.name, role: user.role } };

    // [PERBAIKAN] Gunakan konstanta JWT_SECRET_KEY & Durasi 24 Jam biar gak cepat expired
    const token = jwt.sign(payload, JWT_SECRET_KEY, { expiresIn: '24h' });

    res.json({ message: 'Login berhasil', token: token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});


// === 5. RUTE PROJECTS ===
app.get('/api/projects', async (req, res) => {
  try {
    const sql = `
      SELECT id, title, description, nama_ketua, nim_ketua, karya_type, karya_url, status, prodi
      FROM projects
    `;
    const result = await pool.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error pada Project');
  }
});

app.post('/api/projects', authenticateToken, upload.single('karyaFile'), async (req, res) => {
  try {
    const { title, description, nama_ketua, nim_ketua, prodi, youtube_link } = req.body;

    let karya_type = 'IMAGE';
    let karya_url = '';

    if (req.file) {
        karya_type = 'IMAGE';
        karya_url = `uploads/${req.file.filename}`;
    } else if (youtube_link) {
        karya_type = 'YOUTUBE';
        karya_url = youtube_link;
    } else {
        return res.status(400).json({ message: 'File atau Link YouTube wajib diisi' });
    }

    const status = 'PENDING';
    const userId = req.user.user.id;

    const sql = `
      INSERT INTO projects (title, description, nama_ketua, nim_ketua, prodi, karya_type, karya_url, status, user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [title, description, nama_ketua, nim_ketua, prodi, karya_type, karya_url, status, userId];

    const newProject = await pool.query(sql, values);

    res.status(201).json({ message: 'Project berhasil diupload!', project: newProject.rows[0] });

  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ message: 'Gagal mengupload project', error: err.message });
  }
});


// === 6. RUTE KOMENTAR ===
app.get('/api/comments/:projectId', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const sql = 'SELECT * FROM comments WHERE project_id = $1 ORDER BY created_at DESC';
    const result = await pool.query(sql, [projectId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/comments', async (req, res) => {
  try {
    const { project_id, user_name, comment, rating } = req.body;
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