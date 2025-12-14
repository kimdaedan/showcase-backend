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

// Kunci Rahasia JWT
const JWT_SECRET_KEY = process.env.JWT_SECRET || 'INI_ADALAH_KUNCI_RAHASIA_SAYA_YANG_SANGAT_PANJANG';

// === 1. KONFIGURASI DATABASE POSTGRESQL ===
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'showcase_db',
  password: 'ineedmoney7236',
  port: 5432,
});

pool.connect((err) => {
  if (err) console.error('❌ Koneksi Database Gagal:', err.stack);
  else console.log('✅ Terhubung ke Database PostgreSQL');
});

// === 2. KONFIGURASI UPLOAD ===
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
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

// Middleware Auth
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Akses ditolak: Token kosong' });

  jwt.verify(token, JWT_SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ message: 'Token tidak valid' });
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

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await pool.query(
      'INSERT INTO users (name, email, password_hash, major) VALUES ($1, $2, $3, $4) RETURNING id, name, email, major, role',
      [name, email, passwordHash, major]
    );
    res.status(201).json({ message: 'Registrasi berhasil', user: newUser.rows[0] });
  } catch (err) {
    console.error(err); res.status(500).send('Server error');
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
    const token = jwt.sign(payload, JWT_SECRET_KEY, { expiresIn: '24h' });

    res.json({ message: 'Login berhasil', token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err); res.status(500).send('Server error');
  }
});

// === 5. RUTE PROJECTS ===

// GET ALL
app.get('/api/projects', async (req, res) => {
  try {
    // Order by ID descending agar yang baru diupload muncul paling atas
    const sql = `SELECT * FROM projects ORDER BY id DESC`;
    const result = await pool.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error(err); res.status(500).send('Server Error');
  }
});

// POST (UPLOAD)
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
      return res.status(400).json({ message: 'File atau Link wajib diisi' });
    }

    const userId = req.user.user.id;
    const sql = `INSERT INTO projects (title, description, nama_ketua, nim_ketua, prodi, karya_type, karya_url, status, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`;
    const values = [title, description, nama_ketua, nim_ketua, prodi, karya_type, karya_url, 'PENDING', userId];

    const newProject = await pool.query(sql, values);
    res.status(201).json({ message: 'Upload berhasil!', project: newProject.rows[0] });
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Gagal upload', error: err.message });
  }
});

// [BARU] PATCH: UPDATE STATUS (SETUJU / TOLAK)
app.patch('/api/projects/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // Expect: "APPROVED" or "REJECTED"

    // Validasi input status
    if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
      return res.status(400).json({ message: 'Status tidak valid' });
    }

    const sql = 'UPDATE projects SET status = $1 WHERE id = $2 RETURNING *';
    const result = await pool.query(sql, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Project tidak ditemukan' });
    }

    res.json({ message: `Status berhasil diubah menjadi ${status}`, project: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal update status' });
  }
});

// [BARU] GET: Ambil Project Milik User yang Sedang Login
app.get('/api/projects/my-projects', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.user.id; // Ambil ID dari Token
    const sql = `SELECT * FROM projects WHERE user_id = $1 ORDER BY id DESC`;
    const result = await pool.query(sql, [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// [BARU] PUT: Edit Project (Hanya jika PENDING)
app.put('/api/projects/:id', authenticateToken, upload.single('karyaFile'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, nama_ketua, nim_ketua, prodi, youtube_link } = req.body;
    const userId = req.user.user.id;

    // 1. Cek dulu apakah project ini milik user & statusnya PENDING
    const checkSql = 'SELECT * FROM projects WHERE id = $1 AND user_id = $2';
    const checkResult = await pool.query(checkSql, [id, userId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Project tidak ditemukan atau bukan milik Anda' });
    }

    const existingProject = checkResult.rows[0];

    // Cek Status
    if (existingProject.status !== 'PENDING') {
      return res.status(403).json({ message: 'Karya yang sudah Disetujui/Ditolak tidak bisa diedit!' });
    }

    // 2. Siapkan Data Update
    let karya_type = existingProject.karya_type;
    let karya_url = existingProject.karya_url;

    // Jika user upload file baru
    if (req.file) {
      karya_type = 'IMAGE';
      karya_url = `uploads/${req.file.filename}`;

      // (Opsional) Hapus file lama jika ada
      if (existingProject.karya_url.startsWith('uploads/')) {
        const oldPath = path.join(__dirname, existingProject.karya_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }
    // Jika user ganti link youtube
    else if (youtube_link) {
      karya_type = 'YOUTUBE';
      karya_url = youtube_link;
    }

    // 3. Update Database
    const updateSql = `
      UPDATE projects
      SET title = $1, description = $2, nama_ketua = $3, nim_ketua = $4, prodi = $5, karya_type = $6, karya_url = $7
      WHERE id = $8
      RETURNING *
    `;
    const values = [title, description, nama_ketua, nim_ketua, prodi, karya_type, karya_url, id];
    const updateResult = await pool.query(updateSql, values);

    res.json({ message: 'Project berhasil diupdate!', project: updateResult.rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal update project' });
  }
});

// [BARU] DELETE: TAKEDOWN KARYA
app.delete('/api/projects/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Ambil info project dulu untuk hapus filenya
    const checkSql = 'SELECT karya_url, karya_type FROM projects WHERE id = $1';
    const checkResult = await pool.query(checkSql, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Project tidak ditemukan' });
    }

    const project = checkResult.rows[0];

    // 2. Hapus dari Database
    const deleteSql = 'DELETE FROM projects WHERE id = $1';
    await pool.query(deleteSql, [id]);

    // 3. Hapus File Fisik (Jika tipe IMAGE dan file ada di folder uploads)
    if (project.karya_type === 'IMAGE' && project.karya_url.startsWith('uploads/')) {
      const filePath = path.join(__dirname, project.karya_url);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath); // Hapus file dari folder
        console.log(`🗑️ File dihapus: ${filePath}`);
      }
    }

    res.json({ message: 'Project berhasil dihapus (Takedown)' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal menghapus project' });
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
    console.error(err); res.status(500).json({ error: err.message });
  }
});

app.post('/api/comments', async (req, res) => {
  try {
    const { project_id, user_name, comment, rating } = req.body;
    const sql = 'INSERT INTO comments (project_id, user_name, comment, rating) VALUES ($1, $2, $3, $4) RETURNING id';
    const result = await pool.query(sql, [project_id, user_name, comment, rating]);
    res.json({ message: 'Komentar terkirim!', id: result.rows[0].id });
  } catch (err) {
    console.error(err); res.status(500).json({ error: err.message });
  }
});

// === 7. JALANKAN SERVER ===
app.listen(port, () => {
  console.log(`🚀 Server backend berjalan di http://localhost:${port}`);
});