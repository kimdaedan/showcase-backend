const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

module.exports = function(req, res, next) {
  const tokenHeader = req.header('Authorization');

  if (!tokenHeader) return res.status(401).json({ message: 'Akses ditolak. Tidak ada token.' });

  if (!tokenHeader.startsWith('Bearer ')) return res.status(401).json({ message: 'Format token salah.' });

  const token = tokenHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded.user; // Ini sekarang berisi { id, name, email, ROLE }
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token tidak valid.' });
  }
};