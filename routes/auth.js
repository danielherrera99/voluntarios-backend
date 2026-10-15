const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Buscar usuario por correo en Supabase
    const { data: users, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('correo', email);

    if (error) throw error;
    
    if (!users || users.length === 0) {
      return res.status(401).json({ msg: 'Credenciales inválidas' });
    }

    const user = users[0];

    // 2. Verificar contraseña con bcrypt
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ msg: 'Credenciales inválidas' });
    }

    // 3. Generar JWT
    const payload = {
      user: {
        id: user.id,
        nombre: user.nombre,
        correo: user.correo,
        rol: user.rol
      }
    };

    // Usamos una variable de entorno para la firma del token (o un secreto por defecto para pruebas)
    const jwtSecret = process.env.JWT_SECRET || 'mi_secreto_super_seguro_jufra_2026';

    jwt.sign(
      payload,
      jwtSecret,
      { expiresIn: '1d' }, // Token válido por 1 día
      (err, token) => {
        if (err) throw err;
        res.json({ token, user: payload.user });
      }
    );
  } catch (error) {
    console.error('Error en login:', error.message);
    res.status(500).send('Error del servidor');
  }
});

module.exports = router;
