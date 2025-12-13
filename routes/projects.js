const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../db');
const auth = require('../middleware/auth');
const fs = require('fs');

// === Konfigurasi Multer ===
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, 'uploads/'); },
  filename: function (req, file, cb) { cb(null, Date.now() + '-' + file.originalname); }
});
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image') || file.mimetype === 'application/pdf') { cb(null, true); } else { cb(new Error('Jenis file salah!'), false); }
};
const upload = multer({ storage: storage, limits: { fileSize: 1024 * 1024 * 10 }, fileFilter: fileFilter });


// === 1. CREATE: Upload Proyek ===
router.post('/', auth, upload.single('karyaFile'), async (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(403).json({ message: 'Admin tidak boleh upload karya.' });
  }

  try {
    // [UPDATE] Tambahkan prodi di sini
    const { title, description, nama_ketua, nim_ketua, youtube_link, prodi } = req.body;
    const userId = req.user.id;
    let karya_type = '';
    let karya_url = '';

    if (req.file) {
      karya_type = req.file.mimetype.startsWith('image') ? 'IMAGE' : 'PDF';
      karya_url = req.file.path.replace(/\\/g, '/');
    } else if (youtube_link) {
      karya_type = 'YOUTUBE';
      karya_url = youtube_link;
    } else { return res.status(400).json({ message: 'Karya harus diisi.' }); }

    // [UPDATE] Masukkan prodi ke query INSERT
    const newProject = await db.query(
      `INSERT INTO projects (title, description, nama_ketua, nim_ketua, karya_type, karya_url, user_id, prodi)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [title, description, nama_ketua, nim_ketua, karya_type, karya_url, userId, prodi]
    );
    res.status(201).json(newProject.rows[0]);
  } catch (err) { res.status(500).send(err.message); }
});

// === 2. READ ALL (SEMUA BOLEH - Untuk Halaman Exhibition) ===
router.get('/', async (req, res) => {
  try {
    // Hanya tampilkan yang APPROVED di halaman publik (opsional, tapi bagus untuk showcase)
    // Atau tampilkan semua jika belum ada fitur filter di frontend
    const allProjects = await db.query(
      `SELECT p.*, u.name AS author_name FROM projects p JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC`
    );
    res.json(allProjects.rows);
  } catch (err) { res.status(500).send('Server Error'); }
});

// === 3. MY PROJECTS (HANYA USER) ===
router.get('/my-projects', auth, async (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(403).json({ message: 'Admin tidak punya karya pribadi.' });
  }
  try {
    const userId = req.user.id;
    const myProjects = await db.query(`SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
    res.json(myProjects.rows);
  } catch (err) { res.status(500).send('Server Error'); }
});

// === 4. DETAIL (SEMUA BOLEH) ===
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const project = await db.query(`SELECT p.*, u.name AS author_name FROM projects p JOIN users u ON p.user_id = u.id WHERE p.id = $1`, [id]);
    if (project.rows.length === 0) return res.status(404).json({ message: 'Proyek tidak ditemukan' });
    res.json(project.rows[0]);
  } catch (err) { res.status(500).send('Server Error'); }
});

// === 5. UPDATE DATA (HANYA USER PEMILIK & STATUS PENDING) ===
router.put('/:id', auth, upload.single('karyaFile'), async (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ message: 'Admin tidak boleh edit konten.' });

  try {
    const { id } = req.params;
    const { title, description, nama_ketua, nim_ketua, youtube_link } = req.body;
    const userId = req.user.id;

    const projectCheck = await db.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (projectCheck.rows.length === 0) return res.status(404).json({ message: 'Proyek tidak ditemukan' });
    const oldProject = projectCheck.rows[0];

    if (oldProject.user_id !== userId) return res.status(403).json({ message: 'Akses ditolak' });
    if (oldProject.status !== 'PENDING') return res.status(400).json({ message: 'Hanya proyek PENDING yang bisa diedit' });

    let karya_type = oldProject.karya_type;
    let karya_url = oldProject.karya_url;
    if (req.file) {
        if (oldProject.karya_type !== 'YOUTUBE' && oldProject.karya_url) {
            const p = path.join(__dirname, '..', oldProject.karya_url);
            if(fs.existsSync(p)) fs.unlinkSync(p);
        }
        karya_type = req.file.mimetype.startsWith('image') ? 'IMAGE' : 'PDF';
        karya_url = req.file.path.replace(/\\/g, '/');
    } else if (youtube_link) {
        karya_type = 'YOUTUBE';
        karya_url = youtube_link;
    }

    const updatedProject = await db.query(
      `UPDATE projects SET title=$1, description=$2, nama_ketua=$3, nim_ketua=$4, karya_type=$5, karya_url=$6 WHERE id=$7 RETURNING *`,
      [title, description, nama_ketua, nim_ketua, karya_type, karya_url, id]
    );
    res.json(updatedProject.rows[0]);
  } catch (err) { res.status(500).send('Server Error'); }
});

// === 6. UPDATE STATUS (HANYA ADMIN) ===
router.patch('/:id/status', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Hanya Admin yang boleh memverifikasi.' });
  }

  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) return res.status(400).json({ message: 'Status invalid' });

    const updatedProject = await db.query('UPDATE projects SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
    res.json(updatedProject.rows[0]);
  } catch (err) { res.status(500).send('Server Error'); }
});

// BAGIAN 3D EXHIBITION BINGKAI GAMBAR
router.get('/', async (req, res) => {
  try {
    // [PERUBAHAN] Tambahkan u.major di SELECT
    const allProjects = await db.query(
      `SELECT p.*, u.name AS author_name, u.major
       FROM projects p
       JOIN users u ON p.user_id = u.id
       ORDER BY p.created_at DESC`
    );
    res.json(allProjects.rows);
  } catch (err) { res.status(500).send('Server Error'); }
});

// === 7. DELETE (USER BOLEH, ADMIN BOLEH) ===
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const projectCheck = await db.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (projectCheck.rows.length === 0) return res.status(404).json({ message: 'Proyek tidak ditemukan' });
    const project = projectCheck.rows[0];

    // User biasa hanya boleh hapus milik sendiri
    if (userRole !== 'admin' && project.user_id !== userId) {
        return res.status(403).json({ message: 'Akses ditolak' });
    }

    if ((project.karya_type === 'IMAGE' || project.karya_type === 'PDF') && project.karya_url) {
      const filePath = path.join(__dirname, '..', project.karya_url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await db.query('DELETE FROM projects WHERE id = $1', [id]);
    res.json({ message: 'Proyek berhasil dihapus' });
  } catch (err) { res.status(500).send('Server Error'); }
});

module.exports = router;